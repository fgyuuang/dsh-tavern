import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'

import { createGameMemoryWorkspace } from '../tavern-plugin/lib/domain/game-memory-workspace.js'

function harness() {
  const data = new Map()
  const store = {
    async readJson(path) { const text = data.get(path); return text === undefined ? undefined : JSON.parse(text) },
    async readText(path) { return data.get(path) },
    async writeJson(path, value) { data.set(path, JSON.stringify(value)) },
    async writeBytes(path, value) { data.set(path, Buffer.from(value).toString('utf8')) }
  }
  const workspace = createGameMemoryWorkspace({ store })
  const chat = {
    id: 'chat-one',
    timeline: { branchId: 'branch-one', revision: 1, operations: {
      'body-one': { id: 'body-one', kind: 'body', turn: 1, status: 'completed', committedBranchId: 'branch-one', committedRevision: 1, completedAt: 1 }
    } }
  }
  const commit = async (writes, extra = {}) => {
    const prepared = await workspace.prepare(chat, { operationId: 'body-one', writes, ...extra })
    workspace.apply(chat, prepared, { operationId: 'body-one', branchId: 'branch-one', revision: 1 })
    return prepared
  }
  return { workspace, chat, data, store, commit }
}

function nextBody(chat, id = 'body-two') {
  chat.timeline.revision++
  chat.timeline.operations[id] = { id, kind: 'body', turn: chat.timeline.revision, status: 'completed', committedBranchId: chat.timeline.branchId, committedRevision: chat.timeline.revision, completedAt: chat.timeline.revision }
}

test('正文提交后推广不可变记忆，重启后的回执可重放，同任务不同内容被拒绝', async () => {
  const { workspace, chat, store } = harness()
  const prepared = await workspace.prepare(chat, { operationId: 'body-one', writes: [{ path: 'memory/当前场景.md', text: '钟楼，午夜。' }] })
  assert.equal(chat.gameMemory, undefined)
  const reopened = createGameMemoryWorkspace({ store })
  const durablePrepared = JSON.parse(JSON.stringify(prepared))
  await reopened.assertPrepared(chat, durablePrepared)
  const args = { operationId: 'body-one', branchId: 'branch-one', revision: 1 }
  assert.equal(reopened.apply(chat, durablePrepared, args).status, 'applied')
  assert.equal(reopened.apply(chat, durablePrepared, args).status, 'already-applied')
  assert.equal((await reopened.read(chat, 'memory/当前场景.md')).text, '钟楼，午夜。')
  const duplicate = await reopened.prepare(chat, { operationId: 'body-one', writes: [{ path: 'memory/当前场景.md', text: '钟楼，午夜。' }], expectedHead: null })
  assert.equal(duplicate.head, prepared.head)
  await assert.rejects(reopened.prepare(chat, { operationId: 'body-one', writes: [{ path: 'memory/当前场景.md', text: '错误内容' }], expectedHead: null }), /不同记忆内容/)
})

test('过期分支、正文、revision和并发 head 都不能提交', async () => {
  const { workspace, chat } = harness()
  const prepared = await workspace.prepare(chat, { operationId: 'body-one', writes: [{ path: 'scene.md', text: '第一回合' }] })
  const args = { operationId: 'body-one', branchId: 'branch-one', revision: 1 }
  const changedBranch = structuredClone(chat)
  changedBranch.timeline.branchId = 'branch-new'
  assert.throws(() => workspace.apply(changedBranch, prepared, args), /已提交的正式正文|已过期/)
  const changedRevision = structuredClone(chat)
  changedRevision.timeline.revision++
  assert.throws(() => workspace.apply(changedRevision, prepared, args), /已过期/)
  const later = structuredClone(chat)
  nextBody(later)
  assert.throws(() => workspace.apply(later, prepared, { ...args, revision: 2 }), /已过期/)
  const different = await workspace.prepare(chat, { operationId: 'body-one', writes: [{ path: 'scene.md', text: '另一个草稿' }] })
  workspace.apply(chat, prepared, args)
  assert.throws(() => workspace.apply(chat, different, args), /不同记忆内容/)
  nextBody(chat)
  await assert.rejects(workspace.prepare(chat, { operationId: 'body-two', writes: [], expectedHead: null }), /版本已变化/)
})

