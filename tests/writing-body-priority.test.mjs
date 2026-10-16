import assert from 'node:assert/strict'
import test from 'node:test'
import { dreamSikeToolPhase, applyDreamSikeToolPhase } from '../tavern-plugin/lib/domain/dream-sike-tool-phase.js'
import { dreamSikeExecutionStageForPhase } from '../tavern-plugin/lib/domain/dream-sike-execution-usage.js'
import { dreamSikeTurnIdentity, submitDreamSikeDraft, reviseDreamSikeDraft, readyDreamSikeDraft } from '../tavern-plugin/lib/domain/dream-sike-draft.js'
import { createModelRequestLog } from '../tavern-plugin/lib/domain/model-request-log.js'
import { registerDreamSikeTools } from '../tavern-plugin/lib/tools/dream-sike.js'
import { registerTurnLifecycleHooks } from '../tavern-plugin/lib/hooks/turn-lifecycle.js'
import { projectAssistantReply } from '../tavern-plugin/lib/domain/session-reply-projection.js'
import { createSceneImageNativeRuntime } from './fixtures/scene-image-native-runtime.mjs'

const body = '林然接过未拆的信，停在门口。“你想先问什么？”'
function fixture() {
  return { id: 'chat', sessionId: 'session', mode: 'story', playPresetId: 'dream-sike-dsh',
    dreamSikeExecutionPolicy: { queryRequests: 1, revisionRequests: 0 }, messages: [], variables: { gold: 3 },
    runtimePresetSnapshot: { front: { entries: [{ id: '0da6f4d7-961d-4966-a084-857a3dd876ad', content: '核对场景、人物、信息与停止位置，保留玩家选择。' }] } },
    timeline: { branchId: 'branch', revision: 1, operations: { body: {
      id: 'body', kind: 'body', turn: 1, status: 'running', basedOn: { branchId: 'branch', revision: 1 }, userText: '接信'
    } } }
  }
}
const usage = counts => ({ rootOperationId: 'body', branchId: 'branch', policy: { queryRequests: 1, revisionRequests: 0 }, counts })

test('Skill-only initial requests and exhausted research cannot consume the opportunity to write', () => {
  const chat = fixture()
  for (const counts of [{ query: 1 }, { query: 2, initial: 1 }, { query: 20, initial: 3, revision: 20 }]) {
    const phase = dreamSikeToolPhase(chat, 'session', 1, usage(counts))
    assert.equal(phase.name, 'draft')
    assert.equal(dreamSikeExecutionStageForPhase(phase), 'initial')
    assert.ok(phase.tools.includes('sike_put_draft'))
    assert.deepEqual(phase.tools, ['sike_put_draft'])
  }
})

test('direct submission needs neither a read receipt nor optional brief/review metadata', () => {
  const chat = fixture(), identity = dreamSikeTurnIdentity(chat, 'session', 1)
  const saved = submitDreamSikeDraft(chat, identity, { text: body })
  assert.equal(saved.status, 'ready')
  assert.equal(saved.text, body)
  assert.equal(saved.checks.editorial.required, false)
  assert.equal(chat.dreamSikePreparation.readAt, null, 'never invent tool-read evidence')
  assert.equal(chat.dreamSikePreparation.submissionMode, 'direct')
  assert.deepEqual(chat.messages, [], 'a draft alone does not emit a formal message')
  assert.deepEqual(chat.variables, { gold: 3 })
})

test('optional metadata defects become notes and cannot discard authored prose', () => {
  const chat = fixture(), identity = dreamSikeTurnIdentity(chat, 'session', 1)
  const saved = submitDreamSikeDraft(chat, identity, { text: body,
    brief: { scene: 'incomplete' }, review: { style: { status: 'revise', evidence: '<think>private metadata</think>' } } })
  assert.equal(saved.status, 'ready')
  assert.ok(saved.checks.editorial.notes.length)
  assert.doesNotMatch(JSON.stringify(saved.checks.editorial.review), /private metadata/)
  assert.ok(chat.dreamSikePreparation.briefWarning)
})

test('author format and protocol errors remain durable and cannot be committed under zero optional revisions', () => {
  const chat = fixture(), identity = dreamSikeTurnIdentity(chat, 'session', 1)
  const draft = submitDreamSikeDraft(chat, identity, { text: '<dream_body>' + body })
  assert.equal(draft.status, 'draft')
  assert.throws(() => readyDreamSikeDraft(chat, identity, 1), /格式或协议/)
  const phase = dreamSikeToolPhase(chat, 'session', 1, usage({ query: 1, initial: 3, revision: 99 }))
  assert.equal(phase.name, 'repair')
  assert.equal(dreamSikeExecutionStageForPhase(phase), 'completion')
  const repaired = reviseDreamSikeDraft(chat, identity, { expectedVersion: 1,
    find: body, replacement: body + '</dream_body>' })
  assert.equal(repaired.status, 'ready')
  assert.equal(repaired.version, 2)
  assert.equal(repaired.revisionCount, 1)
})

