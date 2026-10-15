import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createTurnOrchestrator } from '../tavern-plugin/lib/domain/turn-orchestration.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { createForegroundFrameBuilder } from '../tavern-plugin/lib/domain/agent-input-frame.js'
import { projectReplyLayers } from '../tavern-plugin/lib/domain/reply-presentation.js'
import { createForegroundOrchestrationStrategies } from '../tavern-plugin/lib/domain/foreground-orchestration-strategies.js'
import { compileSillyTavernRequest } from '../tavern-plugin/lib/domain/sillytavern-compatibility.js'
import { resolveRuntimeMacroText } from '../tavern-plugin/lib/domain/runtime-content-projection.js'
import { normalizeGenerationMode, selectGenerationMode } from '../tavern-plugin/lib/domain/generation-mode.js'
import { registerTurnLifecycleHooks } from '../tavern-plugin/lib/hooks/turn-lifecycle.js'

const clone = value => structuredClone(value)
const body = '<正文>房门缓缓打开，她停在门边等待你的回答。</正文>\n<parallel>另一条街上，信使带走了密封的信。</parallel>\n<options>1. 询问来意\n2. 请她进屋</options>\n<UpdateVariable><JSONPatch>[{"op":"replace","path":"/hp","value":9}]</JSONPatch></UpdateVariable>'
const userMessage = { id: 'input', role: 'user', content: [{ type: 'text', text: '开门。' }], source: { kind: 'user' } }

function turnFixture(playPresetId, overrides = {}) {
  let sequence = 0
  const timeline = createStoryTimeline({ id: kind => kind + '-' + ++sequence, now: () => 1000 })
  let chat = { id: 'game', sessionId: 'session', mode: 'story', playPresetId, generationMode: 'sillytavern-once', requestMode: 'dsh',
    _storageRevision: 1, cardPath: 'cards/one.json', cardName: '角色', messages: [{ role: 'assistant', text: '开场', greeting: true }],
    variables: { hp: 10 }, nativeCommits: {}, macroState: { userName: '玩家', local: {}, global: {} }, webSearchEnabled: true,
    dreamSikeDraft: { version: 7, status: 'draft', text: '上一轮未完成的草稿', turn: 1 },
    tavernScriptPrompts: [{ id: 'once', content: '只用于本回合的作者指令', position: 'in_chat', role: 'system', depth: 0, once: true },
      { id: 'persistent', content: '持续指令', position: 'in_chat', role: 'system', depth: 1, once: false }],
    runtimePresetSnapshot: { digest: 'author-options', front: { entries: [] }, regexScripts: [] }, ...overrides }
  const writes = []
  const store = {
    chatForSession: async () => clone(chat), readCard: async () => ({ name: '角色' }), readCardExtensions: async () => ({ regexScripts: [] }),
    async writeChat(next, metadata) { chat = { ...clone(next), _storageRevision: chat._storageRevision + 1 }; writes.push(clone(metadata || {})) },
    async updateChat(_id, update, metadata) { const next = await update(clone(chat)); if (next !== undefined) await store.writeChat(next, metadata); return clone(chat) }
  }
  const orchestrator = createTurnOrchestrator({ store, timeline, frameBuilder: createForegroundFrameBuilder(),
    planner: { plan() { throw new Error('Single reply must not invoke Agent planning') } },
    cards: {}, scripts: {}, workspace: {}, projectReply: projectReplyLayers, now: () => 1000 })
  return { orchestrator, timeline, writes, chat: () => clone(chat) }
}

