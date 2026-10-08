import assert from 'node:assert/strict'
import test from 'node:test'
import {
  checkDreamSikeDraft, dreamSikeDraftView, dreamSikeTurnIdentity,
  inspectDreamSikeDraft, markDreamSikeDraftCommitted,
  patchDreamSikeDraft, putDreamSikeDraft, readyDreamSikeDraft,
  updateDreamSikeDraftProgress
} from '../tavern-plugin/lib/domain/dream-sike-draft.js'
import { registerDreamSikeTools } from '../tavern-plugin/lib/tools/dream-sike.js'

function fixture() {
  const chat = {
    id: 'chat-1', sessionId: 'session-1', mode: 'story', playPresetId: 'dream-sike-dsh',
    messages: [{ role: 'user', text: '开门' }], variables: { gold: 3 },
    timeline: {
      branchId: 'branch-1', revision: 4, participants: {},
      operations: {
        'operation-1': { id: 'operation-1', kind: 'body', status: 'running', turn: 5, basedOn: { branchId: 'branch-1', revision: 4 } }
      }
    }
  }
  return { chat, identity: dreamSikeTurnIdentity(chat, 'session-1', 5) }
}

test('草稿可零补丁通过检查，就绪后只由正式提交标记完成', () => {
  const { chat, identity } = fixture()
  const originalMessages = structuredClone(chat.messages)
  const originalVariables = structuredClone(chat.variables)
  assert.equal(putDreamSikeDraft(chat, identity, '门向内开了。', 10).version, 1)
  assert.deepEqual(checkDreamSikeDraft(chat, identity, 1, 20).checks.issues, [])
  assert.equal(readyDreamSikeDraft(chat, identity, 1, 30).status, 'ready')
  assert.deepEqual(chat.messages, originalMessages)
  assert.deepEqual(chat.variables, originalVariables)
  assert.equal(markDreamSikeDraftCommitted(chat, { turn: 5, operationId: 'operation-1' }, 40), true)
  assert.equal(dreamSikeDraftView(chat).status, 'committed')
})

test('局部修订要求唯一原文与正确版本，检查随修改失效，最多两轮', () => {
  const { chat, identity } = fixture()
  putDreamSikeDraft(chat, identity, '门开了。门开了。', 10)
  assert.throws(() => patchDreamSikeDraft(chat, identity, { expectedVersion: 1, find: '门开了', replacement: '门关了' }), /不唯一/)
  assert.equal(patchDreamSikeDraft(chat, identity, { expectedVersion: 1, find: '门开了。门开了。', replacement: '门开了一道缝。' }, 20).version, 2)
  checkDreamSikeDraft(chat, identity, 2, 30)
  assert.equal(patchDreamSikeDraft(chat, identity, { expectedVersion: 2, find: '一道缝', replacement: '半扇' }, 40).version, 3)
  assert.equal(chat.dreamSikeDraft.checks, null)
  assert.throws(() => readyDreamSikeDraft(chat, identity, 3), /先检查/)
  assert.throws(() => patchDreamSikeDraft(chat, identity, { expectedVersion: 2, find: '半扇', replacement: '一点' }), /版本已变化/)
  assert.throws(() => patchDreamSikeDraft(chat, identity, { expectedVersion: 3, find: '半扇', replacement: '一点' }), /最多进行两轮/)
  assert.equal(chat.dreamSikeDraft.changes[0].beforeText, '门开了。门开了。')
  assert.equal(chat.dreamSikeDraft.changes[1].afterText, '半扇')
  assert.equal(Object.hasOwn(dreamSikeDraftView(chat).changes[0], 'beforeText'), false)
  assert.equal(Object.hasOwn(dreamSikeDraftView(chat).changes[0], 'afterText'), false)
})

test('内部推理和变量协议不得进入最终正文，卡片 HTML 不被误判', () => {
  const { chat, identity } = fixture()
  assert.deepEqual(inspectDreamSikeDraft('<div class="card"><img src="cover.png"></div>'), [])
  putDreamSikeDraft(chat, identity, '<think>推理</think>门开了。<UpdateVariable>{}</UpdateVariable>', 10)
  const checked = checkDreamSikeDraft(chat, identity, 1, 20)
  assert.deepEqual(checked.checks.issues.map(value => value.code), ['private-protocol', 'state-protocol'])
  assert.throws(() => readyDreamSikeDraft(chat, identity, 1), /待处理/)
})

