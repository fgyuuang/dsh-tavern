import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { createBackgroundTaskCoordinator } from '../tavern-plugin/lib/domain/background-task-coordinator.js'
import { createGameMemoryWorkspace } from '../tavern-plugin/lib/domain/game-memory-workspace.js'
import { createGameMemoryTask } from '../tavern-plugin/lib/domain/game-memory-task.js'
import { taskStateFields } from '../tavern-plugin/lib/domain/task-state-reader.js'
import { forkConversationChat } from '../tavern-plugin/lib/domain/conversation-fork.js'

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-memory-native-'))
  const journals = []
  t.after(async () => {
    for (const journal of journals) await journal.flushMaintenance()
    const relative = path.relative(tmpdir(), root)
    assert.ok(relative.startsWith('dsh-memory-native-') && !relative.includes(path.sep))
    await rm(root, { recursive: true, force: true })
  })
  let sequence = 0
  const timeline = createStoryTimeline({ id: prefix => prefix + '-' + ++sequence, now: () => 1000 + sequence })
  const profile = createProfileDataStore({ dataRoot: root })
  const workspace = createGameMemoryWorkspace({ store: profile })
  const seedJournal = createChatJournalStore({ dataRoot: root, compatibleStorage: false, newConversations: true })
  journals.push(seedJournal)
  const seedDb = createChatPersistence({ store: seedJournal })
  const oldVariable = 'x'.repeat(64 * 1024)
  const seed = timeline.apply({ chat: {
    id: 'chat-native-memory', sessionId: 'session-native-memory', projectId: 'project-clock', mode: 'story', playPresetId: 'dream-sike-dsh',
    backgroundConfigVersion: 1, conversationFeaturesVersion: 1, settleStatus: 'idle',
    variables: { stat_data: { clueCount: 0 }, schema: { type: 'object' } }, mvu: { enabled: true, owner: 'official' },
    messages: Array.from({ length: 150 }, (_, index) => ({
      id: 'history-' + index, role: index % 2 ? 'assistant' : 'user', turn: Math.floor(index / 2) + 1, text: '历史消息 ' + index,
      variables: [{ stat_data: { archive: 'row-' + index + ':' + oldVariable }, schema: { type: 'object' } }]
    }))
  }, intent: { kind: 'ensure' } }).chat
  let saved = await seedDb.write(seed)
  const begun = timeline.apply({ chat: saved, intent: { kind: 'body.begin', turn: 76, userText: '进入钟楼' } })
  saved = await seedDb.write(begun.chat)
  const completed = timeline.complete({ chat: saved, operationId: begun.value.operationId, basedOn: begun.value.basedOn, outcome: { status: 'success' }, apply(draft) {
    draft.messages.push({ role: 'user', turn: 76, text: '进入钟楼' }, { id: 'body-current', role: 'assistant', turn: 76, text: '她进入钟楼，认出了门上的暗号。', swipeId: 0,
      variables: [{ stat_data: { clueCount: 0 }, schema: { type: 'object' } }], mvu: { pending: true } })
  } })
  await seedDb.write(completed.chat)
  assert.match(await seedJournal.version(seed.id), /^native:/)

  const io = [], calls = { fullReads: 0, fullUpdates: 0, patches: 0 }
  const open = () => {
    const journal = createChatJournalStore({ dataRoot: root, compatibleStorage: false, newConversations: true, onNativeIO: event => io.push(event) })
    journals.push(journal)
    const db = createChatPersistence({ store: journal })
    const store = {
      async readChat(id) { calls.fullReads++; return db.read(id) },
      async writeChat(chat, metadata) { calls.fullUpdates++; return db.write(chat, metadata) },
      async updateChat(id, mutation, metadata) { calls.fullUpdates++; return db.update(id, mutation, metadata) },
      async patchChat(id, revision, changes, metadata) { calls.patches++; return db.patch(id, revision, changes, metadata) },
      readSlice: db.readSlice, readState: db.readSessionState, readSettlementCheckpoint: db.readSettlementCheckpoint,
      readRecoveryState: async id => (await db.readSlice(id, [], taskStateFields))?.chat
    }
    return { db, journal, coordinator: createBackgroundTaskCoordinator({ timeline, store }) }
  }
  const initial = open()
  return { ...initial, open, root, profile, workspace, timeline, bodyId: begun.value.operationId, bodyIndex: 151, chatId: seed.id, calls, io }
}

async function stage(h, text = '回合 76：人物进入钟楼，知道门上的暗号。') {
  const header = (await h.db.readSlice(h.chatId, [], taskStateFields)).chat
  const task = await h.coordinator.begin(header, 'settlement', { reuseSnapshot: true })
  const memory = await createGameMemoryTask({ workspace: h.workspace, chat: task.chat, taskRun: task })
  const feedback = JSON.parse(await memory.execute({ name: 'tavern_memory_submit', arguments: { writes: [{ path: 'memory/current-scene.md', text }], deletes: [] } }))
  assert.equal(feedback.ok, true)
  return { task, memory, head: feedback.head }
}

