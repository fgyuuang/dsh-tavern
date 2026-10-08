import assert from 'node:assert/strict'
import test from 'node:test'
import { createTavernConversationRegistry } from '../tavern-plugin/lib/domain/tavern-conversation-registry.js'

function memoryStore(seed = {}) {
  let links = structuredClone(seed.links || {})
  let index = structuredClone(seed.index || { chats: [] })
  const chats = new Map(Object.entries(structuredClone(seed.chats || {})))
  const failures = seed.failures || {}
  let chatReads = 0
  let linkUpdates = 0
  return {
    adapter: {
      async readLinks() { return structuredClone(links) },
      async updateLinks(updater) {
        linkUpdates += 1
        const result = await updater(structuredClone(links))
        if (result !== undefined) links = structuredClone(result)
      },
      async readIndex() { return structuredClone(index) },
      async writeIndex(value) {
        if (failures.writeIndex) throw new Error(failures.writeIndex)
        index = structuredClone(value)
      },
      async readChat(id) {
        chatReads += 1
        if (failures.readChat) throw new Error(failures.readChat)
        return chats.has(id) ? structuredClone(chats.get(id)) : undefined
      },
      async writeChat(chat) { chats.set(chat.id, structuredClone(chat)) },
      async removeChat(id) { chats.delete(id) }
    },
    snapshot() { return { links: structuredClone(links), index: structuredClone(index), chats: Object.fromEntries(chats), chatReads } },
    counts() { return { linkUpdates } }
  }
}

test('后台的部分头更新保留项目归属和分叉来源，更新当前分支版本', async () => {
  const store = memoryStore(), registry = createTavernConversationRegistry({ store: store.adapter })
  await registry.publish({ id: 'child', sessionId: 's-child', projectId: 'project-1', cardPath: 'cards/a.json', cardName: '卡', createdAt: 1, timeline: { branchId: 'branch-1' }, forkedFrom: { chatId: 'parent', turn: 3 } })
  await registry.sync({ id: 'child', updatedAt: 10, timeline: { branchId: 'branch-2' } })
  const [row] = await registry.list()
  assert.equal(row.projectId, 'project-1')
  assert.equal(row.cardPath, 'cards/a.json')
  assert.equal(row.branchId, 'branch-2')
  assert.deepEqual(row.forkedFrom, { chatId: 'parent', turn: 3 })
})

test('索引发布失败时回滚 Chat 和 Session 关联', async function () {
  const store = memoryStore({ failures: { writeIndex: 'index locked' } })
  const registry = createTavernConversationRegistry({ store: store.adapter })

  await assert.rejects(registry.publish({ id: 'chat-2', sessionId: 'session-2', cardPath: '', cardName: 'B', updatedAt: 20 }), /index locked/)

  assert.deepEqual(store.snapshot().links, {})
  assert.deepEqual(store.snapshot().chats, {})
})

test('损坏映射会从 Chat 索引自愈并清除失效目标', async function () {
  const chat = { id: 'chat-real', sessionId: 'session-3', cardPath: '', cardName: 'C' }
  const store = memoryStore({
    links: { 'session-3': 'chat-missing' },
    index: { chats: [{ id: 'chat-real' }] },
    chats: { 'chat-real': chat }
  })
  const registry = createTavernConversationRegistry({ store: store.adapter })

  assert.deepEqual(await registry.resolve('session-3'), chat)
  assert.deepEqual(store.snapshot().links, { 'session-3': 'chat-real' })
})

test('后台轮换写入轻量索引，恢复旧后台后重新成为当前，列表不加载历史', async () => {
  const store = memoryStore({ links: { front: 'game' } })
  const registry = createTavernConversationRegistry({ store: store.adapter })
  const chat = { id: 'game', messages: [], timeline: { participants: { background: { sessionId: 'old' } } } }
  await registry.sync(chat)
  chat.timeline.participants.background.sessionId = 'new'
  await registry.sync(chat)
  assert.deepEqual((await registry.list())[0].backgroundHistoryIds, ['old'])
  chat.timeline.participants.background.sessionId = 'old'
  await registry.sync(chat)
  const row = (await registry.list())[0]
  assert.equal(row.backgroundSessionId, 'old')
  assert.deepEqual(row.backgroundHistoryIds, ['new'])
  assert.equal(store.snapshot().chatReads, 0)
})

test('自动化拥有的会话不进入日常列表，但仍能解析且不删除数据', async () => {
  const id = 'test-8c2b3d71-c30e-446f-b7f6-75fc32614b8c'
  const normal = 'test-11111111-1111-4111-8111-111111111111'
  const chat = { id: 'automation-chat', sessionId: id, cardName: '自动化' }
  const store = memoryStore({ links: { [id]: chat.id, [normal]: 'normal-chat' }, index: { chats: [chat, { id: 'normal-chat', cardName: '正常对话' }] }, chats: { [chat.id]: chat } })
  store.adapter.readAutomationOwner = async key => key === id ? { sessionId: id } : undefined
  const registry = createTavernConversationRegistry({ store: store.adapter })
  assert.deepEqual((await registry.list()).map(row => row.sessionId), [normal])
  assert.deepEqual(await registry.resolve(id), chat)
  assert.equal(store.snapshot().links[id], chat.id)
})

