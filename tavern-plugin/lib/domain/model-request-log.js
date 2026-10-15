import { randomUUID } from 'node:crypto'
import { normalizedContextUsage, contextUsageMetrics, summarizeContextUsage, requestPrefixMetrics } from './context-cache-metrics.js'
import { normalizeDreamSikeExecutionPolicy } from './dream-sike-execution-policy.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function phaseEntries(messages, phase) {
  const name = 'tavern:runtime-preset-' + phase
  return (Array.isArray(messages) ? messages : []).filter(function (message) {
    return Array.isArray(message && message.source && message.source.sections) && message.source.sections.some(function (section) { return section && section.name === name })
  })
}

function redactRequestMetadata(value) {
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(redactRequestMetadata)
  if (typeof value.entries === 'function' && typeof value.get === 'function') value = Object.fromEntries(value.entries())
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    /^(authorization|proxy-authorization|cookie|set-cookie|.*api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|password)$/i.test(key) ? '[REDACTED]' : redactRequestMetadata(item)]))
}

function serializableRequest(options) {
  const result = {}
  for (const [key, value] of Object.entries(options || {})) {
    if (key === 'signal') continue
    // Preserve prompt/tool evidence verbatim; redact transport/config metadata only.
    result[key] = ['messages', 'tools', 'system'].includes(key) ? value : redactRequestMetadata({ [key]: value })[key]
  }
  return JSON.parse(JSON.stringify(result))
}

// Keep the public evidence shape stable; phases are a projection of the request.
function evidenceRecord(record, result) {
  const messages = record.request && record.request.messages
  return {
    ...record,
    ...(result || {}),
    version: 1,
    phases: record.phases || {
      front: phaseEntries(messages, 'front'),
      middle: phaseEntries(messages, 'middle'),
      back: phaseEntries(messages, 'back')
    }
  }
}

// Request bodies are debugging evidence (every agent step of a long chat is
// several MB); keep the full text of the most recent turns only. Index rows,
// timing and responses stay for every request.
export const MODEL_REQUEST_KEEP_TURNS = 30
const PRUNED_NOTE = '该请求原文已清理（只保留最近 ' + MODEL_REQUEST_KEEP_TURNS + ' 轮）'

