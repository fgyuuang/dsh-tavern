import assert from 'node:assert/strict'
import test from 'node:test'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import {
  carryDreamSikeDraftIntoTurn, checkDreamSikeDraft, dreamSikeTurnIdentity,
  planDreamSikeDraftResume, putDreamSikeDraft, readyDreamSikeDraft
} from '../tavern-plugin/lib/domain/dream-sike-draft.js'
import { createRoundHistory } from '../tavern-plugin/lib/domain/round-history.js'
import { selectPlayPreset } from '../tavern-plugin/lib/domain/dream-sike-mode.js'

function failedDraft() {
  let sequence = 0
  const timeline = createStoryTimeline({ id: prefix => prefix + '-' + ++sequence })
  let chat = {
    id: 'chat', sessionId: 'session', mode: 'story', playPresetId: 'dream-sike-dsh',
    cardPath: 'card.json', messages: [{ role: 'assistant', greeting: true, text: '开场' }]
  }
  const begun = timeline.apply({ chat, intent: { kind: 'body.begin', turn: 2, userText: '推门' } })
  chat = begun.chat
  const identity = dreamSikeTurnIdentity(chat, 'session', 2)
  putDreamSikeDraft(chat, identity, '门向内开了。', 10)
  checkDreamSikeDraft(chat, identity, 1, 20)
  readyDreamSikeDraft(chat, identity, 1, 30)
  chat = timeline.complete({ chat, operationId: begun.value.operationId, basedOn: begun.value.basedOn, outcome: { status: 'failed' } }).chat
  return { chat, timeline, identity }
}

test('失败回合草稿重绑到下一原生回合，保留正文、检查和已确认状态', () => {
  let { chat, timeline, identity } = failedDraft()
  const marker = planDreamSikeDraftResume(chat, { failedTurn: 2, expectedOperationId: identity.operationId, expectedVersion: 1 })
  chat.dreamSikeResume = marker
  const next = timeline.apply({ chat, intent: { kind: 'body.begin', turn: 3, userText: '推门' } })
  chat = next.chat
  const carried = carryDreamSikeDraftIntoTurn(chat, {
    chatId: chat.id, sessionId: chat.sessionId, turn: 3,
    operationId: next.value.operationId,
    branchId: next.value.basedOn.branchId,
    storyRevision: next.value.basedOn.revision
  }, 40)
  assert.equal(carried, true)
  assert.equal(chat.dreamSikeDraft.status, 'ready')
  assert.equal(chat.dreamSikeDraft.text, '门向内开了。')
  assert.equal(chat.dreamSikeDraft.checks.version, 1)
  assert.deepEqual(chat.dreamSikeDraft.resumedFrom, { turn: 2, operationId: identity.operationId })
  assert.equal(chat.dreamSikeResume, undefined)
  assert.equal(chat.messages.length, 1)
  assert.equal(carryDreamSikeDraftIntoTurn(chat, { turn: 3 }), false)
})

test('续写拒绝过期版本、不同分支和错误的新回合', () => {
  const { chat, identity, timeline } = failedDraft()
  const requested = { failedTurn: 2, expectedOperationId: identity.operationId, expectedVersion: 1 }
  assert.throws(() => planDreamSikeDraftResume(chat, { ...requested, expectedVersion: 2 }), /版本/)
  assert.throws(() => planDreamSikeDraftResume(chat, { ...requested, expectedOperationId: 'other' }), /版本/)
  const marker = planDreamSikeDraftResume(chat, requested)
  chat.dreamSikeResume = marker
  const next = timeline.apply({ chat, intent: { kind: 'body.begin', turn: 3, userText: '推门' } })
  assert.throws(() => carryDreamSikeDraftIntoTurn(next.chat, {
    chatId: next.chat.id, sessionId: 'session', turn: 4, operationId: next.value.operationId,
    branchId: next.value.basedOn.branchId, storyRevision: next.value.basedOn.revision
  }), /不一致/)
  assert.equal(next.chat.dreamSikeDraft.turn, 2)
  chat.timeline.branchId = 'other-branch'
  assert.throws(() => planDreamSikeDraftResume(chat, requested), /分支/)
})

