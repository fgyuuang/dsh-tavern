import assert from 'node:assert/strict'
import test from 'node:test'
import { compileDreamSikeContract, inspectDreamSikeContractDraft } from '../tavern-plugin/lib/domain/dream-sike-contract.js'
import { createDreamSikeFollowups, dreamSikeFollowupPlan, dreamSikeFollowupView, inspectDreamSikeFollowup } from '../tavern-plugin/lib/domain/dream-sike-followup.js'
import { createBackgroundTaskCoordinator } from '../tavern-plugin/lib/domain/background-task-coordinator.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const optionId = '11cdd506-1513-4008-b6b9-c883dbad65c5', discussId = '27bf435f-4283-4937-8c6f-3c31abc4f6d2'
const entry = (id, name, content) => ({ id, name, content, enabled: true, source: { identifier: id } })
const question = '<dream_big_discuss>对齐剧情方向。<q content="准备去哪？"><a>庭院</a><a>图书馆</a><a>等候</a></q></dream_big_discuss>'
const choices = '<dream_option>开门|问路|看信|等候|交谈|离开</dream_option>'
const valid = question + '\n\n' + choices
function source() { return { presetName: '作者原预设', front: { entries: [entry('style', '作者文风', '沿用作者的文风。')] }, back: { entries: [
  entry(optionId, '原行动选项', 'AUTHOR_OPTIONS：选项数量为6个。'), entry(discussId, '原思客大调查', 'AUTHOR_DISCUSS：按原协议提问。')
] } } }
function chat() { return { id: 'game', sessionId: 'session', mode: 'story', playPresetId: 'dream-sike-dsh', cardPath: 'cards/test.json', cardName: '测试卡',
  runtimePresetSnapshot: source(), macroState: { userName: '玩家' }, settleStatus: 'done', _storageRevision: 1,
  messages: [{ role: 'user', text: '打开门。' }, { role: 'assistant', turn: 2, text: '<dream_body>正文已提交。</dream_body>', sourceText: '<dream_body>正文已提交。</dream_body>', variables: [{ hp: 8 }] }],
  timeline: { schemaVersion: 1, branchId: 'branch', revision: 5, operations: {}, checkpoints: [], participants: { background: { role: 'background', lifetime: 'chat', sessionId: 'background', branchId: 'branch', boundary: 4, status: 'current' } } } } }
async function until(condition) { for (let i = 0; i < 300; i++) { if (condition()) return; await new Promise(resolve => setTimeout(resolve, 5)) } throw new Error('test timed out') }
function harness(t, model) {
  let state = chat(), calls = 0
  const read = async () => structuredClone(state)
  const update = async (_id, mutate) => { state = await mutate(structuredClone(state)); state._storageRevision++; return structuredClone(state) }
  const tasks = createBackgroundTaskCoordinator({ timeline: createStoryTimeline(), store: { readChat: read, writeChat: async next => { state = next }, updateChat: update } })
  const pipeline = createDreamSikeFollowups({ read, update, tasks, selection: () => ({ model: 'mock' }),
    project: async text => ({ displayText: text, displayMode: 'markdown', displayParts: [{ kind: 'markdown', text }], warnings: [] }),
    run: async input => { calls++; if (model) return model(input, calls); assert.equal(input.persistentSessionId, 'background'); assert.match(input.turnContext, /"hp":8/); assert.match(input.system, /AUTHOR_DISCUSS/);
      assert.equal(input.tools.length, 1); assert.equal(JSON.parse(await input.onToolCall({ name: 'sike_submit_followup', arguments: { text: valid } })).ok, true);
      return { traceSessionId: 'background', traceBoundary: 8, text: '' } }
  })
  t.after(() => pipeline.dispose())
  return { pipeline, get: () => state, set: next => { state = next }, calls: () => calls }
}