test('逻辑路径、Windows 保留名、重复大小写路径和预算均受限', async () => {
  const { workspace, chat, data } = harness()
  const paths = ['../x.md', '/x.md', 'C:/x.md', 'memory\\x.md', '.hidden/x.md', 'memory/../x.md', 'memory/con.md', 'memory/LPT¹.txt', 'memory/name .md\u0000', 'objects/x.md', 'memory/x.html', 'memory/foo./x.md']
  for (const path of paths) await assert.rejects(workspace.prepare(chat, { operationId: 'body-one', writes: [{ path, text: 'x' }] }), /剧情记忆/)
  await assert.rejects(workspace.prepare(chat, { operationId: 'body-one', writes: [{ path: 'A.md', text: 'a' }, { path: 'a.md', text: 'b' }] }), /重复路径/)
  await assert.rejects(workspace.prepare(chat, { operationId: 'body-one', writes: [{ path: 'huge.md', text: '大'.repeat(100000) }] }), /超限/)
  await assert.rejects(workspace.prepare(chat, { operationId: 'body-one', writes: [{ path: 'broken.json', text: '{' }] }), /JSON/)
  assert.equal(data.size, 0)
})

test('分页读取和搜索带出处，检索不加载其他局', async () => {
  const { workspace, chat, commit } = harness()
  await commit([
    { path: 'memory/人物.md', text: '甲知道钟楼的秘密。'.repeat(100) },
    { path: 'memory/场景.md', text: '钟楼只在午夜开放。' },
    { path: 'tables/物品.json', text: '{"钥匙":1}' }
  ])
  const page = await workspace.list(chat, { prefix: 'memory/', limit: 1 })
  assert.equal(page.total, 2)
  assert.equal(page.nextOffset, 1)
  const second = await workspace.list(chat, { prefix: 'memory/', offset: page.nextOffset, limit: 1 })
  assert.notEqual(page.files[0].path, second.files[0].path)
  const text = await workspace.read(chat, 'memory/人物.md', { limit: 10 })
  assert.equal(text.text.length, 10)
  assert.equal(text.nextOffset, 10)
  const tail = await workspace.read(chat, 'memory/人物.md', { offset: 10, limit: 10 })
  assert.equal(text.text + tail.text, '甲知道钟楼的秘密。'.repeat(100).slice(0, 20))
  const result = await workspace.search(chat, '钟楼', { limit: 1 })
  assert.equal(result.matches.length, 1)
  assert.equal(result.total, 2)
  assert.ok(result.matches[0].hash)
  assert.equal(result.head, chat.gameMemory.head)
  assert.deepEqual((await workspace.list({ id: 'other-chat' })).files, [])
})

test('分叉物理根独立，历史指针恢复原始文档且分叉写入不污染源局', async () => {
  const { workspace, chat, data, commit } = harness()
  await commit([{ path: 'scene.md', text: '分叉之前' }])
  const oldHead = structuredClone(chat.gameMemory)
  const target = structuredClone(chat)
  target.id = 'chat-fork'
  target.gameMemory = await workspace.fork(chat, target)
  nextBody(target)
  const prepared = await workspace.prepare(target, { operationId: 'body-two', writes: [{ path: 'scene.md', text: '分叉剧情' }] })
  workspace.apply(target, prepared, { operationId: 'body-two', branchId: 'branch-one', revision: 2 })
  assert.equal((await workspace.read(chat, 'scene.md')).text, '分叉之前')
  assert.equal((await workspace.read(target, 'scene.md')).text, '分叉剧情')
  target.gameMemory = oldHead
  assert.equal((await workspace.read(target, 'scene.md')).text, '分叉之前')
  const keys = [...data.keys()]
  assert.equal(new Set(keys.map(key => key.split('/')[1])).size, 2)
})

test('导出包含历史和删除前文件，导入新局可回退，损坏或恶意归档不写入', async () => {
  const { workspace, chat, data, commit } = harness()
  await commit([{ path: 'scene.md', text: '原始场景' }, { path: 'memory/npc.md', text: '旅人' }])
  const before = structuredClone(chat.gameMemory)
  nextBody(chat)
  const prepared = await workspace.prepare(chat, { operationId: 'body-two', writes: [{ path: 'scene.md', text: '新场景' }], deletes: ['memory/npc.md'] })
  workspace.apply(chat, prepared, { operationId: 'body-two', branchId: 'branch-one', revision: 2 })
  const files = await workspace.exportFiles(chat)
  const imported = { ...structuredClone(chat), id: 'imported-chat' }
  await workspace.importFiles(imported, files)
  assert.equal((await workspace.read(imported, 'scene.md')).text, '新场景')
  assert.equal((await workspace.read(imported, 'memory/npc.md')).status, 'not-found')
  imported.gameMemory = before
  assert.equal((await workspace.read(imported, 'memory/npc.md')).text, '旅人')
  const count = data.size
  const tampered = structuredClone(files)
  tampered.find(file => file.path.startsWith('objects/')).content += '!'
  await assert.rejects(workspace.importFiles({ ...imported, id: 'bad-import' }, tampered), /校验失败/)
  await assert.rejects(workspace.importFiles({ id: 'evil' }, [{ path: '../scene.md', content: 'bad' }]), /路径无效/)
  assert.equal(data.size, count)
})

