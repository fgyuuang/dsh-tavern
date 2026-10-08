import { createHash } from 'node:crypto'

const MAX_FILES = 128
const MAX_FILE_BYTES = 256 * 1024
const MAX_TOTAL_BYTES = 4 * 1024 * 1024
const MAX_SNAPSHOTS = 400
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
const hash = value => createHash('sha256').update(value).digest('hex')
const digest = value => /^[a-f0-9]{64}$/.test(value)
const bytes = value => Buffer.byteLength(value, 'utf8')
const copy = value => JSON.parse(JSON.stringify(value))
const bounded = (value, fallback, max) => Number.isSafeInteger(value) && value >= 0 ? Math.min(value, max) : fallback
const fail = message => { throw new Error('剧情记忆：' + message) }
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' })
// Match the existing worldbook BM25 segmentation without its pool-size threshold.
const stopWords = new Set(['的', '了', '是', '在', '和', '与', '也', '就', '都', '而', '着', 'the', 'a', 'an', 'and', 'of', 'to', 'in', 'is'])
const queryTerms = text => [...segmenter.segment(text.normalize('NFKC').toLowerCase())]
  .filter(part => part.isWordLike && !stopWords.has(part.segment)).map(part => part.segment)
const byPath = (a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0

function logicalPath(value, prefix = false) {
  if (typeof value !== 'string' || value.length > 240 || value !== value.normalize('NFC') || /[\\<>:"|?*\p{C}]/u.test(value)) fail('文件路径无效')
  if (prefix && value === '') return ''
  const candidate = prefix && value.endsWith('/') ? value.slice(0, -1) : value
  const segments = candidate.split('/')
  for (const segment of segments) {
    if (!segment || segment.length > 96 || segment.startsWith('.') || /^[\s]|[.\s]$/.test(segment) || /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(segment) || /^(?:node_modules|objects|snapshots|game-memory|__proto__|prototype|constructor)$/i.test(segment)) fail('文件路径含有保留名称')
  }
  if (!prefix && !/\.(?:md|json|csv|txt)$/i.test(candidate)) fail('仅支持 md/json/csv/txt 文件')
  return value
}

function pointer(chat) {
  const value = chat?.gameMemory
  if (value == null) return null
  if (value.version !== 1 || !digest(value.head)) fail('记忆指针损坏')
  return value.head
}

function identity(chat) {
  if (typeof chat?.id !== 'string' || !chat.id || chat.id.length > 512) fail('缺少会话标识')
  return hash(chat.id)
}

function currentBody(chat) {
  const timeline = chat?.timeline
  if (typeof timeline?.branchId !== 'string' || !timeline.branchId || !Number.isSafeInteger(timeline.revision) || timeline.revision < 0) fail('缺少剧情版本')
  const bodies = Object.values(timeline.operations || {}).filter(operation => operation?.kind === 'body' && operation.status === 'completed' && operation.committedBranchId === timeline.branchId)
  bodies.sort((a, b) => (b.committedRevision - a.committedRevision) || ((b.completedAt || 0) - (a.completedAt || 0)))
  if (!bodies[0] || !Number.isSafeInteger(bodies[0].committedRevision) || bodies[0].committedRevision < 0 || bodies[0].committedRevision > timeline.revision) fail('需要已提交的正式正文')
  return bodies[0]
}

function validateManifest(manifest) {
  if (!manifest || manifest.version !== 1 || !(manifest.parent === null || digest(manifest.parent)) || !Array.isArray(manifest.files) || manifest.files.length > MAX_FILES) fail('快照格式无效')
  const seen = new Set()
  let total = 0
  for (const file of manifest.files) {
    logicalPath(file?.path)
    const key = file.path.toLowerCase()
    if (seen.has(key) || !digest(file.hash) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > MAX_FILE_BYTES) fail('快照文件无效')
    if (file.source !== undefined) {
      const source = file.source
      if (!source || typeof source !== 'object' || Array.isArray(source) || Object.keys(source).length !== 4 || Object.keys(source).some(key => !['turn', 'operationId', 'branchId', 'revision'].includes(key)) || !Number.isSafeInteger(source.turn) || source.turn < 0 || source.turn > 1e9 || !Number.isSafeInteger(source.revision) || source.revision < 0 || typeof source.operationId !== 'string' || !source.operationId || source.operationId.length > 256 || typeof source.branchId !== 'string' || !source.branchId || source.branchId.length > 256) fail('记忆文件来源无效')
    }
    seen.add(key)
    total += file.bytes
  }
  if (total > MAX_TOTAL_BYTES) fail('记忆文件总量超限')
  return manifest
}

function validatePrepared(prepared) {
  const receipt = prepared?.receipt
  if (!receipt || receipt.version !== 1 || !digest(prepared.head) || receipt.head !== prepared.head || !digest(receipt.chatKey) || !digest(receipt.payloadHash) || !(receipt.expectedHead === null || digest(receipt.expectedHead)) || !(receipt.snapshotParent === null || digest(receipt.snapshotParent)) || typeof receipt.operationId !== 'string' || !receipt.operationId || typeof receipt.branchId !== 'string' || !receipt.branchId || !Number.isSafeInteger(receipt.revision) || receipt.revision < 0) fail('提交回执无效')
  const { checksum, ...content } = receipt
  if (checksum !== hash(JSON.stringify(content))) fail('提交回执损坏')
  return receipt
}

/** Immutable objects are written before Chat's pointer changes inside Timeline.complete. */
export function createGameMemoryWorkspace({ store }) {
  const root = chat => 'game-memory/' + identity(chat) + '/'
  const objectPath = (chat, id) => root(chat) + 'objects/' + id + '.txt'
  const snapshotPath = (chat, id) => root(chat) + 'snapshots/' + id + '.json'

  async function snapshot(chat, head = pointer(chat)) {
    if (head === null) return { version: 1, parent: null, files: [] }
    if (!digest(head)) fail('快照标识无效')
    const manifest = await store.readJson(snapshotPath(chat, head))
    validateManifest(manifest)
    if (hash(JSON.stringify(manifest)) !== head) fail('快照校验失败')
    return manifest
  }

  async function textOf(chat, file) {
    const text = await store.readText(objectPath(chat, file.hash))
    if (typeof text !== 'string' || bytes(text) !== file.bytes || hash(text) !== file.hash) fail('文件内容校验失败：' + file.path)
    return text
  }

  async function list(chat, { prefix = '', offset = 0, limit = 30 } = {}) {
    logicalPath(prefix, true)
    const head = pointer(chat)
    const files = (await snapshot(chat, head)).files.filter(file => file.path.startsWith(prefix))
    offset = bounded(offset, 0, MAX_FILES)
    limit = bounded(limit, 30, 50)
    return { head, files: copy(files.slice(offset, offset + limit)), total: files.length, offset, nextOffset: offset + limit < files.length ? offset + limit : null }
  }

  async function read(chat, path, { offset = 0, limit = 6000 } = {}) {
    logicalPath(path)
    const head = pointer(chat)
    const file = (await snapshot(chat, head)).files.find(file => file.path === path)
    if (!file) return { head, path, status: 'not-found' }
    const text = await textOf(chat, file)
    offset = bounded(offset, 0, MAX_FILE_BYTES)
    limit = bounded(limit, 6000, 16000)
    const content = text.slice(offset, offset + limit)
    return { head, ...file, status: 'found', text: content, content, offset, total: text.length, nextOffset: offset + limit < text.length ? offset + limit : null }
  }

  async function search(chat, query, { limit = 5 } = {}) {
    if (typeof query !== 'string' || !query.trim() || query.length > 200) fail('搜索词无效')
    const terms = Array.from(new Set(queryTerms(query)))
    const head = pointer(chat)
    const matches = []
    for (const file of (await snapshot(chat, head)).files) {
      const text = await textOf(chat, file)
      const lower = text.toLocaleLowerCase()
      const path = file.path.toLocaleLowerCase()
      const score = terms.reduce((sum, term) => sum + (path.includes(term) ? 2 : 0) + (lower.includes(term) ? 1 : 0), 0)
      if (!score) continue
      const positions = terms.map(term => lower.indexOf(term)).filter(position => position >= 0)
      const start = Math.max(0, (positions.length ? Math.min(...positions) : 0) - 120)
      matches.push({ ...file, score, offset: start, excerpt: text.slice(start, start + 600) })
    }
    matches.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    return { head, matches: matches.slice(0, bounded(limit, 5, 8)), total: matches.length }
  }

  async function prepare(chat, { operationId, writes = [], deletes = [], expectedHead = pointer(chat) } = {}) {
    const body = currentBody(chat)
    if (operationId !== body.id) fail('正文任务已过期')
    if (!Array.isArray(writes) || !Array.isArray(deletes) || writes.length > 32 || deletes.length > 32) fail('单次文件修改数量超限')
    const writeEntries = writes.map(file => {
      const path = logicalPath(file?.path)
      const text = file.text ?? file.content
      if (typeof text !== 'string' || bytes(text) > MAX_FILE_BYTES || text.includes('\u0000')) fail('文件内容无效或超限')
      if (path.toLowerCase().endsWith('.json')) { try { JSON.parse(text) } catch { fail('JSON 文件无效：' + path) } }
      return { path, text }
    }).sort(byPath)
    const deletePaths = deletes.map(path => logicalPath(path)).sort()
    const changes = [...writeEntries.map(file => file.path), ...deletePaths]
    if (new Set(changes.map(path => path.toLowerCase())).size !== changes.length) fail('文件修改存在重复路径')
    const payloadHash = hash(JSON.stringify({ writes: writeEntries, deletes: deletePaths }))
    if (body.memoryReceipt) {
      const receipt = body.memoryReceipt
      if (receipt.payloadHash !== payloadHash || (receipt.expectedHead !== expectedHead && receipt.head !== expectedHead)) fail('同一任务提交了不同记忆内容')
      const prepared = { head: receipt.head, receipt: copy(receipt) }
      validatePrepared(prepared)
      await snapshot(chat, prepared.head)
      return prepared
    }
    if (expectedHead !== pointer(chat)) fail('记忆版本已变化')
    const before = await snapshot(chat)
    const files = new Map(before.files.map(file => [file.path, file]))
    const changedWrites = []
    for (const path of deletePaths) files.delete(path)
    const source = { turn: Number.isSafeInteger(body.turn) && body.turn >= 0 ? body.turn : 0, operationId, branchId: chat.timeline.branchId, revision: chat.timeline.revision }
    for (const file of writeEntries) {
      const digest = hash(file.text)
      if (files.get(file.path)?.hash === digest) continue
      changedWrites.push(file)
      files.set(file.path, { path: file.path, hash: digest, bytes: bytes(file.text), source })
    }
    const sortedFiles = [...files.values()].sort(byPath)
    const unchanged = expectedHead !== null && JSON.stringify(sortedFiles) === JSON.stringify(before.files)
    const manifest = unchanged ? before : validateManifest({ version: 1, parent: expectedHead, files: sortedFiles })
    const head = unchanged ? expectedHead : hash(JSON.stringify(manifest))
    for (const file of changedWrites) await store.writeBytes(objectPath(chat, hash(file.text)), Buffer.from(file.text, 'utf8'))
    if (!unchanged) await store.writeJson(snapshotPath(chat, head), manifest)
    const content = { version: 1, chatKey: identity(chat), operationId, branchId: chat.timeline.branchId, revision: chat.timeline.revision, expectedHead, snapshotParent: manifest.parent, head, payloadHash }
    return { head, receipt: { ...content, checksum: hash(JSON.stringify(content)) } }
  }

  // This synchronous promotion participates in the caller's Chat transaction.
  function apply(chat, prepared, { operationId, branchId, revision } = {}) {
    const receipt = validatePrepared(prepared)
    const body = currentBody(chat)
    if (receipt.chatKey !== identity(chat) || receipt.operationId !== operationId || operationId !== body.id || receipt.branchId !== branchId || branchId !== chat.timeline.branchId || receipt.revision !== revision || revision !== chat.timeline.revision) fail('记忆提交已过期')
    if (body.memoryReceipt) {
      if (body.memoryReceipt.checksum !== receipt.checksum || pointer(chat) !== receipt.head) fail('同一任务提交了不同记忆内容')
      return { status: 'already-applied', head: receipt.head, receipt: copy(receipt) }
    }
    if (pointer(chat) !== receipt.expectedHead) fail('记忆版本已变化')
    chat.gameMemory = { version: 1, head: receipt.head }
    body.memoryReceipt = copy(receipt)
    return { status: 'applied', head: receipt.head, receipt: copy(receipt) }
  }

  async function assertPrepared(chat, prepared) {
    const receipt = validatePrepared(prepared)
    if (receipt.chatKey !== identity(chat)) fail('记忆提交属于其他会话')
    const manifest = await snapshot(chat, prepared.head)
    if (manifest.parent !== receipt.snapshotParent) fail('提交回执与快照不一致')
    for (const file of manifest.files) await textOf(chat, file)
    return prepared
  }

  async function exportFiles(chat) {
    const files = []
    const seen = new Set()
    let head = pointer(chat)
    let total = 0
    let count = 0
    while (head !== null) {
      if (++count > MAX_SNAPSHOTS || seen.has('snapshots/' + head + '.json')) fail('快照历史过长或循环')
      const manifest = await snapshot(chat, head)
      const path = 'snapshots/' + head + '.json'
      const content = JSON.stringify(manifest)
      files.push({ path, content })
      seen.add(path)
      total += bytes(content)
      for (const file of manifest.files) {
        const object = 'objects/' + file.hash + '.txt'
        if (seen.has(object)) continue
        const content = await textOf(chat, file)
        files.push({ path: object, content })
        seen.add(object)
        total += bytes(content)
      }
      if (total > MAX_ARCHIVE_BYTES) fail('导出记忆体积超限')
      head = manifest.parent
    }
    return files
  }

  function parseArchive(files, heads = []) {
    if (!Array.isArray(files) || files.length > MAX_SNAPSHOTS * (MAX_FILES + 1)) fail('导入文件数量超限')
    if (!Array.isArray(heads) || heads.length > MAX_SNAPSHOTS + 1 || heads.some(head => !digest(head))) fail('归档记忆指针无效或数量超限')
    const imported = new Map()
    let total = 0
    for (const file of files) {
      const match = /^(objects|snapshots)\/([a-f0-9]{64})\.(txt|json)$/.exec(file?.path)
      if (!match || match[3] !== (match[1] === 'objects' ? 'txt' : 'json') || imported.has(file.path)) fail('导入文件路径无效或重复')
      const content = typeof file.content === 'string' ? file.content : Buffer.isBuffer(file.content) ? file.content.toString('utf8') : null
      if (content === null || bytes(content) > (match[1] === 'objects' ? MAX_FILE_BYTES : 512 * 1024)) fail('导入文件内容无效或超限')
      total += bytes(content)
      if (total > MAX_ARCHIVE_BYTES) fail('导入记忆体积超限')
      if (match[1] === 'objects') {
        if (content.includes('\u0000') || hash(content) !== match[2]) fail('导入文件校验失败')
        imported.set(file.path, content)
      } else {
        let manifest
        try { manifest = JSON.parse(content) } catch { fail('导入快照无法读取') }
        validateManifest(manifest)
        if (hash(JSON.stringify(manifest)) !== match[2]) fail('导入快照校验失败')
        imported.set(file.path, manifest)
      }
    }
    let snapshots = 0
    for (const [path, manifest] of imported) {
      if (!path.startsWith('snapshots/')) continue
      if (++snapshots > MAX_SNAPSHOTS) fail('导入快照数量超限')
      if (manifest.parent !== null && !imported.has('snapshots/' + manifest.parent + '.json')) fail('导入缺少历史快照')
      for (const file of manifest.files) {
        const text = imported.get('objects/' + file.hash + '.txt')
        if (typeof text !== 'string' || bytes(text) !== file.bytes) fail('导入缺少记忆文件')
        if (file.path.toLowerCase().endsWith('.json')) { try { JSON.parse(text) } catch { fail('导入 JSON 文件无效') } }
      }
    }
    for (const head of new Set(heads)) {
      if (!imported.has('snapshots/' + head + '.json')) fail('归档缺少记忆快照')
    }
    return { imported, total, snapshots }
  }

  /** Check the combined save, including heads reachable from rollback revisions, without I/O. */
  function validateArchive(files, heads = []) {
    const { imported, total, snapshots } = parseArchive(files, heads)
    return { files: imported.size, bytes: total, snapshots }
  }

  async function importFiles(chat, files) {
    identity(chat)
    const head = pointer(chat)
    const { imported } = parseArchive(files, head === null ? [] : [head])
    for (const [path, content] of imported) {
      if (path.startsWith('snapshots/')) await store.writeJson(root(chat) + path, content)
      else await store.writeBytes(root(chat) + path, Buffer.from(content, 'utf8'))
    }
    return head === null ? null : { version: 1, head }
  }

  async function fork(sourceChat, targetChat) {
    if (identity(sourceChat) === identity(targetChat)) fail('分叉需要独立会话')
    const head = pointer(sourceChat)
    const importedChat = { ...targetChat, gameMemory: head === null ? null : { version: 1, head } }
    await importFiles(importedChat, await exportFiles(sourceChat))
    return head === null ? null : { version: 1, head }
  }

  return { list, read, search, prepare, apply, assertPrepared, validatePrepared: assertPrepared, validateArchive, fork, exportFiles, importFiles }
}
