import assert from 'node:assert/strict'
import test from 'node:test'
import { registerModelStreamHooks } from '../tavern-plugin/lib/hooks/model-stream.js'
import { createForegroundOrchestrationStrategies } from '../tavern-plugin/lib/domain/foreground-orchestration-strategies.js'

test('single reply reaches the provider once with original messages and sampling, without Agent projection or budget', async () => {
  const chat = { id: 'game', sessionId: 'session', mode: 'story', requestMode: 'dsh',
    playPresetId: 'dream-sike-dsh', generationMode: 'sillytavern-once', runtimePresetSnapshot: { digest: 'author' } }
  const messages = [{ role: 'user', content: [{ type: 'text', text: 'player input' }], source: { kind: 'user' } }]
  const sourceMessages = [{ role: 'user', content: [{ type: 'text', text: 'author rule' }] }, ...messages]
  const calls = [], hooks = []
  const forbidden = () => { throw new Error('Agent-only operation reached') }
  const strategies = createForegroundOrchestrationStrategies({
    compatibility: { beforeTurn: async () => {}, beginTurn: async () => ({}), chatForSession: async () => chat,
      compileTurn: async () => ({ messages: sourceMessages, generationOptions: { temperature: 1, maxTokens: 30000 } }),
      persistCompiled: async () => {}, projectMessages: compiled => compiled.messages },
    nativePlay: { prepareTurn: forbidden, resolvePreset: forbidden }
  })
  await strategies.prepareStep({ sessionId: 'session', chat, requestId: 'request',
    payload: { turn: 1, step: 1, messages }, decision: { kind: 'enter', messages } })
  const ctx = { on: (name, callback) => { if (name === 'llm/stream') hooks.push(callback) }, get: forbidden, llm: {} }
  ctx.llm.stream = request => {
    const dispatch = index => index < hooks.length
      ? hooks[index](request, () => dispatch(index + 1))
      : (async function* () {
        calls.push(request)
        yield { type: 'text-delta', text: '完整正文' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    return dispatch(0)
  }
  const requestCoordinates = new Map([['session', { turn: 1, step: 1, rootOperationId: 'body', executionStage: 'draft' }]])
  registerModelStreamHooks({ ctx, agentRegistry: new Map(), sessionStore: new Map(), foregroundStrategies: strategies,
    backgroundAgentRunner: { owns: () => false, requestContext: () => null }, requestCoordinates,
    chatForSession: async () => chat, chatHeaderForSession: async () => chat, sessionStateForSession: async () => chat,
    fullTemplateRuntime: { forSession: forbidden }, updateChat: forbidden,
    modelRequestLog: { reserveExecutionAttempt: forbidden, record: async () => ({ id: 'evidence' }), complete: async () => {} },
    worldbookRecallLog: { requested: async () => {} }, storyRetention: forbidden, runtimePrompt: forbidden,
    str: value => value == null ? '' : String(value) })
  const original = { sessionId: 'session', messages, system: 'DSH persona', tools: [{ name: 'sike_read_turn' }],
    toolChoice: 'required', provider: 'fixture', model: 'fixture', temperature: .2, maxTokens: 1000 }
  const before = structuredClone(original), received = []
  for await (const chunk of ctx.llm.stream(original)) received.push(chunk)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].messages, sourceMessages)
  assert.deepEqual(calls[0].tools, [])
  assert.equal(calls[0].system, undefined)
  assert.equal(calls[0].toolChoice, undefined)
  assert.equal(calls[0].temperature, 1)
  assert.equal(calls[0].maxTokens, 30000)
  assert.deepEqual(original, before)
  assert.equal(received[0].text, '完整正文')
})