test('前台保留作者写法，将选中模块移交后续调用；原资源和原版不改变', () => {
  const original = source(), before = structuredClone(original), compiled = compileDreamSikeContract(original)
  assert.deepEqual(original, before)
  assert.match(compiled.text, /沿用作者的文风/)
  assert.doesNotMatch(compiled.text, /AUTHOR_OPTIONS|AUTHOR_DISCUSS/)
  assert.deepEqual(compiled.deferredFollowup.entries.map(e => e.content), before.back.entries.map(e => e.content))
  assert.match(compiled.agentContract.instruction, /变量和记忆结算完成后的独立后台调用/)
  assert.ok(inspectDreamSikeContractDraft(chat(), valid).some(issue => issue.code === 'preset-deferred-followup'))
  assert.deepEqual(inspectDreamSikeContractDraft(chat(), '<script>const sample="<dream_option>示例</dream_option>"</script>正文'), [])
  assert.equal(dreamSikeFollowupPlan({ ...chat(), playPresetId: 'tavern' }), null)
  const nonPlot = source(); nonPlot.back.entries.push(entry('dc9d8c8f-2588-47d9-ba16-aa42306c6726', '聊天', '聊天模式'))
  assert.equal(compileDreamSikeContract(nonPlot).deferredFollowup.entries.length, 0)
})

test('保留作者6项和共创协议，后续不输出新正文或变量；共创显示在行动选项之前', () => {
  const plan = dreamSikeFollowupPlan(chat())
  assert.equal(inspectDreamSikeFollowup(choices + '\n' + question, plan), valid)
  for (const text of [choices, '<dream_body>新剧情</dream_body>' + valid, valid + '<UpdateVariable>更新</UpdateVariable>', valid + '另外继续正文。', valid.replace('开门|', '')]) {
    assert.throws(() => inspectDreamSikeFollowup(text, plan))
  }
  const disabled = chat(); disabled.runtimePresetSnapshot.back.entries.forEach(e => { e.enabled = false })
  assert.equal(dreamSikeFollowupPlan(disabled), null)
})

test('正文→结算→后续调用，重复唤醒只调用一次且不增加正式消息或再次更新变量', async t => {
  const h = harness(t); h.get().settleStatus = 'pending'
  const messages = structuredClone(h.get().messages)
  await h.pipeline.wait('game'); await h.pipeline.start('game')
  assert.equal(h.calls(), 0); assert.equal(h.get().dreamSikeFollowup.status, 'queued')
  assert.equal(h.get().dreamSikeFollowup.waitingForSettlement, true)
  h.get().settleStatus = 'done'
  await Promise.all([h.pipeline.start('game'), h.pipeline.start('game')])
  await until(() => h.get().dreamSikeFollowup.status === 'done')
  assert.equal(h.calls(), 1); assert.deepEqual(h.get().messages, messages)
  assert.equal(h.get().timeline.revision, 5)
  assert.equal(h.get().timeline.participants.background.sessionId, 'background')
  await h.pipeline.start('game'); assert.equal(h.calls(), 1)
  assert.equal(dreamSikeFollowupView(h.get()).projection.text, valid)
})

test('后续生成失败只标记面板失败，允许独立重试而不重新提交正文', async t => {
  const h = harness(t, async (input, call) => {
    if (call === 1) throw new Error('mock network failure')
    await input.onToolCall({ name: 'sike_submit_followup', arguments: JSON.stringify({ text: valid }) })
    return { traceSessionId: 'background', traceBoundary: 8 }
  })
  await h.pipeline.start('game'); await until(() => h.get().dreamSikeFollowup.status === 'failed')
  assert.equal(h.get().messages.length, 2); assert.equal(h.get().settleStatus, 'done')
  await h.pipeline.start('game'); assert.equal(h.calls(), 1)
  await h.pipeline.start('game', { force: true }); await until(() => h.get().dreamSikeFollowup.status === 'done')
  assert.equal(h.calls(), 2); assert.equal(h.get().messages.length, 2)
})

