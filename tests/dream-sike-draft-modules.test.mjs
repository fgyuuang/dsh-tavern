import assert from 'node:assert/strict'
import test from 'node:test'
import { compileDreamSikeContract } from '../tavern-plugin/lib/domain/dream-sike-contract.js'
import { putDreamSikeDraft, patchDreamSikeDraft, checkDreamSikeDraft, readyDreamSikeDraft, dreamSikeTurnIdentity } from '../tavern-plugin/lib/domain/dream-sike-draft.js'
import { createDreamSikeDraftModules, draftModuleReceiptCurrent, dreamSikeDraftModulePlan, inspectDraftModuleResult } from '../tavern-plugin/lib/domain/dream-sike-draft-modules.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { createBackgroundTaskCoordinator } from '../tavern-plugin/lib/domain/background-task-coordinator.js'

const parallelId = '807eefad-93ca-490c-a629-1d51038e3626', reviewId = '4e26a3ac-4d46-45ed-85bf-0110fbe06cd2'
const source = { front: { entries: [{ id: 'style', content: '保持作者文风，角色只知道亲历的事实。' }] }, back: { entries: [
  { id: parallelId, name: '平行事件', content: 'DREAM_PARALLEL_EVENT：原文人物信息差，1–3行地点|事件，含<br>。' },
  { id: reviewId, name: '自检修复', content: '# 检查范围\n原文检查人物、文风与认知。\n# 修复格式\n唯一定位修订。\n# 输出格式\n旧协议。' }
] } }
const main = '<dream_plot><dream_body>主线停在门口。</dream_body><dream_after_format></dream_after_format></dream_plot>'
const parallel = '<dream_parallel_event>钟楼|场外角色收好信件。<br>他仍不知道门口发生了什么。</dream_parallel_event>'
const review = Object.fromEntries(['character','knowledge','style','continuity','playerAgency','format'].map(axis => [axis, { status: 'pass', evidence: '正文停在门口与收信，人物信息各自受限，没有替玩家决定。' }]))
function fixture(t, model) {
  let chat = { id: 'c', sessionId: 's', cardName: '测试卡', playPresetId: 'dream-sike-dsh', mode: 'story', runtimePresetSnapshot: structuredClone(source), messages: [], variables: { hp: 10 },
    timeline: { schemaVersion: 1, branchId: 'b', revision: 4, checkpoints: [], participants: { background: { role: 'background', sessionId: 'bg', lifetime: 'chat', status: 'current', branchId: 'b', boundary: 4 } },
      operations: { op: { id: 'op', kind: 'body', turn: 2, status: 'running', basedOn: { branchId: 'b', revision: 4 }, userText: '开门' } } } }
  const identity = dreamSikeTurnIdentity(chat, 's', 2)
  putDreamSikeDraft(chat, identity, main)
  let calls = 0
  const read = async () => structuredClone(chat), update = async (_id, mutate) => { chat = await mutate(structuredClone(chat)); return chat }
  const tasks = createBackgroundTaskCoordinator({ timeline: createStoryTimeline(), store: { readChat: read, writeChat: async value => { chat = value }, updateChat: update } })
  const runner = createDreamSikeDraftModules({ read, update, tasks, selection: () => ({ model: 'mock' }), run: async input => {
    calls++; assert.equal(input.persistentSessionId, 'bg')
    if (model) return model(input)
    const isParallel = input.system.includes('作者模块：parallel')
    const response = await input.onToolCall({ name: 'sike_submit_module', arguments: { text: isParallel ? parallel : JSON.stringify(review) } })
    assert.equal(JSON.parse(response).ok, true)
    return { traceSessionId: 'bg', traceBoundary: 8 }
  } })
  t.after(() => runner.dispose())
  return { get: () => chat, set: value => { chat = value }, calls: () => calls, identity, runner,
    run: kind => runner.execute({ chat: structuredClone(chat), identity, kind, expectedVersion: chat.dreamSikeDraft.version }) }
}

test('作者模块从前台移交独立调用，完整原文与未启用模块保留', () => {
  const raw = structuredClone(source), compiled = compileDreamSikeContract(raw)
  assert.deepEqual(raw, source)
  assert.doesNotMatch(compiled.text, /原文人物信息差|唯一定位修订/)
  assert.equal(compiled.deferredDraft.entries[0].content, raw.back.entries[0].content)
  assert.equal(compiled.deferredDraft.entries[1].content, raw.back.entries[1].content)
  const again = compileDreamSikeContract({ ...compiled, agentContract: { ...compiled.agentContract, version: 8 } })
  assert.equal(again.deferredDraft.entries.length, 2, '版本迁移不能遗失已拆分模块')
  assert.equal(dreamSikeDraftModulePlan({ playPresetId: 'tavern', runtimePresetSnapshot: raw }, 'parallel'), null)
})

