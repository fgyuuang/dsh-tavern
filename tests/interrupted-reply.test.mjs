import test from 'node:test'
import assert from 'node:assert/strict'
import { interruptedAttempt, readInterruptedReply, planInterruptedReplyResume, projectInterruptedReply,
  singleReplyText, collectInterruptedReplies, mergeInterruptedReply } from '../tavern-plugin/lib/domain/interrupted-reply.js'
import { boundedReplyStream } from '../tavern-plugin/lib/domain/bounded-reply-stream.js'
import { createTavernRetryLimiter } from '../tavern-plugin/lib/domain/tavern-retry-limiter.js'
import { createRoundHistory } from '../tavern-plugin/lib/domain/round-history.js'
import { Session } from './fixtures/dsh-session-host.mjs'

function fixture() {
  const events = [
    { seq: 1, type: 'assistant/attempt', data: { turn: 4, step: 1, stream: [{ type: 'text-chunks', texts: ['另一版'] }] } },
    { seq: 2, type: 'assistant/attempt', data: { turn: 4, step: 1, stream: [
      { type: 'reasoning-chunks', texts: ['private channel'] },
      { type: 'text-chunks', texts: ['<think_fox~>private inline</think_fox~>', '已经收到的正文'] },
      { type: 'chunk', chunk: { type: 'tool-call-delta', text: 'not prose' } }
    ] } }
  ]
  const session = { id: 'session', snapshotEvents: () => structuredClone(events) }
  const chat = { sessionId: 'session', generationMode: 'sillytavern-once', playPresetId: 'dream-sike-dsh', playPresetRevision: 1,
    timeline: { branchId: 'branch', revision: 2, operations: { body: { id: 'body', kind: 'body', turn: 4, status: 'failed', basedOn: { branchId: 'branch', revision: 2 } } } } }
  return { chat, session, events }
}

test('recover latest retry without merging alternatives, reasoning or tools; archive both readable versions', () => {
  const { chat, session } = fixture()
  const draft = readInterruptedReply(chat, session, 4)
  assert.equal(draft.preview, '已经收到的正文')
  assert.doesNotMatch(draft.text, /private channel|not prose|另一版/)
  const next = collectInterruptedReplies(chat, session, 4)
  assert.deepEqual(next.interruptedReplyArchive.map(row => row.preview), ['另一版', '已经收到的正文'])
  assert.equal(collectInterruptedReplies(next, session, 4), undefined)
  assert.equal(next.messages, undefined, 'partial must not create story messages or settlement')
})

test('resume retains original messages and merges only the remaining reply; another timeout keeps the entire prefix', () => {
  const { chat, session, events } = fixture()
  const draft = readInterruptedReply(chat, session, 4)
  chat.interruptedReplyResume = planInterruptedReplyResume(chat, session, 4, draft.digest)
  const original = [{ role: 'system', content: [{ type: 'text', text: 'author preset bytes' }] }]
  const projected = projectInterruptedReply(original, chat, 5)
  assert.equal(projected[0], original[0])
  assert.equal(projected[1].role, 'assistant')
  assert.equal(projected[1].source?.kind, 'plugin', 'pi-ai conversion requires source.kind on synthetic assistant history')
  assert.equal(projected[1].source?.form, 'interrupted-reply-prefix')
  assert.equal(projected[1].content[0].text, draft.text)
  assert.equal(projected[2].source?.kind, 'plugin')
  assert.equal(projected[2].source?.form, 'interrupted-reply-continuation')
  assert.equal(singleReplyText(chat, 5, '后半段'), draft.text + '后半段')
  chat.timeline.operations.next = { id: 'next', kind: 'body', turn: 5, status: 'failed', basedOn: { branchId: 'branch', revision: 2 } }
  events.push({ seq: 3, type: 'assistant/attempt', data: { turn: 5, stream: [{ type: 'text-chunks', texts: ['后半段'] }] } })
  const again = readInterruptedReply(chat, session, 5)
  assert.equal(again.text, draft.text + '后半段')
  chat.interruptedReplyResume = planInterruptedReplyResume(chat, session, 5, again.digest)
  assert.equal(singleReplyText(chat, 6, '结尾'), draft.text + '后半段结尾')
})

test('empty resumed attempt retains prefix; stale branch, preset, digest or committed turn cannot be reused', () => {
  for (const change of ['branch', 'preset', 'digest', 'commit']) {
    const { chat, session } = fixture()
    const draft = readInterruptedReply(chat, session, 4)
    if (change === 'branch') chat.timeline.branchId = 'another'
    if (change === 'preset') chat.playPresetRevision++
    if (change === 'commit') chat.nativeCommits = { 4: {} }
    assert.throws(() => planInterruptedReplyResume(chat, session, 4, change === 'digest' ? 'stale' : draft.digest), /已变化/)
  }
  const { chat, session } = fixture()
  const draft = readInterruptedReply(chat, session, 4)
  chat.interruptedReplyResume = planInterruptedReplyResume(chat, session, 4, draft.digest)
  chat.timeline.operations.next = { id: 'next', kind: 'body', turn: 5, status: 'failed', basedOn: { branchId: 'branch', revision: 2 } }
  assert.equal(readInterruptedReply(chat, session, 5).text, draft.text)
  chat.playPresetRevision++
  assert.throws(() => projectInterruptedReply([], chat, 5), /预设已变化/)
})

