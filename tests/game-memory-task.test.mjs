import assert from 'node:assert/strict'
import test from 'node:test'
import { createGameMemoryWorkspace } from '../tavern-plugin/lib/domain/game-memory-workspace.js'
import { createGameMemoryTask } from '../tavern-plugin/lib/domain/game-memory-task.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'
import { createBackgroundTaskCoordinator } from '../tavern-plugin/lib/domain/background-task-coordinator.js'
import { createMvuSettlementModule } from '../tavern-plugin/lib/domain/mvu-background-settlement.js'
import { appendGameMemory } from '../tavern-plugin/lib/hooks/request.js'
import { buildGameSave, readGameSave } from '../tavern-plugin/lib/domain/game-save.js'

function harness() {
  let sequence = 0, current, before
  const files = new Map()
  const workspace = createGameMemoryWorkspace({ store: {
    async readJson(path) { const bytes = files.get(path); return bytes ? JSON.parse(bytes.toString()) : undefined },
    async readText(path) { return files.get(path)?.toString() },
    async writeJson(path, value) { files.set(path, Buffer.from(JSON.stringify(value))) },
    async writeBytes(path, bytes) { files.set(path, Buffer.from(bytes)) }
  } })
  const timeline = createStoryTimeline({ id: prefix => prefix + '-' + ++sequence, now: () => 1000 + sequence })
  current = timeline.apply({ chat: { id: 'chat-memory', sessionId: 's', mode: 'story', playPresetId: 'dream-sike-dsh', messages: [], settleStatus: 'idle', _storageRevision: 1 }, intent: { kind: 'ensure' } }).chat
  before = structuredClone(current)
  const body = timeline.apply({ chat: current, intent: { kind: 'body.begin', turn: 1, userText: '进入钟楼' } })
  current = timeline.complete({ chat: body.chat, operationId: body.value.operationId, basedOn: body.value.basedOn, outcome: { status: 'success' }, apply(draft) { draft.messages.push({ role: 'assistant', turn: 1, text: '她进入钟楼，记住了门上的暗号。' }) } }).chat
  const coordinator = createBackgroundTaskCoordinator({ timeline, store: {
    async readChat() { return structuredClone(current) },
    async writeChat(chat) { current = structuredClone(chat); return current },
    async updateChat(_id, mutation) { const next = await mutation(structuredClone(current)); if (next) current = structuredClone(next); return structuredClone(current) }
  } })
  return { workspace, timeline, coordinator, current: () => structuredClone(current), set: chat => { current = structuredClone(chat) }, before, bodyId: body.value.operationId }
}

const submission = { name: 'tavern_memory_submit', arguments: { writes: [{ path: 'memory/current-scene.md', text: '回合 1：人物在钟楼，知道门上的暗号。' }], deletes: [] } }

test('后台暂存可在重启后恢复，变量与记忆由同一次结算提交，回退清除未来记忆', async () => {
  const h = harness()
  const task = await h.coordinator.begin(h.current(), 'settlement')
  const memory = await createGameMemoryTask({ workspace: h.workspace, chat: task.chat, taskRun: task })
  assert.equal(JSON.parse(await memory.execute(submission)).ok, true)
  assert.equal(h.current().gameMemory, undefined)
  assert.equal((await h.workspace.list(h.current())).total, 0)
  const restarted = await createGameMemoryTask({ workspace: h.workspace, chat: h.current(), taskRun: task })
  assert.equal(restarted.complete(), true)
  const result = await task.commit({ apply(draft) { restarted.apply(draft); draft.variables = { count: 1 } } })
  assert.equal(result.status, 'committed')
  assert.equal((await h.workspace.read(result.chat, 'memory/current-scene.md')).status, 'found')
  assert.deepEqual(result.chat.variables, { count: 1 })
  assert.equal(result.chat.timeline.operations[h.bodyId].memoryPrepared, undefined)
  const rolled = h.timeline.apply({ chat: result.chat, intent: { kind: 'turn.rollback', beforeChat: h.before } })
  assert.equal((await h.workspace.list(rolled.chat)).total, 0)
  assert.equal(rolled.chat.variables, undefined)
})

test('回退后的后台迟到提交不能更新记忆或变量', async () => {
  const h = harness()
  const task = await h.coordinator.begin(h.current(), 'settlement')
  const memory = await createGameMemoryTask({ workspace: h.workspace, chat: task.chat, taskRun: task })
  await memory.execute(submission)
  h.set(h.timeline.apply({ chat: h.current(), intent: { kind: 'turn.rollback', beforeChat: h.before } }).chat)
  const result = await task.commit({ apply(draft) { memory.apply(draft); draft.variables = { count: 9 } } })
  assert.equal(result.status, 'stale')
  assert.equal((await h.workspace.list(h.current())).total, 0)
  assert.equal(h.current().variables, undefined)
})

