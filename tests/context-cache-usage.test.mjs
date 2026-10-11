import test from 'node:test'
import assert from 'node:assert/strict'
import { contextUsageMetrics, normalizedContextUsage, summarizeContextUsage, requestPrefixMetrics } from '../tavern-plugin/lib/domain/context-cache-metrics.js'
import { createModelRequestLog } from '../tavern-plugin/lib/domain/model-request-log.js'
import { registerModelStreamHooks } from '../tavern-plugin/lib/hooks/model-stream.js'

test('cache metrics use normalized disjoint counters and keep missing usage unknown', () => {
  assert.deepEqual(contextUsageMetrics({ inputTokens: 100, cacheReadTokens: 900, outputTokens: 10, totalTokens: 1010 }),
    { usage: { inputTokens: 100, outputTokens: 10, totalTokens: 1010, cacheReadTokens: 900 }, promptTokens: 1000, cacheReadRatio: .9 })
  assert.equal(contextUsageMetrics({ inputTokens: 100, outputTokens: 10 }).cacheReadRatio, null)
  assert.equal(contextUsageMetrics({ inputTokens: 100, cacheReadTokens: 0 }).promptTokens, null)
  assert.equal(contextUsageMetrics({ inputTokens: 100, cacheReadTokens: 100, cacheWriteTokens: 200 }).cacheReadRatio, .25)
  assert.equal(normalizedContextUsage({ prompt_tokens: 1000, cached_tokens: 900 }), null)
  assert.deepEqual(normalizedContextUsage({ inputTokens: -1, totalTokens: NaN, cacheReadTokens: 0, secret: 'private' }), { cacheReadTokens: 0 })
  assert.equal(contextUsageMetrics({ totalTokens: 1, outputTokens: 2, cacheReadTokens: 2 }).cacheReadRatio, null)
  assert.equal(contextUsageMetrics({ totalTokens: 10, outputTokens: 1, cacheReadTokens: 11 }).cacheReadRatio, null)
  const sum = summarizeContextUsage([{ usage: null }, { scope: 'foreground', task: 'reply', usage: { inputTokens: 100, cacheReadTokens: 900, outputTokens: 10, totalTokens: 1010 } }])
  assert.equal(sum.requestsWithoutUsage, 1)
  assert.equal(sum.cacheReadRatio, .9)
  assert.equal(sum.ratioRequests, 1)
})

test('structural prefix evidence removes source/id metadata and never returns prompt text', () => {
  const first = { tools: [{ name: 'tool' }], messages: [{ id: 'a', role: 'user', source: { secret: 'native metadata' }, content: [{ type: 'text', text: 'private prompt' }] }] }
  const second = structuredClone(first); second.messages[0].id = 'b'; second.messages[0].source.secret = 'different metadata'
  const result = requestPrefixMetrics(first, second)
  assert.equal(result.sharedPrefixRatio, 1)
  assert.equal(result.promptHash.length, 64)
  assert.equal(JSON.stringify(result).includes('private'), false)
  assert.equal(requestPrefixMetrics(null, first).sharedPrefixCharacters, null)
  second.tools.push({ name: 'new tool' })
  assert.ok(requestPrefixMetrics(first, second).sharedPrefixRatio < 1)
})

test('request usage sidecars are readable without request bodies and stay isolated by chat', async () => {
  const files = new Map(), reads = []; let counter = 0
  const log = createModelRequestLog({ id: () => String(++counter),
    readJson: async path => { reads.push(path); return structuredClone(files.get(path)) },
    writeJson: async (path, value) => files.set(path, structuredClone(value)),
    updateJson: async (path, fn) => files.set(path, fn(structuredClone(files.get(path)))) })
  const a = await log.record({ chat: { id: 'owner' }, coordinates: { turn: 2 }, options: { sessionId: 'agent', provider: 'provider', model: 'model', messages: [{ role: 'user', content: [{ type: 'text', text: 'private prompt' }] }] } })
  await log.complete({ chatId: 'owner', id: a.id, usage: { inputTokens: 100, cacheReadTokens: 900, outputTokens: 10, totalTokens: 1010, secret: 'private' } })
  const b = await log.record({ chat: { id: 'owner' }, options: { messages: [] } })
  await log.complete({ chatId: 'owner', id: b.id })
  reads.length = 0
  const audit = await log.contextCacheAudit('owner')
  assert.equal(audit.summary.cacheReadRatio, .9)
  assert.equal(audit.requests[0].provider, 'provider')
  assert.equal(audit.requests[1].usage, null)
  assert.equal(reads.some(path => path.endsWith(a.id + '.json')), false)
  assert.equal(JSON.stringify(audit).includes('private'), false)
  assert.equal((await log.contextCacheAudit('other')).requests.length, 0)
  assert.ok((await log.contextCacheAudit('owner', { includePrefix: true })).requests[0].prefix.promptHash)
  await assert.rejects(log.contextCacheAudit('owner', { limit: 101 }), /1–100/)
})

test('prefix audit compares only the same session and provider/model route, maximum eight snapshots', async () => {
  const files = new Map(), reads = []; let counter = 0
  const log = createModelRequestLog({ id: () => String(++counter),
    readJson: async path => { reads.push(path); return structuredClone(files.get(path)) },
    writeJson: async (path, value) => files.set(path, structuredClone(value)),
    updateJson: async (path, fn) => files.set(path, fn(structuredClone(files.get(path)))) })
  for (let index = 0; index < 12; index++) {
    const record = await log.record({ chat: { id: 'owner' }, options: { sessionId: 'same', provider: 'p', model: index > 9 ? 'new' : 'old', messages: [] } })
    await log.complete({ chatId: 'owner', id: record.id })
  }
  reads.length = 0
  const audit = await log.contextCacheAudit('owner', { includePrefix: true })
  assert.equal(audit.requests.filter(row => row.prefix).length, 8)
  assert.equal(audit.requests[10].prefix.sharedPrefixCharacters, null)
  assert.equal(audit.requests[11].prefix.sharedPrefixRatio, 1)
  assert.equal(reads.filter(path => !path.endsWith('index.json') && !path.endsWith('.result.json')).length, 8)
})

test('stream usage is captured once without modifying chunks, including failed streams', async () => {
  for (const fail of [false, true]) {
    const handlers = [], captured = []
    registerModelStreamHooks({ ctx: { on: (name, handler) => { if (name === 'llm/stream') handlers.push(handler) } },
      backgroundAgentRunner: { owns: () => false, requestContext: () => null }, requestCoordinates: new Map(),
      foregroundStrategies: { projectRequest: () => null, completeRequest() {} },
      chatHeaderForSession: async () => ({ id: 'chat', mode: 'story', requestMode: 'sillytavern' }),
      modelRequestLog: { record: async () => ({ id: 'request' }), complete: async input => captured.push(input) },
      worldbookRecallLog: { requested: async () => {} }, str: value => String(value ?? '') })
    const usageChunk = { type: 'usage', usage: { inputTokens: 10, cacheReadTokens: 90, outputTokens: 5, totalTokens: 105 } }
    const stream = handlers.at(-1)({ sessionId: 'agent', messages: [] }, async function* () {
      yield usageChunk
      if (fail) throw new Error('offline')
      yield { type: 'finish', reason: { kind: 'stop' } }
    })
    const seen = []
    try { for await (const chunk of stream) seen.push(chunk) } catch (error) { assert.equal(fail, true) }
    assert.equal(seen[0], usageChunk)
    assert.deepEqual(captured[0].usage, usageChunk.usage)
    assert.equal(captured[0].error, fail ? 'offline' : null)
  }
})