test('explicitly retaining a draft allows an optional edit, then ends without mandatory review', () => {
  const chat = fixture(); chat.dreamSikeExecutionPolicy.revisionRequests = 1
  const identity = dreamSikeTurnIdentity(chat, 'session', 1)
  assert.equal(submitDreamSikeDraft(chat, identity, { text: body, finalize: false }).status, 'draft')
  assert.equal(dreamSikeToolPhase(chat, 'session', 1).name, 'revision')
  assert.equal(reviseDreamSikeDraft(chat, identity, { expectedVersion: 1, find: '停在门口', replacement: '在门口收住脚步' }).status, 'ready')
})

test('prose length and banned-phrase findings use optional revision budget then become notes', () => {
  const chat = fixture(), identity = dreamSikeTurnIdentity(chat, 'session', 1)
  chat.dreamSikeExecutionPolicy.revisionRequests = 1
  chat.runtimePresetSnapshot.front.entries.push({ id: 'bc555774-4ac3-4ace-bd92-44c32714d7d3', content: '禁止破折号' })
  const saved = submitDreamSikeDraft(chat, identity, { text: body + '——门响了。' })
  assert.equal(saved.status, 'draft')
  assert.equal(dreamSikeToolPhase(chat, 'session', 1).name, 'revision')
  const modified = reviseDreamSikeDraft(chat, identity, { expectedVersion: 1, find: '门响了', replacement: '门轻响' })
  assert.equal(modified.status, 'ready')
  assert.ok(modified.checks.notes.some(note => note.includes('破折号')))
  assert.equal(modified.requiredRepairCount, undefined)
})

test('stale versions, contract checks and branch ownership still guard necessary repairs', () => {
  const chat = fixture(), identity = dreamSikeTurnIdentity(chat, 'session', 1)
  submitDreamSikeDraft(chat, identity, { text: '<dream_body>' + body })
  assert.throws(() => reviseDreamSikeDraft(chat, identity, { expectedVersion: 2, find: body, replacement: body + '</dream_body>' }), /版本已变化/)
  assert.throws(() => reviseDreamSikeDraft(chat, { ...identity, branchId: 'other' }, { expectedVersion: 1, find: body, replacement: body + '</dream_body>' }), /分支已变化|分支变化失效/)
  assert.equal(chat.dreamSikeDraft.version, 1)
})

test('provider ledger keeps optimization limits while admitting required body completion', async () => {
  const files = new Map()
  const log = createModelRequestLog({ readJson: async path => structuredClone(files.get(path)),
    writeJson: async (path, value) => files.set(path, structuredClone(value)),
    updateJson: async (path, fn) => files.set(path, structuredClone(fn(structuredClone(files.get(path))))) })
  const base = { chatId: 'chat', rootOperationId: 'body', branchId: 'branch', turn: 1,
    policy: { queryRequests: 1, revisionRequests: 0 } }
  assert.equal((await log.reserveExecutionAttempt({ ...base, attemptId: 'q1', stage: 'query' })).accepted, true)
  assert.equal((await log.reserveExecutionAttempt({ ...base, attemptId: 'q2', stage: 'query' })).accepted, false)
  assert.equal((await log.reserveExecutionAttempt({ ...base, attemptId: 'i1', stage: 'initial' })).accepted, true)
  assert.equal((await log.reserveExecutionAttempt({ ...base, attemptId: 'i2', stage: 'initial' })).accepted, true)
  const completion = await log.reserveExecutionAttempt({ ...base, attemptId: 'r1', stage: 'revision', allowBodyCompletion: true })
  assert.equal(completion.accepted, true)
  assert.equal(completion.stage, 'completion')
  assert.equal((await log.executionUsage('chat', 'body', 'branch')).counts.revision, 0)
  assert.equal((await log.executionUsage('chat', 'body', 'branch')).counts.completion, 1)
})