for (const presetId of ['tavern', 'dream-sike-dsh', 'another-author-preset']) {
  test('single reply commits one complete body through Timeline with preset ' + presetId, async () => {
    const fixture = turnFixture(presetId)
    const before = fixture.chat()
    assert.deepEqual(await fixture.orchestrator.visibleTools('session'), [])
    await fixture.orchestrator.beginCompatibility({ sessionId: 'session', turn: 2, requestId: 'request-2', userText: '开门。' })
    const pending = fixture.chat()
    assert.equal(Object.values(pending.timeline.operations).filter(operation => operation.kind === 'body' && operation.status === 'running').length, 1)
    assert.equal(pending.tavernScriptPrompts.length, 2)
    const input = { sessionId: 'session', turn: 2, requestId: 'request-2', userText: '开门。', assistantText: body }
    const first = await fixture.orchestrator.finalize(input)
    assert.equal(first.saved, true)
    const once = fixture.chat()
    assert.equal(once.messages.filter(message => message.role === 'assistant' && message.turn === 2).length, 1)
    assert.equal(once.messages.at(-1).sourceText, body)
    assert.equal(once.messages.at(-1).text, body)
    assert.equal(once.timeline.revision, pending.timeline.revision + 1)
    assert.equal(Object.values(once.timeline.operations).filter(operation => operation.kind === 'body' && operation.status === 'completed').length, 1)
    assert.deepEqual(once.dreamSikeDraft, before.dreamSikeDraft)
    assert.deepEqual(once.variables, before.variables)
    assert.deepEqual(once.tavernScriptPrompts.map(prompt => prompt.id), ['persistent'])
    assert.deepEqual(once.runtimePresetSnapshot, before.runtimePresetSnapshot)
    const repeated = await fixture.orchestrator.finalize(input)
    assert.equal(repeated.duplicate, true)
    assert.deepEqual(fixture.chat(), once)
    assert.equal(fixture.writes.filter(write => write.source === 'foreground.commit').length, 1)
  })
}

test('the production stopping hook commits single reply with author prefill despite a saved unready Dream draft', async () => {
  const fixture = turnFixture('dream-sike-dsh', { compatibilityTraces: { 2: { assistantPrefill: '<正文>' } } })
  await fixture.orchestrator.beginCompatibility({ sessionId: 'session', turn: 2, requestId: 'request-2', userText: '开门。' })
  const hooks = new Map(), replacements = []
  registerTurnLifecycleHooks({
    ctx: { on(name, callback) { hooks.set(name, callback) } },
    backgroundAgentRunner: { requestContext() {}, owns() { return false } },
    fullTemplateRuntime: { cancel() {} }, clearRuntimePresetRequestState() {},
    chatForSession: async () => fixture.chat(), userMessageForTurn: () => clone(userMessage),
    contentText: value => value.content.map(block => block.text || '').join(''), requestIdForTurn: () => 'request-2',
    foregroundHandoff: { finalize: input => fixture.orchestrator.finalize(input) },
    turnOrchestrator: fixture.orchestrator, replaceAssistantReply(_session, _result, text) { replacements.push(text) }
  })
  const agent = { session: { id: 'session', events: [
    { type: 'turn/start', data: { turn: 2 } },
    { type: 'assistant/message', data: { turn: 2, message: { source: { kind: 'model' }, content: [{ type: 'text', text: body.slice('<正文>'.length) }] } } }
  ] }, steer() { throw new Error('Single reply must not start the Dream draft recovery loop') } }
  await hooks.get('agent/turn-stopping')({ agent, turn: 2 })
  assert.equal(fixture.chat().messages.at(-1).sourceText, body)
  assert.deepEqual(replacements, [body])
  await hooks.get('agent/turn-stopping')({ agent, turn: 2 })
  assert.equal(fixture.chat().messages.filter(message => message.role === 'assistant' && message.turn === 2).length, 1)
  assert.equal(fixture.writes.filter(write => write.source === 'foreground.commit').length, 1)
})

