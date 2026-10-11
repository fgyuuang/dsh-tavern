import { createHash } from 'node:crypto'

const FIELDS = ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']
const count = value => Number.isSafeInteger(value) && value >= 0

// Only the host's normalized TokenUsage is accepted. Provider wire aliases have
// different inclusion rules and must be normalized by their adapter first.
export function normalizedContextUsage(value) {
  if (!value || typeof value !== 'object') return null
  const usage = Object.fromEntries(FIELDS.filter(key => count(value[key])).map(key => [key, value[key]]))
  return Object.keys(usage).length ? usage : null
}

export function contextUsageMetrics(value) {
  const usage = normalizedContextUsage(value)
  if (!usage) return { usage: null, promptTokens: null, cacheReadRatio: null }
  // Host input/cache-read/cache-write counters are disjoint. Exact aggregate
  // totals avoid interpreting an absent cache counter as a reported zero.
  let promptTokens = null
  if (count(usage.totalTokens) && count(usage.outputTokens) && usage.totalTokens >= usage.outputTokens) {
    promptTokens = usage.totalTokens - usage.outputTokens
  } else if (['inputTokens', 'cacheReadTokens', 'cacheWriteTokens'].every(key => count(usage[key]))) {
    const total = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
    if (Number.isSafeInteger(total)) promptTokens = total
  }
  const cacheReadRatio = count(usage.cacheReadTokens) && promptTokens > 0 && usage.cacheReadTokens <= promptTokens
    ? usage.cacheReadTokens / promptTokens : null
  return { usage, promptTokens, cacheReadRatio }
}

export function summarizeContextUsage(rows) {
  const totals = {}, reported = {}, groups = new Map()
  let requestsWithUsage = 0, ratioRequests = 0, ratioPromptTokens = 0, ratioCacheReadTokens = 0
  for (const row of rows) {
    const metrics = contextUsageMetrics(row.usage)
    if (!metrics.usage) continue
    requestsWithUsage++
    for (const [key, value] of Object.entries(metrics.usage)) {
      totals[key] = (totals[key] || 0) + value
      reported[key] = (reported[key] || 0) + 1
    }
    if (metrics.cacheReadRatio !== null) {
      ratioRequests++; ratioPromptTokens += metrics.promptTokens; ratioCacheReadTokens += metrics.usage.cacheReadTokens
    }
    const key = JSON.stringify([row.scope || '', row.task || '', row.provider || '', row.model || ''])
    const group = groups.get(key) || { scope: row.scope, task: row.task, provider: row.provider, model: row.model, rows: [] }
    group.rows.push(row); groups.set(key, group)
  }
  return {
    requests: rows.length, requestsWithUsage, requestsWithoutUsage: rows.length - requestsWithUsage,
    totals, reported, ratioRequests, cacheReadRatio: ratioPromptTokens > 0 ? ratioCacheReadTokens / ratioPromptTokens : null,
    groups: [...groups.values()].map(({ rows: members, ...group }) => ({ ...group, requests: members.length,
      promptTokens: members.reduce((sum, row) => sum + (contextUsageMetrics(row.usage).promptTokens || 0), 0) }))
  }
}

function serializedPrompt(request = {}) {
  return JSON.stringify({ tools: request.tools || [], ...(request.system ? { system: request.system } : {}),
    messages: (request.messages || []).map(message => ({ role: message.role, content: message.content })) })
}

// Structural evidence, not a tokenizer or a claim about provider cache state.
// Source tags and native message IDs never enter the comparable prompt view.
export function requestPrefixMetrics(previous, current) {
  const text = serializedPrompt(current), before = previous ? serializedPrompt(previous) : null
  let shared = 0
  if (before !== null) while (shared < Math.min(before.length, text.length) && before[shared] === text[shared]) shared++
  return { serializedCharacters: text.length, sharedPrefixCharacters: before === null ? null : shared,
    sharedPrefixRatio: before === null || !text.length ? null : shared / text.length,
    promptHash: createHash('sha256').update(text).digest('hex'), measurement: 'normalized-request-characters' }
}