test('exact substantial overlap is removed; ordinary repeated words remain', () => {
  const repeated = '这是已有的一段正文。'.repeat(8)
  assert.equal(mergeInterruptedReply(repeated, repeated + '结尾'), repeated + '结尾')
  assert.equal(mergeInterruptedReply('开头' + repeated, repeated + '结尾'), '开头' + repeated + '结尾')
  assert.equal(mergeInterruptedReply('好', '好的'), '好好的')
})

test('timeout or existing text prevents automatic alternative completion retries', async () => {
  const { session } = fixture()
  session.append = () => { throw Error('must not retry') }
  const limiter = createTavernRetryLimiter({ owns: () => true })
  for (const payload of [
    { agent: { session }, turn: 4, step: 1, failure: { code: 'TRANSPORT' } },
    { agent: { session }, turn: 5, step: 1, failure: { code: 'TIMEOUT' } }
  ]) assert.equal(await limiter.handle({ ...payload, retryPolicy: { mode: 'always' } }, () => { throw Error('must not delegate') }), undefined)
})

test('watchdog preserves delivered text and aborts a transport that never finishes', async () => {
  let providerSignal
  const chunks = []
  async function* stalled(signal) { providerSignal = signal; yield { type: 'text-delta', text: 'partial' }; await new Promise(() => {}) }
  await assert.rejects(async () => {
    for await (const chunk of boundedReplyStream(stalled, undefined, { idleMs: 15, totalMs: 1000 })) chunks.push(chunk)
  }, /90 秒/)
  assert.equal(chunks[0].text, 'partial')
  assert.equal(providerSignal.aborted, true)
})

test('watchdog bounds generation before first text, propagates cancel, and closes successful streams', async () => {
  await assert.rejects(async () => {
    for await (const _ of boundedReplyStream(async function* () { await new Promise(() => {}) }, undefined, { totalMs: 15 })) {}
  }, /8 分钟/)
  const controller = new AbortController()
  const stream = boundedReplyStream(async function* () { controller.abort(Error('cancelled')); await new Promise(() => {}) }, controller.signal)
  await assert.rejects(stream.next(), /cancelled/)
  const received = []
  for await (const chunk of boundedReplyStream(async function* () { yield { type: 'text-delta', text: 'done' }; yield { type: 'finish', reason: { kind: 'stop' } } })) received.push(chunk)
  assert.equal(received.length, 2)
})

test('replay persists continuation before queueing, validates digest, restores after crash and undoes queue failure', async () => {
  let { chat } = fixture()
  chat = { ...chat, id: 'game', mode: 'story', messages: [] }
  const session = Session.create('session')
  session.append('turn/start', { turn: 4 })
  session.append('user/message', { id: 'input', role: 'user', content: [{ type: 'text', text: '原始玩家输入' }], source: { kind: 'user' } }, { surfaceOp: 'append' })
  session.append('assistant/attempt', { turn: 4, step: 1, stream: [{ type: 'text-chunks', time0: 10, index: 0, dt: [0], texts: ['已经收到的正文'] }] })
  session.append('turn/end', { turn: 4, reason: { kind: 'error', error: { message: 'TIMEOUT', code: 'TIMEOUT' } } })
  const draft = readInterruptedReply(chat, session, 4)
  let queued = 0, queueFailure = true
  const agent = { session, phase: { kind: 'idle' }, inbox: { hasPending: false }, followup(message) {
    assert.equal(chat.interruptedReplyResume.text, draft.text)
    assert.equal(message.content[0].text, '原始玩家输入')
    if (queueFailure) throw Error('queue failed')
    queued++
  }, async whenIdle() {} }
  const options = { chats: { read: async () => structuredClone(chat), forSession: async () => structuredClone(chat), readCard: async () => ({}),
    update: async (_id, update) => { chat = await update(structuredClone(chat)) ?? chat; return chat } },
    sessions: { get: () => agent, flush: async () => {} }, scripts: {}, timeline: {}, present: async value => value }
  await assert.rejects(createRoundHistory(options).replayFailed('game', 'session', null, { turn: 4, digest: 'wrong' }), /已变化/)
  await assert.rejects(createRoundHistory(options).replayFailed('game', 'session', null, { turn: 4, digest: draft.digest }), /queue failed/)
  assert.equal(chat.interruptedReplyResume, null)
  assert.deepEqual(chat.suppressedDshTurns, [])
  queueFailure = false
  await createRoundHistory(options).replayFailed('game', 'session', null, { turn: 4, digest: draft.digest })
  assert.equal(queued, 1)
  assert.deepEqual(chat.messages, [])
  agent.inbox.hasPending = true
  await assert.rejects(createRoundHistory(options).replayFailed('game', 'session', null, { turn: 4, digest: draft.digest }), /已排队/)
  agent.inbox.hasPending = false
  await createRoundHistory(options).replayFailed('game', 'session', null, { turn: 4, digest: draft.digest })
  assert.equal(queued, 2, 'a durable marker whose turn never started can be recovered')
})