test('single reply projects author options once per step retry without modifying native history or repeating macros', async () => {
  const fixture = turnFixture('dream-sike-dsh')
  let chat = fixture.chat()
  let before = 0, compiledCount = 0, persistedCount = 0
  const generationOptions = { temperature: 0.73, topP: 0.92, maxOutputTokens: 4321, stopSequences: ['[END]'] }
  const strategy = createForegroundOrchestrationStrategies({
    nativePlay: {}, compatibility: {
      async beforeTurn() { before++ },
      beginTurn: input => fixture.orchestrator.beginCompatibility(input),
      async chatForSession() { return chat = { ...fixture.chat(), macroState: chat.macroState } },
      async compileTurn(value, userText) {
        compiledCount++
        const compiled = compileSillyTavernRequest({ card: { name: '角色' }, input: userText, history: value.messages,
          macroState: value.macroState, userName: '玩家', resolveMacros: resolveRuntimeMacroText,
          preset: { entries: [
            { entryKey: 'author', identifier: 'author', ordered: true, enabled: true, content: '{{incvar::compileCount}}作者原始规则', role: 'system' },
            { entryKey: 'history', identifier: 'chatHistory', ordered: true, enabled: true, marker: true }
          ] },
          depthInjections: value.tavernScriptPrompts.map(prompt => ({ ...prompt, source: { kind: 'helper-injection', id: prompt.id } })) })
        return { ...compiled, generationOptions }
      },
      async persistCompiled(input) { persistedCount++; chat.macroState = clone(input.compiled.macroState) },
      projectMessages: compiled => compiled.messages.map(message => ({ role: message.role, content: [{ type: 'text', text: message.content }], source: message.source }))
    }
  })
  const nativeHistory = [{ role: 'system', content: [{ type: 'text', text: 'Native Agent persona and stale tools' }] }, clone(userMessage)]
  const originalHistory = clone(nativeHistory)
  const input = () => ({ sessionId: 'session', chat, requestId: 'request-2', payload: { turn: 2, step: 1, messages: nativeHistory }, decision: { kind: 'enter', messages: nativeHistory } })
  await strategy.prepareStep(input())
  const assembly = await strategy.assembleSystemPrompt({ sections: [{ text: 'DSH instruction' }], contexts: [{ text: 'tool docs' }], tools: [{ name: 'web_search' }, { name: 'sike_read_turn' }] }, { chat, sessionId: 'session' })
  assert.deepEqual(assembly, { sections: [], contexts: [], tools: [] })
  const request = { sessionId: 'session', messages: nativeHistory, system: 'Native system', tools: [{ name: 'web_search' }], toolChoice: 'required', temperature: 0.1 }
  const projected = strategy.projectRequest(request, { turn: 2, step: 1 })
  assert.equal(Object.hasOwn(projected, 'system'), false)
  assert.equal(Object.hasOwn(projected, 'toolChoice'), false)
  assert.deepEqual(projected.tools, [])
  for (const [key, value] of Object.entries(generationOptions)) assert.deepEqual(projected[key], value)
  assert.equal(projected.messages.some(message => message.content.some(block => block.text?.includes('Native Agent persona'))), false)
  assert.equal(projected.messages.flatMap(message => message.content).filter(block => block.text?.includes('只用于本回合')).length, 1)
  assert.equal(chat.macroState.local.compileCount, 1)
  strategy.completeRequest(projected, false)
  await strategy.prepareStep(input())
  const retried = strategy.projectRequest(request, { turn: 2, step: 1 })
  assert.deepEqual(retried.messages, projected.messages)
  assert.equal(chat.macroState.local.compileCount, 1)
  assert.deepEqual([before, compiledCount, persistedCount], [1, 1, 1])
  assert.deepEqual(nativeHistory, originalHistory)
  assert.equal(chat.tavernScriptPrompts.length, 2)
  await assert.rejects(strategy.prepareStep({ ...input(), payload: { turn: 2, step: 2, messages: nativeHistory } }), /一次正文生成/)
})