test('不可变存储损坏不能被正常读取、恢复提交或导出', async () => {
  const { workspace, chat, data, commit } = harness()
  const prepared = await commit([{ path: 'scene.md', text: '场景' }])
  const root = 'game-memory/' + createHash('sha256').update(chat.id).digest('hex') + '/'
  const objectKey = [...data.keys()].find(key => key.startsWith(root + 'objects/'))
  data.set(objectKey, '损坏')
  await assert.rejects(workspace.read(chat, 'scene.md'), /校验失败/)
  await assert.rejects(workspace.assertPrepared(chat, prepared), /校验失败/)
  await assert.rejects(workspace.exportFiles(chat), /校验失败/)
  data.set(root + 'snapshots/' + prepared.head + '.json', '{}')
  await assert.rejects(workspace.list(chat), /快照格式无效/)
})

test('空更新和相同内容复用当前 head，仍为每个正文保存幂等回执', async () => {
  const { workspace, chat, data, commit, store } = harness()
  await commit([])
  const emptyHead = chat.gameMemory.head
  assert.equal(data.size, 1)
  nextBody(chat)
  let prepared = await workspace.prepare(chat, { operationId: 'body-two', writes: [], deletes: ['absent.md'] })
  assert.equal(prepared.head, emptyHead)
  await createGameMemoryWorkspace({ store }).validatePrepared(chat, structuredClone(prepared))
  workspace.apply(chat, prepared, { operationId: 'body-two', branchId: 'branch-one', revision: 2 })
  assert.equal(chat.timeline.operations['body-two'].memoryReceipt.head, emptyHead)
  assert.equal(data.size, 1)
  nextBody(chat, 'body-three')
  prepared = await workspace.prepare(chat, { operationId: 'body-three', writes: [{ path: 'scene.md', text: '钟楼' }] })
  workspace.apply(chat, prepared, { operationId: 'body-three', branchId: 'branch-one', revision: 3 })
  const count = data.size
  const head = chat.gameMemory.head
  const source = (await workspace.read(chat, 'scene.md')).source
  nextBody(chat, 'body-four')
  prepared = await workspace.prepare(chat, { operationId: 'body-four', writes: [{ path: 'scene.md', text: '钟楼' }] })
  assert.equal(prepared.head, head)
  await workspace.validatePrepared(chat, prepared)
  workspace.apply(chat, prepared, { operationId: 'body-four', branchId: 'branch-one', revision: 4 })
  assert.equal(data.size, count)
  assert.deepEqual((await workspace.read(chat, 'scene.md')).source, source)
})

test('中文查询按词召回，继承文件保留来源而本分支修改记录新来源', async () => {
  const { workspace, chat, commit } = harness()
  await commit([{ path: 'memory/人物.md', text: '钟楼守卫名叫林峰。秘密存在地下室。' }])
  const found = await workspace.search(chat, '钟楼的秘密')
  assert.equal(found.matches.length, 1)
  assert.deepEqual(found.matches[0].source, { turn: 1, operationId: 'body-one', branchId: 'branch-one', revision: 1 })
  const target = { ...structuredClone(chat), id: 'other-branch' }
  target.gameMemory = await workspace.fork(chat, target)
  target.timeline.branchId = 'branch-other'
  nextBody(target)
  assert.equal((await workspace.read(target, 'memory/人物.md')).source.branchId, 'branch-one')
  assert.deepEqual((await workspace.search({ id: 'unrelated-game' }, '钟楼的秘密')).matches, [])
  const prepared = await workspace.prepare(target, { operationId: 'body-two', writes: [{ path: 'memory/人物.md', text: '林峰搬去了港口。' }] })
  workspace.apply(target, prepared, { operationId: 'body-two', branchId: 'branch-other', revision: 2 })
  assert.deepEqual((await workspace.read(target, 'memory/人物.md')).source, { turn: 2, operationId: 'body-two', branchId: 'branch-other', revision: 2 })
  assert.equal((await workspace.read(chat, 'memory/人物.md')).source.branchId, 'branch-one')
})

