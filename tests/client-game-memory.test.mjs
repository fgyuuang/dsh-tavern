import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../tavern-plugin/src/client/features/game-memory.js', import.meta.url), 'utf8')
const createReader = new Function(source + '\nreturn createGameMemoryReader;')()
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }

test('换会话、文档或搜索后，迟到成功响应和错误均不覆盖新请求', async () => {
  const calls = [], events = []
  const reader = createReader(args => { const item = deferred(); calls.push({ ...item, args }); return item.promise })
  const load = args => reader.read(args, memory => events.push(['value', memory.head]), error => events.push(['error', error]), () => events.push(['done']))
  const old = load({ sessionId: 'old', action: 'read', path: 'memory/old.md' })
  const failed = load({ sessionId: 'new', action: 'search', query: 'old query' })
  const current = load({ sessionId: 'new', action: 'read', path: 'memory/new.md', offset: 6000 })
  calls[2].resolve({ memory: { head: 'new-head' } })
  await current
  calls[0].resolve({ memory: { head: 'old-head' } })
  calls[1].reject(new Error('old network failure'))
  await Promise.all([old, failed])
  assert.deepEqual(events, [['value', 'new-head'], ['done']])
})

test('关闭面板或分支刷新取消旧请求；重试可展示当前错误并再次成功', async () => {
  const calls = [], events = []
  const reader = createReader(() => { const item = deferred(); calls.push(item); return item.promise })
  const load = () => reader.read({}, memory => events.push(memory.head), error => events.push(error))
  const cancelled = load()
  reader.cancel()
  calls[0].resolve({ memory: { head: 'discard' } })
  await cancelled
  assert.deepEqual(events, [])
  const failed = load()
  calls[1].reject(new Error('offline'))
  await failed
  const retry = load()
  calls[2].resolve({ memory: { head: 'restored-branch-head' } })
  await retry
  assert.deepEqual(events, ['offline', 'restored-branch-head'])
})