test('MVU 工具在记忆暂存前不会执行，结算失败不会使记忆提前生效', async () => {
  const h = harness(), feedback = [], task = await h.coordinator.begin(h.current(), 'settlement')
  const memory = await createGameMemoryTask({ workspace: h.workspace, chat: task.chat, taskRun: task })
  let executions = 0
  const module = createMvuSettlementModule({ model: { async run(input) {
    feedback.push(JSON.parse(await input.onToolCall({ name: 'mvu_submit_update', arguments: { operations: [] } })))
    await input.onToolCall(submission)
    feedback.push(JSON.parse(await input.onToolCall({ name: 'mvu_submit_update', arguments: { operations: [] } })))
    assert.equal(input.stopToolsWhen(), true)
    return {}
  } }, runtime: { async settleMvuUpdate() { executions++; return { variables: { stat_data: {} }, validation: { changes: [], sideEffects: [], failures: [] } } } } })
  await module.settleVariables({ extraTask: memory, backgroundTasks: { posture: false, characterDesign: false }, chatId: h.current().id, operationId: task.operationId, branchId: task.basedOn.branchId, basedOnRevision: task.basedOn.revision, sessionId: 's', storyText: '她进入钟楼。', currentVariables: { stat_data: {} }, messageId: 0, swipeId: 0 })
  assert.equal(feedback[0].ok, false)
  assert.equal(feedback[1].ok, true)
  assert.equal(executions, 1)
  await task.commit({ status: 'failed' })
  assert.equal((await h.workspace.list(h.current())).total, 0)
})

test('压缩后下回合只给记忆目录与读取入口，同一执行不重复追加', async () => {
  const h = harness(), payload = { step: 1 }, decision = { kind: 'enter', messages: [] }
  const result = await appendGameMemory({ chat: h.current(), payload, decision, workspace: h.workspace })
  assert.match(result.messages[0].content[0].text, /tavern_memory/)
  assert.equal((await appendGameMemory({ chat: h.current(), payload, decision: result, workspace: h.workspace })).messages.length, 1)
  assert.equal((await appendGameMemory({ chat: { ...h.current(), playPresetId: 'tavern' }, payload, decision, workspace: h.workspace })).messages.length, 0)
})

test('存档包携带不可变记忆，导入新局后可读与分叉，旧存档仍能读取', async () => {
  const h = harness(), task = await h.coordinator.begin(h.current(), 'settlement')
  const memory = await createGameMemoryTask({ workspace: h.workspace, chat: task.chat, taskRun: task })
  await memory.execute(submission)
  await task.commit({ apply: draft => memory.apply(draft) })
  const buffer = buildGameSave({ chat: h.current(), revisions: [], session: { events: [] }, memory: await h.workspace.exportFiles(h.current()), tavernVersion: '2.5.0' })
  const save = readGameSave(buffer)
  assert.equal(save.manifest.formatVersion, 2)
  const imported = { ...save.chat, id: 'chat-imported' }
  await h.workspace.importFiles(imported, save.memory)
  assert.equal((await h.workspace.read(imported, 'memory/current-scene.md')).status, 'found')
  assert.equal((await h.workspace.fork(imported, { id: 'chat-fork' })).head, imported.gameMemory.head)
})

test('编辑正文撤销由旧正文生成的记忆；状态维护重试不会重复提交记忆', async () => {
  const h = harness(), task = await h.coordinator.begin(h.current(), 'settlement')
  const memory = await createGameMemoryTask({ workspace: h.workspace, chat: task.chat, taskRun: task })
  await memory.execute(submission)
  await task.commit({ apply: draft => memory.apply(draft) })
  const settled = h.current()
  const changed = h.timeline.apply({ chat: settled, intent: { kind: 'ledger.edit', ledger: { version: 1 } } }).chat
  h.set(changed)
  const retry = await h.coordinator.begin(h.current(), 'settlement')
  const savedMemory = await createGameMemoryTask({ workspace: h.workspace, chat: retry.chat, taskRun: retry })
  assert.equal(savedMemory.complete(), true)
  const beforeHead = h.current().gameMemory.head
  await retry.commit({ apply: draft => savedMemory.apply(draft) })
  assert.equal(h.current().gameMemory.head, beforeHead)
  const edited = h.timeline.apply({ chat: h.current(), intent: { kind: 'body.edit', turn: 1, patch: { text: '她转身离开，没有进入钟楼。' } } }).chat
  assert.equal((await h.workspace.list(edited)).total, 0)
  assert.equal(edited.timeline.operations[h.bodyId].memoryReceipt, undefined)
})
