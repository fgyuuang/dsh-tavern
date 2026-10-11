import assert from 'node:assert/strict'
import test from 'node:test'
import { dreamSikeTurnIdentity, putDreamSikeDraft, checkDreamSikeDraft, readyDreamSikeDraft, dreamSikeDraftView, carryDreamSikeDraftIntoTurn } from '../tavern-plugin/lib/domain/dream-sike-draft.js'
import { recordDreamSikeTurnRead, prepareDreamSikeTurn, needsDreamSikePreparation } from '../tavern-plugin/lib/domain/dream-sike-preparation.js'
import { registerDreamSikeTools } from '../tavern-plugin/lib/tools/dream-sike.js'
import { registerTurnLifecycleHooks } from '../tavern-plugin/lib/hooks/turn-lifecycle.js'

const brief = () => ({ scene: '钟楼门口，下午两点，只完成交接。', characters: '档案员谨慎追问，保持职业边界。', knowledge: '封信未拆开，人物不知道信件内容。', style: '节制口语与动作描写，保留当前视角。', progression: '完成递信并提出核对收件人的问题。', stopAt: '停在追问后，保留玩家如何回应的选择。' })
const review = () => Object.fromEntries(['character', 'knowledge', 'style', 'continuity', 'playerAgency', 'format'].map(key => [key, { status: 'pass', evidence: '正文停在交接后的询问，未展开下一步玩家行动。' }]))
test('原聊天和大总结输出不要求剧情准备或六维剧情审阅', () => {
  for (const id of ['e8e8b082-e3ca-4d4d-afe9-d5632b3b38e0', 'dc9d8c8f-2588-47d9-ba16-aa42306c6726']) {
    const { chat, identity } = fixture()
    chat.runtimePresetSnapshot.front.entries.push({ id, content: '本轮免除故事协议' })
    assert.equal(needsDreamSikePreparation(chat), false)
    putDreamSikeDraft(chat, identity, '这是按当前选择模式整理的回复。')
    checkDreamSikeDraft(chat, identity, 1)
    assert.equal(readyDreamSikeDraft(chat, identity, 1).status, 'ready')
  }
})
function fixture() {
  const chat = { id: 'c', sessionId: 's', playPresetId: 'dream-sike-dsh', mode: 'story', messages: [], variables: {},
    runtimePresetSnapshot: { front: { entries: [{ id: '0da6f4d7-961d-4966-a084-857a3dd876ad', content: 'original enabled planning' }] } },
    timeline: { branchId: 'b', revision: 1, operations: { op: { id: 'op', kind: 'body', status: 'running', turn: 1, basedOn: { branchId: 'b', revision: 1 } } } } }
  return { chat, identity: dreamSikeTurnIdentity(chat, 's', 1) }
}
test('enabled planning requires an actual read followed by a brief before drafting; no story or variables are changed', () => {
  const { chat, identity } = fixture()
  assert.equal(needsDreamSikePreparation(chat), true)
  assert.throws(() => putDreamSikeDraft(chat, identity, '她接过信，问：“交给谁？”'), /sike_prepare_turn/)
  assert.throws(() => prepareDreamSikeTurn(chat, identity, brief()), /先用 sike_read_turn/)
  recordDreamSikeTurnRead(chat, identity, 10)
  assert.throws(() => putDreamSikeDraft(chat, identity, '她接过信。'), /sike_prepare_turn/)
  prepareDreamSikeTurn(chat, identity, brief(), 20)
  putDreamSikeDraft(chat, identity, '她接过信，问：“交给谁？”', 30)
  checkDreamSikeDraft(chat, identity, 1, { review: review() })
  assert.equal(readyDreamSikeDraft(chat, identity, 1).status, 'ready')
  assert.deepEqual(dreamSikeDraftView(chat).preparation.brief, brief())
  assert.deepEqual(chat.messages, [])
  assert.deepEqual(chat.variables, {})
})
test('preparation rejects missing fields, excessive prose and reasoning protocol; receipt identifies truncated materials', () => {
  const { chat, identity } = fixture()
  chat.preparedWorldBookContext = '书'.repeat(5000)
  const read = recordDreamSikeTurnRead(chat, identity)
  assert.equal(read.materials.worldbookTruncated, true)
  for (const value of [{ ...brief(), scene: '短' }, { ...brief(), scene: '字'.repeat(401) }, { ...brief(), scene: '<think>完整思考过程</think>' }, { ...brief(), reasoning: '额外字段' }]) {
    assert.throws(() => prepareDreamSikeTurn(chat, identity, value))
  }
  assert.equal(chat.dreamSikePreparation.brief, null)
})
test('changed contract, branch, operation and turn cannot reuse a read or preparation', () => {
  for (const change of [i => ({ ...i, branchId: 'other' }), i => ({ ...i, turn: 2 }), i => ({ ...i, operationId: 'new' })]) {
    const { chat, identity } = fixture()
    recordDreamSikeTurnRead(chat, identity)
    prepareDreamSikeTurn(chat, identity, brief())
    assert.throws(() => putDreamSikeDraft(chat, change(identity), '正文'), /sike_prepare_turn/)
  }
  const { chat, identity } = fixture()
  recordDreamSikeTurnRead(chat, identity)
  prepareDreamSikeTurn(chat, identity, brief())
  putDreamSikeDraft(chat, identity, '她接过信，问：“交给谁？”')
  checkDreamSikeDraft(chat, identity, 1, { review: review() })
  readyDreamSikeDraft(chat, identity, 1)
  chat.runtimePresetSnapshot.front.entries.push({ id: 'style', content: '新的本局写规' })
  assert.throws(() => readyDreamSikeDraft(chat, identity, 1), /规则已变化/)
  assert.throws(() => prepareDreamSikeTurn(chat, identity, brief()), /先用 sike_read_turn/)
})
test('updated brief invalidates review; retry of identical brief does not invalidate ready state', () => {
  const { chat, identity } = fixture()
  recordDreamSikeTurnRead(chat, identity)
  prepareDreamSikeTurn(chat, identity, brief())
  putDreamSikeDraft(chat, identity, '她接过信。')
  checkDreamSikeDraft(chat, identity, 1, { review: review() })
  readyDreamSikeDraft(chat, identity, 1)
  prepareDreamSikeTurn(chat, identity, brief())
  assert.equal(chat.dreamSikeDraft.status, 'ready')
  prepareDreamSikeTurn(chat, identity, { ...brief(), style: '采用新的克制视角，不解释所有人物心理。' })
  assert.equal(chat.dreamSikeDraft.status, 'draft')
  assert.equal(chat.dreamSikeDraft.checks, null)
  assert.throws(() => readyDreamSikeDraft(chat, identity, 1), /先检查/)
})
test('enabled planning tools enforce read/prepare in the registered native tool loop', async () => {
  const { chat } = fixture(), registered = new Map()
  registerDreamSikeTools({ tools: { register(t) { registered.set(t.name, t) } }, chatForSession: async () => chat, updateChat: async (_id, mutate) => mutate(chat), activeTurnOf: () => 1 })
  const exec = { agent: { session: { id: 's' } } }
  await assert.rejects(registered.get('sike_put_draft').execute({ text: '她接过信。' }, exec), /sike_prepare_turn/)
  const read = JSON.parse((await registered.get('sike_read_turn').execute({}, exec)).report)
  assert.equal(read.preparationRequired, true)
  assert.equal(read.preparation.brief, null)
  await registered.get('sike_prepare_turn').execute({ brief: brief() }, exec)
  await registered.get('sike_put_draft').execute({ text: '她接过信。' }, exec)
  await registered.get('sike_check_draft').execute({ expectedVersion: 1, review: review() }, exec)
  assert.equal((await registered.get('sike_ready_draft').execute({ expectedVersion: 1 }, exec)).draft.status, 'ready')
})
test('failure recovery rebinds the same prepared draft, including after persistence reload', () => {
  const { chat, identity } = fixture()
  recordDreamSikeTurnRead(chat, identity)
  prepareDreamSikeTurn(chat, identity, brief())
  putDreamSikeDraft(chat, identity, '她接过信。')
  checkDreamSikeDraft(chat, identity, 1, { review: review() })
  readyDreamSikeDraft(chat, identity, 1)
  const saved = JSON.parse(JSON.stringify(chat))
  saved.dreamSikeResume = { nextTurn: 2, sessionId: 's', branchId: 'b', storyRevision: 1, sourceOperationId: 'op', sourceVersion: 1, failedTurn: 1 }
  const next = { ...identity, turn: 2, operationId: 'op2' }
  carryDreamSikeDraftIntoTurn(saved, next)
  assert.equal(readyDreamSikeDraft(saved, next, 1).status, 'ready')
  assert.equal(saved.dreamSikePreparation.operationId, 'op2')
})
test('disabling the source planning rule or using another preset does not impose planning', () => {
  const { chat, identity } = fixture()
  chat.runtimePresetSnapshot.front.entries[0].enabled = false
  assert.equal(needsDreamSikePreparation(chat), false)
  putDreamSikeDraft(chat, identity, '她接过信。')
  chat.playPresetId = 'tavern'
  assert.equal(needsDreamSikePreparation(chat), false)
})