const rpcSource = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
function rpcCase(name, next) {
  const body = rpcSource.split("case '" + name + "': {")[1]?.split("case '" + next + "':")[0]
  assert.ok(body, 'Production RPC case exists: ' + name)
  return new AsyncFunction('args', 'dependencies', `const {str,chatForSession,groupOfMode,agentRegistry,sessionActivity,tavernScriptDispatch,replayFailedTurnActive,normalizeGenerationMode,selectGenerationMode,updateChat,backgroundTasks,fullTemplateRuntime,foregroundStrategies}=dependencies; {${body}`)
}
const getMode = rpcCase('getGenerationMode', 'setGenerationMode')
const setMode = rpcCase('setGenerationMode', 'getDreamSikeExecutionPolicy')
function rpcFixture(failure = '') {
  let saved = { id: 'game', sessionId: 'session', mode: 'story', _storageRevision: 4, playPresetId: 'dream-sike-dsh', generationMode: 'agent',
    tavernHelperLifecycleRevision: 6, dreamSikeResume: { failedTurn: 2 }, dreamSikeDraft: { version: 4, text: 'saved draft' },
    runtimePresetSnapshot: { digest: 'source', sourceMacroOverrides: { local: { length: 1000 } }, regexScripts: [{ id: 'author-regex' }],
      compatibilityPresetDocument: { extensions: { tavern_helper: { scripts: [{ id: 'original', enabled: true }] } } } },
    playPresetConfigurations: { tavern: { runtimePresetSnapshot: { digest: 'other' } } },
    variables: { hp: 10 }, messages: [{ role: 'assistant', text: 'unchanged history' }] }
  if (failure === 'settlement') saved.settleStatus = 'waiting-runtime'
  if (failure === 'regeneration') saved.regenInProgress = true
  if (failure === 'card') saved.mode = 'card'
  const agentRegistry = new Map()
  if (failure === 'foreground') agentRegistry.set('session', { phase: { kind: 'running' } })
  const events = []
  let updating = false
  const dependencies = { str: value => String(value || ''), normalizeGenerationMode, selectGenerationMode, agentRegistry,
    chatForSession: async () => clone(saved), groupOfMode: mode => mode === 'card' ? 'card' : 'play',
    sessionActivity: async () => ({ busy: failure === 'background' }),
    tavernScriptDispatch: { status: () => ({ busy: failure === 'script' }), dispose: id => events.push('dispose:' + id) },
    replayFailedTurnActive: () => failure === 'replay',
    backgroundTasks: { activity: () => ({ busy: updating && failure === 'race-background' }) },
    fullTemplateRuntime: { cancel: id => events.push('cancel:' + id) },
    foregroundStrategies: { clearRequestState: id => events.push('clear:' + id) },
    async updateChat(_id, mutation, metadata) {
      updating = true
      const current = clone(saved)
      if (failure === 'stale') current._storageRevision++
      if (failure === 'wrong-game') current.id = 'different-game'
      if (failure === 'race-foreground') agentRegistry.set('session', { phase: { kind: 'running' } })
      const next = await mutation(current)
      saved = next
      events.push(metadata.source)
      return clone(saved)
    }
  }
  return { dependencies, events, chat: () => clone(saved) }
}

test('production generation-mode RPC switches atomically and preserves original author resources', async () => {
  const fixture = rpcFixture(), before = fixture.chat()
  assert.deepEqual(await getMode({ sessionId: 'session' }, fixture.dependencies), { generationMode: 'agent', busy: false, nextTurn: true })
  assert.deepEqual(await setMode({ sessionId: 'session', generationMode: 'sillytavern-once' }, fixture.dependencies), { generationMode: 'sillytavern-once', changed: true, nextTurn: true })
  const saved = fixture.chat()
  for (const key of ['playPresetId', 'runtimePresetSnapshot', 'playPresetConfigurations', 'dreamSikeDraft', 'variables', 'messages']) assert.deepEqual(saved[key], before[key])
  assert.equal(saved.dreamSikeResume, null)
  assert.equal(saved.tavernHelperLifecycleRevision, 7)
  assert.deepEqual(fixture.events, ['generation-mode.switch', 'dispose:session', 'cancel:session', 'clear:session'])
  assert.equal((await getMode({ sessionId: 'session' }, fixture.dependencies)).generationMode, 'sillytavern-once')
  const count = fixture.events.length
  assert.equal((await setMode({ sessionId: 'session', generationMode: 'sillytavern-once' }, fixture.dependencies)).changed, false)
  assert.equal(fixture.events.length, count)
})

for (const failure of ['foreground', 'background', 'script', 'settlement', 'regeneration', 'replay', 'stale', 'wrong-game', 'race-foreground', 'race-background', 'card']) {
  test('production generation-mode RPC rejects ' + failure + ' without saving or clearing scripts', async () => {
    const fixture = rpcFixture(failure), before = fixture.chat()
    if (!['card', 'stale', 'wrong-game', 'race-foreground', 'race-background'].includes(failure)) assert.equal((await getMode({ sessionId: 'session' }, fixture.dependencies)).busy, true)
    await assert.rejects(setMode({ sessionId: 'session', generationMode: 'sillytavern-once' }, fixture.dependencies), /等待|变化|游玩/)
    assert.deepEqual(fixture.chat(), before)
    assert.deepEqual(fixture.events, [])
  })
}