export function createModelRequestLog(options = {}) {
  const readJson = options.readJson
  const writeJson = options.writeJson
  const updateJson = options.updateJson
  const remove = typeof options.remove === 'function' ? options.remove : async function () {}
  // Bodies are written compactly when the adapter allows: indentation alone inflates MBs.
  const writeBody = typeof options.writeText === 'function'
    ? function (path, value) { return options.writeText(path, JSON.stringify(value)) } : writeJson
  const now = typeof options.now === 'function' ? options.now : Date.now
  const id = typeof options.id === 'function' ? options.id : function () { return randomUUID() }
  if (typeof readJson !== 'function' || typeof writeJson !== 'function' || typeof updateJson !== 'function') throw new TypeError('模型请求日志缺少存储适配器')

  // Cache only durable ownership, never request bodies. Bound idle-session memory.
  const sessionOwners = new Map()
  const ownerWrites = new Map()
  function rememberOwner(sessionId, chatId) {
    sessionOwners.delete(sessionId)
    sessionOwners.set(sessionId, chatId)
    if (sessionOwners.size > 512) sessionOwners.delete(sessionOwners.keys().next().value)
  }
  async function ensureSessionOwner(sessionId, chatId) {
    if (!sessionId) return
    const previous = ownerWrites.get(sessionId)
    if (previous) {
      await previous.catch(() => {})
      return ensureSessionOwner(sessionId, chatId)
    }
    if (sessionOwners.get(sessionId) === chatId) return
    const pending = (async () => {
      const path = 'model-request-sessions/' + encodeURIComponent(sessionId) + '.json'
      const saved = await readJson(path)
      if (saved?.chatId !== chatId) await writeJson(path, { chatId })
      rememberOwner(sessionId, chatId)
    })()
    ownerWrites.set(sessionId, pending)
    try { await pending } finally { if (ownerWrites.get(sessionId) === pending) ownerWrites.delete(sessionId) }
  }

  // Writes run off the request path, in order per chat: completion follows its record.
  const queues = new Map()
  function enqueue(chatId, task) {
    const next = (queues.get(chatId) || Promise.resolve()).then(task)
    const settled = next.catch(function (error) { console.error('dsh-tavern: 模型请求日志写入失败', str(error && error.message || error)) })
    queues.set(chatId, settled)
    settled.then(function () { if (queues.get(chatId) === settled) queues.delete(chatId) })
    return next
  }
  // Readers see every record already returned to a caller.
  function settled(chatId) { return queues.get(str(chatId)) || Promise.resolve() }
  // Mark rows beyond the retained window; the caller deletes their bodies afterwards.
  function retainRecentBodies(requests, latestTurn, pruned) {
    const cutoff = latestTurn - MODEL_REQUEST_KEEP_TURNS
    if (cutoff < 1) return requests
    return requests.map(function (entry) {
      const turn = Number(entry && entry.turn)
      if (!entry || entry.pruned || !(turn > 0 && turn <= cutoff)) return entry
      pruned.push(entry.id)
      return Object.assign({}, entry, { pruned: true })
    })
  }

  const executionLimits = Object.freeze({
    query: policy => normalizeDreamSikeExecutionPolicy(policy).queryRequests,
    initial: () => 1,
    revision: policy => normalizeDreamSikeExecutionPolicy(policy).revisionRequests,
    settlement: null,
    addons: () => 1,
    compaction: null,
    maintenance: null
  })
  const executionStages = ['query', 'initial', 'revision', 'settlement', 'addons', 'addons-retry', 'compaction', 'maintenance']
  function freshExecution(input, policy, stamp) {
    return {
      version: 1,
      rootOperationId: str(input.rootOperationId),
      branchId: str(input.branchId),
      operationIds: [...new Set([str(input.rootOperationId), str(input.operationId)].filter(Boolean))],
      turn: Math.max(0, Number(input.rootTurn ?? input.turn) || 0),
      policy,
      startedAt: stamp,
      updatedAt: stamp,
      counts: Object.fromEntries(executionStages.map(stage => [stage, 0])),
      requestCount: 0,
      requests: []
    }
  }

  function executionFor(index, input, policy, stamp) {
    const saved = index.executionUsage && typeof index.executionUsage === 'object' ? index.executionUsage : {}
    const executions = Array.isArray(saved.executions) ? saved.executions : []
    const rootOperationId = str(input.rootOperationId)
    const branchId = str(input.branchId)
    const current = executions.find(item => item?.rootOperationId === rootOperationId && item?.branchId === branchId)
    return current ? { saved, executions, current } : { saved, executions, current: freshExecution(input, policy, stamp) }
  }

  /** Reserve the provider-boundary attempt in the same serialized index as request evidence. */
  function reserveExecutionAttempt(input = {}) {
    const chatId = str(input.chatId), attemptId = str(input.attemptId), stage = str(input.stage)
    if (!chatId || !attemptId || !executionStages.includes(stage)) return Promise.resolve({ accepted: true, tracked: false })
    return enqueue(chatId, async function () {
      const stamp = now(), base = 'model-requests/' + chatId + '/'
      let result = { accepted: true, tracked: false }
      await updateJson(base + 'index.json', function (value) {
        const index = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
        const policy = normalizeDreamSikeExecutionPolicy(input.policy)
        const state = executionFor(index, input, policy, stamp)
        const currentPolicy = normalizeDreamSikeExecutionPolicy(state.current.policy || policy)
        state.current.policy = input.allowPolicyUpdate === true ? policy : currentPolicy
        if (!Array.isArray(state.current.operationIds)) state.current.operationIds = [str(state.current.rootOperationId)].filter(Boolean)
        const operationId = str(input.operationId)
        if (operationId && !state.current.operationIds.includes(operationId)) state.current.operationIds.push(operationId)
        state.current.operationIds = state.current.operationIds.slice(-32)
        if (!state.current.counts || typeof state.current.counts !== 'object' || Array.isArray(state.current.counts)) {
          state.current.counts = Object.fromEntries(executionStages.map(stage => [stage, 0]))
        }
        if (!Array.isArray(state.current.requests)) state.current.requests = []
        const requests = state.current.requests
        if (!Number.isSafeInteger(state.current.requestCount) || state.current.requestCount < requests.length) {
          state.current.requestCount = requests.length
        }
        const previous = requests.find(request => request.attemptId === attemptId)
        if (previous) {
          result = { accepted: previous.status !== 'blocked', tracked: true, stage, attemptId, limit: previous.limit ?? null,
            used: state.current.counts?.[stage] || 0, existing: true }
          return index
        }
        const limitRule = executionLimits[stage]
        const limit = typeof limitRule === 'function' ? limitRule(state.current.policy) : null
        const used = Math.max(0, Number(state.current.counts?.[stage]) || 0)
        const blocked = Number.isSafeInteger(limit) && used >= limit
        const request = {
          attemptId, stage, status: blocked ? 'blocked' : 'reserved',
          operationId,
          turn: Math.max(0, Number(input.rootTurn ?? input.turn) || 0),
          step: Math.max(0, Number(input.step) || 0), purpose: str(input.purpose),
          provider: str(input.provider), model: str(input.model), createdAt: stamp,
          ...(limit === null ? {} : { limit })
        }
        if (!blocked) state.current.counts[stage] = used + 1
        state.current.requestCount += 1
        state.current.requests = requests.concat(request).slice(-128)
        state.current.updatedAt = stamp
        const executions = state.executions.filter(item => item !== state.current).concat(state.current).slice(-12)
        result = { accepted: !blocked, tracked: true, stage, attemptId, limit, used: blocked ? used : used + 1, blocked }
        return {
          ...index,
          version: 1,
          chatId,
          executionUsage: { version: 1, activeRootOperationId: state.current.rootOperationId, executions }
        }
      })
      return result
    })
  }

  function completeExecutionAttempt(input = {}) {
    const chatId = str(input.chatId), rootOperationId = str(input.rootOperationId), branchId = str(input.branchId), attemptId = str(input.attemptId)
    if (!chatId || !rootOperationId || !attemptId) return Promise.resolve(null)
    return enqueue(chatId, async function () {
      const stamp = now(), path = 'model-requests/' + chatId + '/index.json'
      let completed = null
      await updateJson(path, function (value) {
        const index = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
        const saved = index.executionUsage && typeof index.executionUsage === 'object' ? index.executionUsage : {}
        const executions = Array.isArray(saved.executions) ? saved.executions : []
        const execution = executions.find(item => item?.rootOperationId === rootOperationId
          && (!branchId || item?.branchId === branchId))
        const request = execution?.requests?.find(item => item.attemptId === attemptId)
        if (!request || request.status === 'blocked') return index
        request.status = ['completed', 'failed', 'aborted'].includes(input.status) ? input.status : 'failed'
        request.completedAt = stamp
        request.elapsedMs = Math.max(0, stamp - (Number(request.createdAt) || stamp))
        request.usage = normalizedContextUsage(input.usage)
        request.error = str(input.error).slice(0, 500)
        execution.updatedAt = stamp
        completed = { ...request }
        return { ...index, executionUsage: { ...saved, executions } }
      })
      return completed
    })
  }

  async function executionUsage(chatId, rootOperationId, branchId) {
    // This status projection must not wait for the much larger request-body evidence write.
    const index = await readJson('model-requests/' + str(chatId) + '/index.json')
    const saved = index?.executionUsage
    const executions = Array.isArray(saved?.executions) ? saved.executions : []
    const execution = rootOperationId
      ? executions.find(item => (item?.rootOperationId === str(rootOperationId)
        || item?.operationIds?.includes(str(rootOperationId)))
        && (!branchId || item?.branchId === str(branchId)))
      : executions.find(item => item?.rootOperationId === saved?.activeRootOperationId
        && (!branchId || item?.branchId === str(branchId)))
    return execution ? JSON.parse(JSON.stringify(execution)) : null
  }

  async function record(input) {
    const chat = input.chat
    const context = input.context
    const coordinates = input.coordinates
    const requestOptions = input.options
    const stamp = now()
    const requestId = stamp.toString(36) + '-' + id()
    const scope = context && context.scope === 'background' ? 'background' : 'foreground'
    const turn = scope === 'background' ? Math.max(0, Number(context.turn) || 0) : Math.max(0, Number(coordinates && coordinates.turn) || 0)
    const record = {
      version: 2,
      id: requestId,
      chatId: chat.id,
      scope,
      task: scope === 'background' ? str(context.task) : 'reply',
      sessionId: str(requestOptions && requestOptions.sessionId),
      turn,
      agentTurn: Math.max(0, Number(coordinates && coordinates.turn) || 0),
      step: Math.max(1, Number(coordinates && coordinates.step) || 1),
      attemptId: str(input.attemptId || coordinates?.attemptId),
      stage: str(input.stage || coordinates?.stage),
      rootOperationId: str(input.rootOperationId || coordinates?.rootOperationId || context?.rootOperationId),
      branchId: str(input.branchId || coordinates?.branchId || context?.branchId),
      purpose: str(input.purpose || requestOptions?.purpose),
      createdAt: stamp,
      status: 'running',
      requestMode: chat.requestMode === 'sillytavern' ? 'sillytavern' : 'dsh',
      compatibility: chat.requestMode === 'sillytavern' && chat.compatibilityTraces && chat.compatibilityTraces[String(turn)]
        ? JSON.parse(JSON.stringify(chat.compatibilityTraces[String(turn)]))
        : null,
      frame: coordinates && coordinates.frame ? JSON.parse(JSON.stringify(coordinates.frame)) : null,
      bypassPlan: {
        id: str(chat.bypassPlanId || chat.runtimePresetSnapshot && chat.runtimePresetSnapshot.planId),
        name: str(chat.runtimePresetSnapshot && chat.runtimePresetSnapshot.planName),
        digest: str(chat.runtimePresetSnapshot && chat.runtimePresetSnapshot.digest)
      },
      request: serializableRequest(requestOptions)
    }
    const base = 'model-requests/' + chat.id + '/'
    // The body was cloned above; the model request itself must not wait for the disk.
    enqueue(chat.id, async function () {
      await writeBody(base + requestId + '.json', record)
      // Persist timing separately so completion after a restart never loads the body.
      await writeJson(base + requestId + '.result.json', { createdAt: stamp, status: 'running' })
      const pruned = []
      await updateJson(base + 'index.json', function (value) {
        const current = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
        const requests = Array.isArray(current.requests) ? current.requests : []
        return {
          ...current,
          version: 1,
          chatId: chat.id,
          requests: retainRecentBodies(requests.concat([{
            id: requestId, scope, task: record.task, sessionId: record.sessionId,
            turn: record.turn, agentTurn: record.agentTurn, step: record.step,
            attemptId: record.attemptId, stage: record.stage, rootOperationId: record.rootOperationId,
            branchId: record.branchId, purpose: record.purpose,
            createdAt: record.createdAt, preset: record.preset,
            provider: str(requestOptions?.provider), model: str(requestOptions?.model)
          }]), Math.max(turn, record.agentTurn), pruned)
        }
      })
      for (const prunedId of pruned) await remove(base + prunedId + '.json')
      await ensureSessionOwner(record.sessionId, chat.id)
    })
    return evidenceRecord(record)
  }

  function complete(input = {}) {
    return enqueue(str(input.chatId), function () { return completeNow(input) })
  }
  async function completeNow(input) {
    const base = 'model-requests/' + str(input.chatId) + '/'
    const path = base + str(input.id) + '.json'
    const resultPath = base + str(input.id) + '.result.json'
    // Old records have no sidecar. Read them once when completing, without rewriting.
    const previous = await readJson(resultPath) || await readJson(path)
    if (!previous) return null
    const completedAt = now()
    const createdAt = Number.isFinite(previous.createdAt) ? previous.createdAt : completedAt
    const result = {
      createdAt,
      status: str(input.error) !== '' ? 'failed' : input.finish?.kind === 'aborted' ? 'aborted'
        : input.finish?.kind === 'error' ? 'failed' : 'completed',
      completedAt,
      durationMs: Math.max(0, completedAt - createdAt),
      response: {
        text: str(input.text),
        finish: input.finish === undefined ? null : JSON.parse(JSON.stringify(input.finish)),
        error: str(input.error) || null
      },
      usage: normalizedContextUsage(input.usage)
    }
    await writeJson(resultPath, result)
    // Callers needing the full request use evidence(); completion returns only state.
    return result
  }

  async function evidence(chatId, turn) {
    await settled(chatId)
    const base = 'model-requests/' + chatId + '/'
    const index = await readJson(base + 'index.json')
    const entries = Array.isArray(index && index.requests) ? index.requests.filter(function (item) {
      return !Number.isSafeInteger(Number(turn)) || Number(turn) < 1 || Number(item.turn) === Number(turn)
    }) : []
    const requests = []
    for (const entry of entries) {
      if (entry.pruned) {
        requests.push(Object.assign({}, entry, await readJson(base + entry.id + '.result.json'), { pruned: true, note: PRUNED_NOTE, request: null }))
        continue
      }
      const record = await readJson(base + entry.id + '.json')
      if (record) requests.push(evidenceRecord(record, await readJson(base + entry.id + '.result.json')))
    }
    return { loaded: true, chatId, requests }
  }

  async function list(chatId) {
    await settled(chatId)
    const index = await readJson('model-requests/' + chatId + '/index.json')
    return Array.isArray(index?.requests) ? index.requests : []
  }
  async function detail(chatId, id) {
    const entries = await list(chatId)
    const entry = entries.find(item => item.id === id)
    if (!entry) throw new Error('请求记录不存在')
    if (entry.pruned) throw new Error(PRUNED_NOTE)
    const base = 'model-requests/' + chatId + '/'
    const record = await readJson(base + id + '.json')
    if (!record) throw new Error('请求记录已缺失')
    return evidenceRecord(record, await readJson(base + id + '.result.json'))
  }
  async function latest(chatId, knownId, sessionId) {
    const entries = await list(chatId)
    const entry = entries.findLast(item => sessionId ? item.sessionId === sessionId : item.scope === 'foreground')
    if (!entry) return null
    if (knownId === entry.id) return { unchanged: true, id: entry.id }
    const base = 'model-requests/' + chatId + '/'
    const record = await readJson(base + entry.id + '.json')
    return record ? evidenceRecord(record, await readJson(base + entry.id + '.result.json')) : null
  }
  async function latestForSession(sessionId, knownId, fallbackChatId) {
    if (!sessionId) return null;
    const owner = await readJson('model-request-sessions/' + encodeURIComponent(sessionId) + '.json');
    const chatId = owner?.chatId || fallbackChatId;
    return chatId ? latest(chatId, knownId, sessionId) : null;
  }
  async function contextCacheAudit(chatId, { limit = 50, includePrefix = false } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('上下文审计请求数量须为 1–100')
    if (typeof includePrefix !== 'boolean') throw new Error('前缀审计开关须为布尔值')
    const entries = (await list(chatId)).slice(-limit), rows = [], previous = new Map()
    for (const [index, entry] of entries.entries()) {
      const base = 'model-requests/' + chatId + '/'
      const result = await readJson(base + entry.id + '.result.json')
      const row = { id: entry.id, scope: entry.scope, task: entry.task, sessionId: entry.sessionId,
        turn: entry.turn, agentTurn: entry.agentTurn, step: entry.step,
        attemptId: entry.attemptId, stage: entry.stage, rootOperationId: entry.rootOperationId,
        branchId: entry.branchId, purpose: entry.purpose,
        provider: entry.provider, model: entry.model, createdAt: entry.createdAt,
        status: result?.status || 'unknown', durationMs: result?.durationMs ?? null, ...contextUsageMetrics(result?.usage) }
      // Full bodies can be MBs. Default usage audits read sidecars only; opt-in
      // structural comparisons are bounded to eight recent retained snapshots.
      if (includePrefix && index >= entries.length - 8 && !entry.pruned) {
        const body = await readJson(base + entry.id + '.json')
        if (body?.request) {
          row.provider ||= body.request.provider; row.model ||= body.request.model
          const key = JSON.stringify([entry.sessionId, row.provider, row.model])
          row.prefix = requestPrefixMetrics(previous.get(key), body.request)
          previous.set(key, body.request)
        }
      }
      rows.push(row)
    }
    return { version: 1, chatId, convention: 'dsh-disjoint-token-usage',
      source: 'provider-reported-stream-usage', summary: summarizeContextUsage(rows), requests: rows }
  }
  return Object.freeze({ record, complete, evidence, list, detail, latest, latestForSession, contextCacheAudit,
    reserveExecutionAttempt, completeExecutionAttempt, executionUsage })
}