test('真实 native CAS 同时提交记忆与 MVU，headerOnly 暂存及单楼层结算不读取整局历史', async t => {
  const h = await fixture(t)
  const { task, head } = await stage(h)
  const durable = (await h.db.readSlice(h.chatId, [], taskStateFields)).chat
  assert.equal(durable.gameMemory, undefined)
  assert.equal(durable.timeline.operations[h.bodyId].memoryPrepared.head, head)
  assert.equal((await h.workspace.list(durable)).total, 0)

  // Recreate both adapters: recovery reads real immutable files, not captured objects.
  const reopened = h.open()
  const persisted = (await reopened.db.readSlice(h.chatId, [], taskStateFields)).chat
  const recoveredWorkspace = createGameMemoryWorkspace({ store: createProfileDataStore({ dataRoot: h.root }) })
  const recoveredMemory = await createGameMemoryTask({ workspace: recoveredWorkspace, chat: persisted, taskRun: task })
  assert.equal(recoveredMemory.complete(), true)
  const result = await task.commit({ messageIndices: [h.bodyIndex], stateChanged: true, apply(draft) {
    recoveredMemory.apply(draft)
    draft.messages[h.bodyIndex].variables[0].stat_data.clueCount = 1
    draft.messages[h.bodyIndex].mvu = { pending: false, modified: true, receipt: { status: 'updated', changes: [{ path: '/stat_data/clueCount' }] } }
    draft.variables.stat_data.clueCount = 1
  } })
  assert.equal(result.status, 'committed')
  assert.equal(result.chat.gameMemory.head, head)
  assert.equal(h.calls.fullReads, 0)
  assert.equal(h.calls.fullUpdates, 0)
  assert.ok(h.calls.patches >= 3, '开始、文档暂存及结算均通过真实版本化 patch')
  const stageReadBytes = h.io.filter(event => event.kind === 'read' && event.reason !== 'deduplication').reduce((sum, event) => sum + event.bytes, 0)
  assert.ok(stageReadBytes > 0, '必须运行真实 native 存储读取，而非旧 journal 或伪造 adapter')
  assert.ok(stageReadBytes < 512 * 1024, '结算读取预算不应包含 150 个 64KiB 历史变量：' + stageReadBytes)
  t.diagnostic('native stage: fullReads=' + h.calls.fullReads + ', fullUpdates=' + h.calls.fullUpdates + ', patches=' + h.calls.patches + ', readBytes=' + stageReadBytes)

  const disk = h.open()
  const state = await disk.db.readSessionState(h.chatId)
  assert.deepEqual(state.gameMemory, { version: 1, head })
  assert.equal(state.playPresetId, 'dream-sike-dsh')
  assert.equal(state.projectId, 'project-clock')
  assert.equal(state.timeline.operations[h.bodyId].memoryReceipt.head, head)
  assert.equal(state.timeline.operations[h.bodyId].memoryPrepared, undefined)
  const selected = await disk.db.readSlice(h.chatId, [h.bodyIndex, 0], ['variables', 'gameMemory', 'projectId'])
  assert.equal(selected.chat.variables.stat_data.clueCount, 1)
  assert.equal(selected.chat.messages[0].variables[0].stat_data.clueCount, 1)
  assert.equal(selected.chat.messages[0].mvu.pending, false)
  assert.equal(selected.chat.messages[1].variables[0].stat_data.archive, 'row-0:' + 'x'.repeat(64 * 1024))
  assert.equal((await recoveredWorkspace.read(state, 'memory/current-scene.md')).text, '回合 76：人物进入钟楼，知道门上的暗号。')
})

test('真实历史 Chat 的 head 可以分叉到独立物理工作区，后续源局结算不会改变分叉记忆', async t => {
  const h = await fixture(t)
  const first = await stage(h)
  const settled = await first.task.commit({ messageIndices: [h.bodyIndex], apply(draft) {
    first.memory.apply(draft)
    draft.messages[h.bodyIndex].mvu = { pending: false, receipt: { status: 'unchanged' } }
  } })
  const historicalRevision = settled.chat._storageRevision
  let current = await h.db.read(h.chatId)
  const begun = h.timeline.apply({ chat: current, intent: { kind: 'body.begin', turn: 77, userText: '离开钟楼' } })
  current = await h.db.write(begun.chat)
  const completed = h.timeline.complete({ chat: current, operationId: begun.value.operationId, basedOn: begun.value.basedOn, outcome: { status: 'success' }, apply(draft) {
    draft.messages.push({ role: 'user', turn: 77, text: '离开钟楼' }, { role: 'assistant', turn: 77, text: '她来到港口。' })
  } })
  await h.db.write(completed.chat)
  const second = await stage(h, '回合 77：人物已到港口。')
  await second.task.commit({ messageIndices: [153], apply: draft => second.memory.apply(draft) })

  const past = await h.db.readRevision(h.chatId, historicalRevision)
  assert.equal(past.gameMemory.head, first.head)
  const fork = forkConversationChat(past, { chatId: 'chat-memory-fork', sessionId: 'session-memory-fork', id: prefix => prefix + '-fork', now: 2000 })
  fork.gameMemory = await h.workspace.fork(past, fork)
  await h.db.write(fork)
  const reloadedFork = await h.open().db.readSessionState(fork.id)
  assert.equal(reloadedFork.projectId, 'project-clock')
  assert.notEqual(reloadedFork.timeline.branchId, past.timeline.branchId)
  assert.match((await h.workspace.read(reloadedFork, 'memory/current-scene.md')).text, /钟楼/)
  const latest = await h.db.readSessionState(h.chatId)
  assert.match((await h.workspace.read(latest, 'memory/current-scene.md')).text, /港口/)
})