test('正文或分支变化后拒绝迟到结果，旧面板不能覆盖新回合', async t => {
  let release, entered
  const started = new Promise(resolve => { entered = resolve })
  const h = harness(t, async input => { entered(); await new Promise(resolve => { release = resolve }); await input.onToolCall({ name: 'sike_submit_followup', arguments: { text: valid } }); return { traceSessionId: 'background', traceBoundary: 8 } })
  await h.pipeline.start('game'); await started
  const next = structuredClone(h.get()); next.timeline.branchId = 'new-branch'; next.timeline.revision++
  next.messages[1].sourceText = '新正文'; next.messages[1].text = '新正文'; next.dreamSikeFollowup = null; h.set(next)
  release(); await until(() => Object.values(h.get().timeline.operations).every(op => op.status !== 'running'))
  assert.equal(h.get().dreamSikeFollowup, null); assert.equal(h.get().messages[1].text, '新正文')
})

test('恢复仅处理持久未完成任务，不给旧存档补发模型调用', async t => {
  const h = harness(t)
  await h.pipeline.recover(['game']); assert.equal(h.calls(), 0)
  h.get().dreamSikeFollowup = { ...dreamSikeFollowupPlan(h.get()), status: 'queued' }
  await h.pipeline.recover(['game']); await until(() => h.get().dreamSikeFollowup.status === 'done')
  assert.equal(h.calls(), 1)
  await h.pipeline.recover(['game']); assert.equal(h.calls(), 1)
})

test('原生存储的轻量会话状态与冷启动保留后续产物，不能因变量刷新消失', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tavern-followup-native-storage-'))
  const store = createChatJournalStore({ dataRoot: root, newConversations: true })
  const persistence = createChatPersistence({ store })
  const state = chat(), plan = dreamSikeFollowupPlan(state)
  delete state._storageRevision
  const { rules, variables, ...savedPlan } = plan
  state.dreamSikeFollowup = { ...savedPlan, status: 'done', projection: { text: valid, parts: [{ kind: 'markdown', text: valid }] } }
  const saved = await persistence.write(state)
  assert.equal((await store.readSessionState('game')).dreamSikeFollowup.projection.text, valid)
  await persistence.patch('game', saved._storageRevision, [{ op: 'set', path: ['messages', 1, 'variables', 0, 'hp'], value: 9 }])
  const restarted = createChatJournalStore({ dataRoot: root })
  assert.equal((await restarted.readSessionState('game')).dreamSikeFollowup.projection.text, valid)
})

for (const kind of ['variables', 'preset']) test('后续调用期间' + kind + '变化，拒绝旧结果并保留单独重试入口', async t => {
  let release, entered
  const started = new Promise(resolve => { entered = resolve })
  const h = harness(t, async input => { entered(); await new Promise(resolve => { release = resolve }); await input.onToolCall({ name: 'sike_submit_followup', arguments: { text: valid } }); return { traceSessionId: 'background', traceBoundary: 8 } })
  await h.pipeline.start('game'); await started
  const next = structuredClone(h.get())
  if (kind === 'variables') next.messages[1].variables[0].hp = 9
  else next.runtimePresetSnapshot.back.entries[0].content += '\n新作者要求'
  h.set(next); release()
  await until(() => h.get().dreamSikeFollowup.status === 'failed')
  assert.equal(h.get().dreamSikeFollowup.projection, null)
  assert.equal(h.get().messages[1].sourceText, '<dream_body>正文已提交。</dream_body>')
  if (kind === 'variables') assert.equal(h.get().messages[1].variables[0].hp, 9)
})

test('玩家下一回合可以取消未完成后续生成，释放后台且不重复结算', async t => {
  let entered
  const started = new Promise(resolve => { entered = resolve })
  const h = harness(t, async input => new Promise((resolve, reject) => {
    input.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true }); entered()
  }))
  const messages = structuredClone(h.get().messages)
  await h.pipeline.start('game'); await started
  assert.equal(await h.pipeline.cancel('game'), true)
  assert.equal(h.get().dreamSikeFollowup.status, 'failed')
  assert.match(h.get().dreamSikeFollowup.error, /下一回合/)
  assert.ok(Object.values(h.get().timeline.operations).every(operation => operation.status !== 'running'))
  assert.deepEqual(h.get().messages, messages)
  assert.equal(h.get().settleStatus, 'done')
})