test('one native tool step may read then save a full body without another provider request', async () => {
  let chat = fixture(), concludes = 0
  const tools = new Map()
  registerDreamSikeTools({ tools: { register: tool => tools.set(tool.name, tool) },
    chatForSession: async () => structuredClone(chat), activeTurnOf: () => 1,
    updateChat: async (_id, mutate) => (chat = mutate(structuredClone(chat))) })
  const exec = { agent: { session: { id: 'session' }, phase: { turn: 1, step: 2 } }, concludeTurn: () => concludes++ }
  await tools.get('sike_read_turn').execute({ includeDraft: false, includeRules: true }, exec)
  const result = await tools.get('sike_put_draft').execute({ text: body, review: 'not JSON', brief: 'not JSON' }, exec)
  assert.equal(result.draft.status, 'ready')
  assert.equal(concludes, 1)
  assert.equal(chat.dreamSikeDraft.text, body)
})

function lifecycleFixture({ text = body, retained = false, unsafe = false, race = false } = {}) {
  let chat = fixture(), commits = 0, steers = 0
  if (retained) submitDreamSikeDraft(chat, dreamSikeTurnIdentity(chat, 'session', 1), { text: body, finalize: false })
  const events = [{ seq: 0, type: 'turn/start', data: { turn: 1 } }, { seq: 1, type: 'user/message', data: { turn: 1,
    message: { role: 'user', content: [{ type: 'text', text: '接信' }] } } }, { seq: 2, type: 'assistant/message', data: { turn: 1,
    message: { role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text: unsafe ? '<think>private</think>' + body : text }] } } }]
  const session = { id: 'session', events }, handlers = new Map()
  registerTurnLifecycleHooks({ ctx: { on: (name, fn) => handlers.set(name, fn) },
    backgroundAgentRunner: { requestContext: () => null, owns: () => false },
    fullTemplateRuntime: { cancel() {} }, clearRuntimePresetRequestState() {},
    chatForSession: async () => structuredClone(chat), userMessageForTurn: () => events[1].data.message,
    contentText: () => '接信', requestIdForTurn: () => 'request',
    updateChat: async (_id, mutate) => {
      const current = structuredClone(chat)
      if (race) { current.timeline.branchId = 'other'; current.timeline.operations.body.basedOn.branchId = 'other' }
      return (chat = mutate(current))
    },
    turnOrchestrator: { recordFailure: async () => assert.fail('usable prose must not be recorded as failure') },
    replaceAssistantReply() {}, foregroundHandoff: { async finalize(input) {
      commits++; assert.equal(input.assistantText, retained && text !== '正文已保存。' ? text : body)
      chat.nativeCommits = { '1': { turn: 1 } }; chat.dreamSikeDraft.status = 'committed'
      return { reply: { sessionText: body } }
    } } })
  const agent = { session, steer() { steers++ } }
  return { stop: () => handlers.get('agent/turn-stopping')({ agent, turn: 1 }),
    state: () => ({ chat, commits, steers }) }
}

test('normal prose is saved, checked and committed once with no tool choreography', async () => {
  const fixture = lifecycleFixture()
  await fixture.stop(); await fixture.stop()
  assert.equal(fixture.state().commits, 1)
  assert.equal(fixture.state().steers, 0)
  assert.equal(fixture.state().chat.dreamSikeDraft.text, body)
})

test('usable retained prose commits when optional work is over instead of steering another model call', async () => {
  const fixture = lifecycleFixture({ retained: true, text: '正文已保存。' })
  await fixture.stop()
  assert.equal(fixture.state().commits, 1)
  assert.equal(fixture.state().steers, 0)
})

test('latest full normal prose replaces an explicitly retained draft before the single commit', async () => {
  const text = body + '门外的人把第二封信递了过来。'
  const fixture = lifecycleFixture({ retained: true, text })
  await fixture.stop()
  assert.equal(fixture.state().commits, 1)
  assert.equal(fixture.state().chat.dreamSikeDraft.text, text)
  assert.equal(fixture.state().chat.dreamSikeDraft.version, 2)
})

test('a branch change during completion cannot bind old model prose to a new operation', async () => {
  const fixture = lifecycleFixture({ race: true })
  await assert.rejects(fixture.stop(), /分支已变化/)
  assert.equal(fixture.state().commits, 0)
})

test('normal completion of a retained draft keeps the draft size limit and original body on rejection', async () => {
  const fixture = lifecycleFixture({ retained: true, text: '甲'.repeat(100001) })
  await assert.rejects(fixture.stop(), /100000/)
  assert.equal(fixture.state().commits, 0)
  assert.equal(fixture.state().chat.dreamSikeDraft.text, body)
})

test('private/state protocol cannot leak via the normal-prose completion path', async () => {
  const fixture = lifecycleFixture({ unsafe: true })
  await fixture.stop()
  assert.equal(fixture.state().commits, 0)
  assert.equal(fixture.state().steers, 1)
  assert.equal(fixture.state().chat.dreamSikeDraft.status, 'draft')
})