test('对话按创建时间固定排序，打开不会改变位置；旧索引从 id 推出创建时间', async () => {
  const older = 'chat-' + Date.UTC(2026, 7, 1).toString(36) + '-aaaaaa'
  const store = memoryStore({
    links: { 'session-old': older, 'session-new': 'chat-new' },
    index: { chats: [
      { id: older, cardName: 'A', updatedAt: Date.UTC(2026, 8, 1) },
      { id: 'chat-new', cardName: 'B', createdAt: Date.UTC(2026, 7, 2), updatedAt: Date.UTC(2026, 7, 2) }
    ] }
  })
  const registry = createTavernConversationRegistry({ store: store.adapter })
  assert.deepEqual((await registry.list()).map(row => row.sessionId), ['session-new', 'session-old'])
  await registry.touch('session-old', Date.UTC(2026, 9, 1))
  const rows = await registry.list()
  assert.deepEqual(rows.map(row => row.sessionId), ['session-new', 'session-old'])
  assert.equal(rows[1].createdAt, Date.UTC(2026, 7, 1))
})

test('发布后的 branchId 和分叉来源在轻量列表中保留，缺失回合不伪装为初始状态', async () => {
  const store = memoryStore()
  const registry = createTavernConversationRegistry({ store: store.adapter })
  await registry.publish({ id: 'child', sessionId: 'front', timeline: { branchId: 'branch-child' }, forkedFrom: { chatId: 'parent' } })
  const row = (await registry.list())[0]
  assert.equal(row.branchId, 'branch-child')
  assert.deepEqual(row.forkedFrom, { chatId: 'parent' })
  assert.equal(store.snapshot().index.chats[0].relationshipVersion, 1)
  assert.equal(store.snapshot().chatReads, 0)
  await registry.sync({ id: 'child', branchId: 'branch-flat', forkedFrom: { chatId: 'parent', turn: 0 } })
  assert.equal((await registry.list())[0].branchId, 'branch-flat')
  assert.equal((await registry.list())[0].forkedFrom.turn, 0)
})

test('旧索引按批次读取专用 header 回填关系，保留摘要且完成后不重复读取', async () => {
  const rows = [
    { id: 'parent', cardPath: 'card', cardName: 'A', title: '原局', createdAt: 1 },
    { id: 'child', cardPath: 'card', cardName: 'A', title: '旧分支', createdAt: 2, lastOpenedAt: 9 }
  ]
  const store = memoryStore({ links: { one: 'parent', two: 'child' }, index: { chats: rows }, failures: { readChat: 'full history forbidden' } })
  const reads = []
  store.adapter.readChatHeader = async id => {
    reads.push(id)
    return { id, timeline: { branchId: 'branch-' + id }, ...(id === 'child' ? { forkedFrom: { chatId: 'parent', turn: 5 } } : {}) }
  }
  const registry = createTavernConversationRegistry({ store: store.adapter })
  assert.deepEqual(await registry.backfillForks({ limit: 1 }), { updated: 1, remaining: 1 })
  assert.deepEqual(await registry.backfillForks({ limit: 1 }), { updated: 1, remaining: 0 })
  assert.deepEqual(await registry.backfillForks(), { updated: 0, remaining: 0 })
  assert.deepEqual(reads, ['parent', 'child'])
  const child = (await registry.list()).find(row => row.chatId === 'child')
  assert.equal(child.title, '旧分支')
  assert.equal(child.cardPath, 'card')
  assert.equal(child.lastOpenedAt, 9)
  assert.equal(child.branchId, 'branch-child')
  assert.deepEqual(child.forkedFrom, { chatId: 'parent', turn: 5 })
  assert.equal(store.snapshot().chatReads, 0)
})

test('缺少专用 header 或迁移失败时保留旧索引，可随后重试', async () => {
  const store = memoryStore({ index: { chats: [{ id: 'old', title: '保留' }] }, failures: { readChat: 'forbidden' } })
  const registry = createTavernConversationRegistry({ store: store.adapter })
  assert.deepEqual(await registry.backfillForks(), { updated: 0, remaining: 1, skipped: true })
  store.adapter.readChatHeader = async () => { throw new Error('header unavailable') }
  assert.equal((await registry.backfillForks()).failures[0].error, 'header unavailable')
  assert.equal(store.snapshot().index.chats[0].relationshipVersion, undefined)
  store.adapter.readChatHeader = async id => ({ id })
  assert.deepEqual(await registry.backfillForks({ limit: 0 }), { updated: 0, remaining: 1 })
  assert.deepEqual(await registry.backfillForks(), { updated: 1, remaining: 0 })
  assert.equal(store.snapshot().index.chats[0].title, '保留')
  assert.equal(store.snapshot().chatReads, 0)
})