test('分支、模式、会话和回合版本变化拒绝过期草稿调用', () => {
  const { chat, identity } = fixture()
  putDreamSikeDraft(chat, identity, '旧分支正文', 10)
  assert.throws(() => dreamSikeTurnIdentity(chat, 'session-other', 5), /会话.*不一致/)
  chat.timeline.branchId = 'branch-2'
  assert.equal(dreamSikeDraftView(chat).status, 'stale')
  assert.throws(() => dreamSikeTurnIdentity(chat, 'session-1', 5), /没有唯一的运行中正文操作/)
  chat.playPresetId = 'legacy'
  assert.throws(() => dreamSikeTurnIdentity(chat, 'session-1', 5), /仅用于已启用/)
})

test('进度轨迹只保存简短摘要，可供正文工作窗读取', () => {
  const { chat, identity } = fixture()
  putDreamSikeDraft(chat, identity, '门开了。', 10)
  updateDreamSikeDraftProgress(chat, identity, { phase: 'planning', action: '检索门后人物设定' }, 20)
  const view = dreamSikeDraftView(chat)
  assert.equal(view.phase, 'planning')
  assert.equal(view.trace.at(-1).action, '检索门后人物设定')
  assert.equal(view.text, '门开了。')
})

test('原生 defineTool 注册五个草稿工具，读取、起草、检查、修订、确认只改草稿', async () => {
  const { chat } = fixture()
  const before = { messages: structuredClone(chat.messages), variables: structuredClone(chat.variables), timeline: structuredClone(chat.timeline) }
  let saved = structuredClone(chat)
  const registered = new Map()
  const writes = []
  const published = []
  registerDreamSikeTools({
    tools: { register(tool) { assert.equal(registered.has(tool.name), false); registered.set(tool.name, tool) } },
    async chatForSession(sessionId) { assert.equal(sessionId, 'session-1'); return structuredClone(saved) },
    async updateChat(chatId, mutation, metadata) {
      assert.equal(chatId, 'chat-1')
      const next = await mutation(structuredClone(saved))
      saved = structuredClone(next)
      writes.push(metadata.source)
      return structuredClone(saved)
    },
    activeTurnOf(exec) { return exec.agent.phase.turn },
    async publish(sessionId, view) { published.push({ sessionId, status: view.status, version: view.version }) }
  })
  const names = ['sike_read_turn', 'sike_put_draft', 'sike_patch_draft', 'sike_check_draft', 'sike_ready_draft']
  assert.deepEqual([...registered.keys()], names)
  for (const name of names) {
    const tool = registered.get(name)
    assert.equal(typeof tool.execute, 'function')
    assert.equal(tool.parameters.type, 'object')
    assert.equal(tool.output.schema.type, 'object')
    assert.deepEqual(tool.output.schema.required, ['report', 'draft'])
    assert.equal(tool.isConcurrencySafe({}), false)
  }

  const exec = { agent: { session: { id: 'session-1' }, phase: { kind: 'running', turn: 5 } } }
  const read = await registered.get('sike_read_turn').execute({}, exec)
  assert.equal(read.draft, null)
  assert.equal(JSON.parse(read.report).turn, 5)
  await assert.rejects(registered.get('sike_put_draft').execute({}, exec), /invalid arguments/)
  assert.equal(writes.length, 0)

  const put = await registered.get('sike_put_draft').execute({ text: '门向内开了。' }, exec)
  assert.equal(put.draft.version, 1)
  const firstCheck = await registered.get('sike_check_draft').execute({ expectedVersion: 1 }, exec)
  assert.deepEqual(firstCheck.draft.checks.issues, [])
  const patch = await registered.get('sike_patch_draft').execute({ expectedVersion: 1, find: '向内', replacement: '悄然' }, exec)
  assert.equal(patch.draft.version, 2)
  assert.equal(patch.draft.checks, null)
  const checked = await registered.get('sike_check_draft').execute({ expectedVersion: 2 }, exec)
  assert.deepEqual(checked.draft.checks.issues, [])
  const ready = await registered.get('sike_ready_draft').execute({ expectedVersion: 2 }, exec)
  assert.equal(ready.draft.status, 'ready')
  assert.equal(ready.draft.text, '门悄然开了。')
  assert.equal(saved.dreamSikeDraft.status, 'ready')
  assert.deepEqual(saved.messages, before.messages)
  assert.deepEqual(saved.variables, before.variables)
  assert.deepEqual(saved.timeline, before.timeline)
  assert.equal(saved.mvu, undefined)
  assert.deepEqual(writes, [
    'dream-sike.draft.put', 'dream-sike.draft.check', 'dream-sike.draft.patch',
    'dream-sike.draft.check', 'dream-sike.draft.ready'
  ])
  assert.equal(published.length, writes.length)
  assert.equal(registered.get('sike_ready_draft').output.render({}, ready)[0].type, 'text')
})