test('主线草稿→独立平行事件→独立审稿→整体确认；不提前提交正文或结算', async t => {
  const h = fixture(t)
  const variables = structuredClone(h.get().variables)
  assert.throws(() => readyDreamSikeDraft(h.get(), h.identity, 1), /先检查/)
  checkDreamSikeDraft(h.get(), h.identity, 1, Date.now(), review)
  assert.ok(h.get().dreamSikeDraft.checks.issues.some(issue => issue.code === 'module-parallel-pending'))
  await assert.rejects(h.run('review'), /先独立生成/)
  const result = await h.run('parallel')
  assert.equal(result.draft.version, 2)
  assert.equal(result.draft.revisionCount, 0)
  assert.equal(draftModuleReceiptCurrent(h.get(), 'parallel'), true)
  assert.match(result.draft.text, /主线停在门口/)
  assert.match(result.draft.text, /dream_parallel_event/)
  await h.run('review')
  checkDreamSikeDraft(h.get(), h.identity, 2)
  assert.deepEqual(h.get().dreamSikeDraft.checks.issues, [])
  assert.equal(readyDreamSikeDraft(h.get(), h.identity, 2).status, 'ready')
  assert.deepEqual(h.get().messages, [])
  assert.deepEqual(h.get().variables, variables)
  assert.equal(h.get().timeline.revision, 4)
  assert.equal(h.get().timeline.participants.background.sessionId, 'bg')
})

test('重复模块结果复用；主线修订后模块过期，禁止旧结果确认', async t => {
  const h = fixture(t)
  await h.run('parallel'); await h.run('review')
  assert.equal((await h.run('parallel')).reused, true)
  assert.equal((await h.run('review')).reused, true)
  assert.equal(h.calls(), 2)
  patchDreamSikeDraft(h.get(), h.identity, { expectedVersion: 2, find: '主线停在门口。', replacement: '主线停在庭院门外。' })
  assert.equal(draftModuleReceiptCurrent(h.get(), 'parallel'), false)
  checkDreamSikeDraft(h.get(), h.identity, 3, Date.now(), review)
  assert.ok(h.get().dreamSikeDraft.checks.issues.some(issue => issue.code === 'module-review-pending'))
  await h.run('parallel'); await h.run('review')
  checkDreamSikeDraft(h.get(), h.identity, 4)
  assert.equal(readyDreamSikeDraft(h.get(), h.identity, 4).status, 'ready')
  assert.equal(h.get().dreamSikeDraft.revisionCount, 1)
})

test('过期模块、取消与失败不能改写当前草稿或变量', async t => {
  let release
  const h = fixture(t, async input => {
    await new Promise(resolve => { release = resolve })
    await input.onToolCall({ name: 'sike_submit_module', arguments: { text: parallel } })
    return { traceSessionId: 'bg', traceBoundary: 8 }
  })
  const pending = h.run('parallel')
  while (!release) await new Promise(resolve => setTimeout(resolve, 1))
  const next = structuredClone(h.get()); next.dreamSikeDraft.text = '新草稿'; next.dreamSikeDraft.version++; h.set(next)
  release(); await assert.rejects(pending, /拒绝过期/)
  assert.equal(h.get().dreamSikeDraft.text, '新草稿')
  assert.equal(h.get().variables.hp, 10)
})

test('原生合并保持 HTML 字符字面值，不把 $& 作为正则替换', async t => {
  const literal = parallel.replace('信件', '$&信件')
  const h = fixture(t, async input => { await input.onToolCall({ name: 'sike_submit_module', arguments: { text: literal } }); return { traceSessionId: 'bg', traceBoundary: 8 } })
  await h.run('parallel')
  assert.ok(h.get().dreamSikeDraft.text.includes(literal))
  assert.throws(() => inspectDraftModuleResult('parallel', '<dream_parallel_event>缺少换行</dream_parallel_event>'), /1–3/)
  assert.throws(() => inspectDraftModuleResult('review', JSON.stringify({ character: { status: 'pass', evidence: '太短' } })), /六项/)
})

test('独立平行合并保护角色卡脚本中的协议字面值', async t => {
  const h = fixture(t)
  const code = '<script>const example="<dream_parallel_event>脚本示例</dream_parallel_event>";const end="</dream_after_format>";</script>'
  h.get().dreamSikeDraft.text = code + main
  await h.run('parallel')
  assert.ok(h.get().dreamSikeDraft.text.startsWith(code))
  assert.equal(draftModuleReceiptCurrent(h.get(), 'parallel'), true)
  assert.equal(h.get().dreamSikeDraft.text.split(parallel).length - 1, 1)
})

test('取消独立调用保留草稿，没有正式消息或变量变动', async t => {
  let release
  const h = fixture(t, async input => { await new Promise(resolve => { release = resolve }); return { traceSessionId: 'bg', traceBoundary: 8 } })
  const controller = new AbortController()
  const pending = h.runner.execute({ chat: structuredClone(h.get()), identity: h.identity, kind: 'parallel', expectedVersion: 1, signal: controller.signal })
  while (!release) await new Promise(resolve => setTimeout(resolve, 1))
  controller.abort(); release()
  await assert.rejects(pending, /abort/i)
  assert.equal(h.get().dreamSikeDraft.text, main)
  assert.deepEqual(h.get().messages, [])
  assert.equal(h.get().variables.hp, 10)
})

test('变量或本局世界书改变后，不复用旧独立模块结果', async t => {
  const h = fixture(t)
  await h.run('parallel')
  assert.equal(draftModuleReceiptCurrent(h.get(), 'parallel'), true)
  h.get().variables.hp = 9
  assert.equal(draftModuleReceiptCurrent(h.get(), 'parallel'), false)
  await h.run('parallel')
  assert.equal(draftModuleReceiptCurrent(h.get(), 'parallel'), true)
  h.get().openingWorldbookSnapshot = { document: { entries: [{ uid: 1, enabled: true, content: '更新的世界事实' }] } }
  assert.equal(draftModuleReceiptCurrent(h.get(), 'parallel'), false)
})