test('续写重放在途时不可切换预设；崩溃后空闲切换清掉旧续写标记', () => {
  const { chat, identity } = failedDraft()
  chat.dreamSikeResume = planDreamSikeDraftResume(chat, {
    failedTurn: 2, expectedOperationId: identity.operationId, expectedVersion: 1
  })
  assert.throws(() => selectPlayPreset(chat, 'tavern', {
    foregroundIdle: true, backgroundIdle: true, replayIdle: false
  }), /等待/)
  const switching = selectPlayPreset(chat, 'tavern', {
    foregroundIdle: true, backgroundIdle: true, replayIdle: true
  })
  assert.equal(switching.patch.dreamSikeResume, null)
  assert.equal(chat.dreamSikeResume.sourceVersion, 1)
})

test('失败回合重放会保存一次续写标记并复用原玩家输入', async () => {
  let { chat, identity, timeline } = failedDraft()
  const events = []
  const session = { id: 'session', events, surface: { nodes: [] }, append(type, data, options = {}) {
    const seq = events.length
    events.push({ seq, type, data, ...options })
    if (options.surfaceOp === 'append') session.surface.nodes.push(seq)
    else if (options.surfaceOp?.op === 'replace') {
      const start = session.surface.nodes.indexOf(options.surfaceOp.start)
      const end = session.surface.nodes.indexOf(options.surfaceOp.end)
      assert.ok(start >= 0 && end >= start)
      session.surface.nodes.splice(start, end - start + 1, seq)
    }
    return { seq }
  } }
  session.append('turn/start', { turn: 2 })
  session.append('user/message', { id: 'player', role: 'user', content: [{ type: 'text', text: '推门' }], source: { kind: 'user', rpcId: 'player-rpc' } }, { surfaceOp: 'append' })
  session.append('turn/end', { turn: 2, reason: { kind: 'error' } })
  let replayInput
  const agent = { session, phase: { kind: 'idle' }, followup(message) { replayInput = message }, async whenIdle() {} }
  const options = {
    chats: {
      read: async () => structuredClone(chat), forSession: async () => structuredClone(chat),
      readCard: async () => ({ name: '角色' }),
      update: async (_id, change) => { chat = await change(structuredClone(chat)) ?? chat; return structuredClone(chat) }
    },
    sessions: { get: () => agent, flush: async () => {} },
    scripts: { read: async () => undefined, continuity: {} },
    timeline, queueSettlement: async () => {}, cancelSettlement: async () => {},
    present: async value => structuredClone(value)
  }
  const history = createRoundHistory(options)
  const result = await history.replayFailed('chat', 'session', { expectedOperationId: identity.operationId, expectedVersion: 1 })
  assert.equal(result.resumedDraft.version, 1)
  assert.equal(chat.dreamSikeResume.sourceOperationId, identity.operationId)
  assert.deepEqual(chat.suppressedDshTurns, [2])
  assert.equal(replayInput.content[0].text, '推门')
  assert.equal(replayInput.source.kind, 'user')
  assert.equal(chat.messages.length, 1)
  // Simulate a crash after the marker/suppression write but before the
  // followup reaches a durable turn/start. The next process may queue once.
  replayInput = undefined
  agent.inbox = { hasPending: true }
  await assert.rejects(createRoundHistory(options).replayFailed('chat', 'session', {
    expectedOperationId: identity.operationId, expectedVersion: 1
  }), /已排队/)
  agent.inbox.hasPending = false
  const recovered = await createRoundHistory(options).replayFailed('chat', 'session', {
    expectedOperationId: identity.operationId, expectedVersion: 1
  })
  assert.equal(recovered.resumedDraft.fromTurn, 2)
  assert.equal(replayInput.content[0].text, '推门')
  assert.equal(chat.messages.length, 1)
})