test('stopping hook repairs stale ready drafts instead of declaring success or committing them', async () => {
  const { chat, identity } = fixture()
  recordDreamSikeTurnRead(chat, identity)
  prepareDreamSikeTurn(chat, identity, brief())
  putDreamSikeDraft(chat, identity, '她接过信。')
  checkDreamSikeDraft(chat, identity, 1, { review: review() })
  readyDreamSikeDraft(chat, identity, 1)
  const hooks = new Map(), steering = [], commits = []
  registerTurnLifecycleHooks({
    ctx: { on(name, handler) { hooks.set(name, handler) } },
    backgroundAgentRunner: { requestContext() {}, owns() { return false } },
    fullTemplateRuntime: { cancel() {} }, clearRuntimePresetRequestState() {},
    chatForSession: async () => chat,
    userMessageForTurn: () => ({ content: [{ type: 'text', text: '递信' }] }),
    contentText: () => '递信', requestIdForTurn: () => 'req',
    foregroundHandoff: { async finalize(input) { commits.push(input); return {} } }
  })
  const agent = { session: { id: 's', events: [{ type: 'turn/start', data: { turn: 1 } },
    { type: 'assistant/message', data: { turn: 1, message: { source: { kind: 'model' }, content: [{ type: 'text', text: '完成。' }] } } }] }, phase: { step: 7 }, steer(message) { steering.push(message) } }
  await hooks.get('agent/turn-stopping')({ agent, turn: 1 })
  assert.equal(commits.length, 1)
  assert.equal(steering.length, 0)
  delete chat.dreamSikeDraft.preparation
  delete chat.dreamSikePreparation
  await hooks.get('agent/turn-stopping')({ agent, turn: 1 })
  assert.equal(commits.length, 1)
  assert.match(steering.at(-1).content[0].text, /sike_prepare_turn/)
  assert.doesNotMatch(steering.at(-1).content[0].text, /草稿已确认/)
  assert.equal(chat.dreamSikeDraft.status, 'ready') // validation was read-only
})