test('导入不能通过重新计算 hash 携带无界来源 metadata', async () => {
  const { workspace, chat, commit, data } = harness()
  await commit([{ path: 'scene.md', text: '钟楼' }])
  const files = await workspace.exportFiles(chat)
  const snapshot = files.find(file => file.path.startsWith('snapshots/'))
  const manifest = JSON.parse(snapshot.content)
  manifest.files[0].source.extra = '任意数据'
  const content = JSON.stringify(manifest)
  const hash = createHash('sha256').update(content).digest('hex')
  snapshot.path = 'snapshots/' + hash + '.json'
  snapshot.content = content
  const before = data.size
  await assert.rejects(workspace.importFiles({ id: 'malformed-import', gameMemory: { version: 1, head: hash } }, files), /来源无效/)
  assert.equal(data.size, before)
})

test('纯归档校验覆盖多个历史 head，拒绝缺失 head、文件和重复路径且不写存储', async () => {
  const { workspace, chat, data, commit } = harness()
  await commit([{ path: 'memory/scene.md', text: '旧场景' }])
  const first = chat.gameMemory.head
  nextBody(chat)
  const prepared = await workspace.prepare(chat, { operationId: 'body-two', writes: [{ path: 'memory/scene.md', text: '新场景' }] })
  workspace.apply(chat, prepared, { operationId: 'body-two', branchId: 'branch-one', revision: 2 })
  const files = await workspace.exportFiles(chat)
  const count = data.size
  assert.equal(workspace.validateArchive(files, [first, chat.gameMemory.head]).snapshots, 2)
  assert.throws(() => workspace.validateArchive(files, ['0'.repeat(64)]), /缺少记忆快照/)
  assert.throws(() => workspace.validateArchive(files.filter(file => !file.path.startsWith('objects/')), [first]), /缺少记忆文件/)
  assert.throws(() => workspace.validateArchive([...files, files[0]], [first]), /重复/)
  assert.equal(data.size, count)
})

test('两条各自合法的历史链合并超过 400 快照时，在导出前纯校验拒绝', async () => {
  const { workspace, data } = harness()
  const sha = value => createHash('sha256').update(value).digest('hex')
  const chain = (count, branch) => {
    const text = '分支：' + branch, objectHash = sha(text)
    const files = [{ path: 'objects/' + objectHash + '.txt', content: text }]
    let parent = null
    for (let turn = 1; turn <= count; turn++) {
      const content = JSON.stringify({ version: 1, parent, files: [{ path: 'memory/scene.md', hash: objectHash, bytes: Buffer.byteLength(text), source: { turn, operationId: branch + '-' + turn, branchId: branch, revision: turn } }] })
      parent = sha(content)
      files.push({ path: 'snapshots/' + parent + '.json', content })
    }
    return { files, head: parent }
  }
  const left = chain(200, 'left'), right = chain(201, 'right')
  assert.equal(workspace.validateArchive(left.files, [left.head]).snapshots, 200)
  assert.equal(workspace.validateArchive(right.files, [right.head]).snapshots, 201)
  assert.throws(() => workspace.validateArchive([...left.files, ...right.files], [left.head, right.head]), /快照数量超限/)
  await assert.rejects(workspace.importFiles({ id: 'over-limit-import' }, [...left.files, ...right.files]), /快照数量超限/)
  assert.equal(data.size, 0)
})

test('归档合并总量超 64MiB 受限，各文件仍满足单文件上限', () => {
  const { workspace, data } = harness()
  const filler = 'x'.repeat(256 * 1024 - 6)
  const files = Array.from({ length: 257 }, (_, index) => {
    const content = String(index).padStart(6, '0') + filler
    const hash = createHash('sha256').update(content).digest('hex')
    return { path: 'objects/' + hash + '.txt', content }
  })
  assert.equal(workspace.validateArchive(files.slice(0, 128)).bytes, 32 * 1024 * 1024)
  assert.equal(workspace.validateArchive(files.slice(128)).files, 129)
  assert.throws(() => workspace.validateArchive(files), /体积超限/)
  assert.equal(data.size, 0)
})
