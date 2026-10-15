import { normalizeDreamSikeExecutionPolicy } from './dream-sike-execution-policy.js'

const PHASE_STAGE = Object.freeze({
  reading: 'query',
  preparation: 'query',
  'query-paused': 'query',
  draft: 'initial',
  'draft-retry': 'revision',
  checking: 'revision',
  revision: 'revision',
  confirming: 'revision',
  paused: 'revision'
})

export function dreamSikeExecutionStageForPhase(phase) {
  return PHASE_STAGE[phase?.name] || ''
}

export function dreamSikeExecutionCounts(usage) {
  const counts = usage?.counts && typeof usage.counts === 'object' ? usage.counts : {}
  return Object.fromEntries(['query', 'initial', 'revision', 'settlement', 'addons', 'addons-retry', 'compaction', 'maintenance']
    .map(stage => [stage, Math.max(0, Number(counts[stage]) || 0)]))
}

export function dreamSikeExecutionView(usage, policy) {
  if (!usage || typeof usage !== 'object') return null
  const normalizedPolicy = normalizeDreamSikeExecutionPolicy(usage.policy || policy)
  const counts = dreamSikeExecutionCounts(usage)
  const limits = {
    query: normalizedPolicy.queryRequests,
    initial: 1,
    revision: normalizedPolicy.revisionRequests,
    addons: 1
  }
  return {
    rootOperationId: String(usage.rootOperationId || ''),
    branchId: String(usage.branchId || ''),
    turn: Math.max(0, Number(usage.turn) || 0),
    policy: normalizedPolicy,
    counts,
    limits,
    requestCount: Math.max(0, Number(usage.requestCount) || (Array.isArray(usage.requests) ? usage.requests.length : 0)),
    requests: Array.isArray(usage.requests) ? usage.requests.slice(-64).map(request => ({
      attemptId: String(request.attemptId || ''), stage: String(request.stage || 'maintenance'),
      status: String(request.status || 'unknown'), step: Math.max(0, Number(request.step) || 0),
      purpose: String(request.purpose || ''), provider: String(request.provider || ''), model: String(request.model || ''),
      createdAt: Number.isSafeInteger(request.createdAt) ? request.createdAt : null,
      completedAt: Number.isSafeInteger(request.completedAt) ? request.completedAt : null,
      elapsedMs: Number.isSafeInteger(request.elapsedMs) ? request.elapsedMs : null,
      usage: request.usage && typeof request.usage === 'object' ? { ...request.usage } : null,
      error: String(request.error || '')
    })) : [],
    startedAt: Number.isSafeInteger(usage.startedAt) ? usage.startedAt : null,
    updatedAt: Number.isSafeInteger(usage.updatedAt) ? usage.updatedAt : null
  }
}