for (const directText of [false, true]) test('native Harness completes once at zero revisions via ' + (directText ? 'normal prose' : 'Skills, read and put'),
  { skip: !process.env.DSH_BOOT_MODULE, timeout: 30000 }, async t => {
    let chat = fixture(); chat.sessionId = 'scene-parent'
    if (!directText) chat.dreamSikeExecutionPolicy.queryRequests = 2
    let requests = 0, commits = 0
    const files = new Map(), log = createModelRequestLog({ readJson: async path => structuredClone(files.get(path)),
      writeJson: async (path, value) => files.set(path, structuredClone(value)),
      updateJson: async (path, fn) => files.set(path, structuredClone(fn(structuredClone(files.get(path))))) })
    const runtime = await createSceneImageNativeRuntime(process.env.DSH_BOOT_MODULE, {
      async setupHost(ctx) {
        registerDreamSikeTools({ tools: ctx.tools, chatForSession: async () => structuredClone(chat),
          updateChat: async (_id, mutate) => (chat = mutate(structuredClone(chat))),
          activeTurnOf: exec => exec.agent.phase.turn, executionUsageForChat: (...args) => log.executionUsage(...args) })
        ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
          const assembly = await next(), turn = context.agent.phase.turn
          return applyDreamSikeToolPhase(assembly, dreamSikeToolPhase(chat, chat.sessionId, turn,
            await log.executionUsage('chat', 'body', 'branch')))
        })
        registerTurnLifecycleHooks({ ctx: { on(name, fn) { if (name === 'agent/turn-stopping') ctx.on(name, fn) } },
          backgroundAgentRunner: { requestContext: () => null, owns: () => false },
          fullTemplateRuntime: { cancel() {} }, clearRuntimePresetRequestState() {},
          chatForSession: async () => structuredClone(chat), userMessageForTurn: () => ({ content: [{ type: 'text', text: '接信' }] }),
          contentText: () => '接信', requestIdForTurn: () => 'native-test',
          updateChat: async (_id, mutate) => (chat = mutate(structuredClone(chat))),
          replaceAssistantReply: projectAssistantReply,
          turnOrchestrator: { recordFailure: async data => assert.fail(JSON.stringify(data)) },
          foregroundHandoff: { async finalize(input) {
            commits++; assert.equal(input.assistantText, body)
            chat.nativeCommits = { '1': { turn: 1 } }; chat.dreamSikeDraft.status = 'committed'
            return { reply: { sessionText: body } }
          } } })
      },
      async beforeModelRequest() {
        const phase = dreamSikeToolPhase(chat, chat.sessionId, 1, await log.executionUsage('chat', 'body', 'branch'))
        const reserved = await log.reserveExecutionAttempt({ chatId: 'chat', attemptId: 'native-' + requests,
          rootOperationId: 'body', branchId: 'branch', turn: 1, stage: dreamSikeExecutionStageForPhase(phase),
          policy: chat.dreamSikeExecutionPolicy, allowBodyCompletion: true })
        assert.equal(reserved.accepted, true)
      },
      scriptedModelResponse: async () => {
        requests++
        if (directText) return [{ type: 'text', text: body }]
        const call = (id, name, args) => ({ type: 'tool-call', id, name, arguments: JSON.stringify(args) })
        if (requests === 1) return [call('planning', 'skill', { name: 'dream-sike-planning' })]
        if (requests === 2) return [call('prose', 'skill', { name: 'dream-sike-prose' }),
          call('read', 'sike_read_turn', { includeRules: true, finishResearch: true, includeDraft: false })]
        if (requests === 3) return [call('put', 'sike_put_draft', { text: body, review: { character: 'pass' }, brief: { scene: 123 } })]
        assert.fail('a confirmed body cannot require a completion request')
      }
    })
    t.after(() => runtime.dispose())
    runtime.parent.agent.followup({ id: 'player', role: 'user', content: [{ type: 'text', text: '接信' }], source: { kind: 'user' } })
    await runtime.parent.agent.whenIdle()
    const events = runtime.traceEvents('scene-parent'), end = events.findLast(event => event.type === 'turn/end')
    assert.equal(end?.data.reason.kind, 'completed', JSON.stringify(end?.data.reason))
    assert.equal(commits, 1)
    assert.equal(requests, directText ? 1 : 3)
    const toolCalls = events.filter(event => event.type === 'tool/call')
    for (const call of toolCalls) assert.equal(events.filter(event => event.type === 'tool/result' && event.sourceEventSeqs?.includes(call.seq)).length, 1)
    assert.deepEqual(chat.variables, { gold: 3 })
  })
