import { isDeepStrictEqual } from 'node:util'

function clone(value) { return value === undefined ? undefined : structuredClone(value) }
function text(value) { return typeof value === 'string' ? value : '' }

// Keep the author's complete wire protocol. Official MVU understands both JSON
// Patch and the older _.set/insert/assign/remove/unset/delete/add command syntax.
function rawSubmission(input) {
  const saved = input.submission
  if (saved !== undefined && (saved?.version !== 1 || saved.kind !== 'sillytavern-once'
    || typeof saved.sourceText !== 'string' || typeof saved.command !== 'string')) {
    throw new Error('酒馆单次回复的变量投递记录无效，不能转为后台模型结算')
  }
  const sourceText = saved ? saved.sourceText : text(input.storyText)
  if (saved && input.storyText !== undefined && input.storyText !== sourceText) {
    throw new Error('酒馆单次回复正文已变化，已保存的变量命令未执行')
  }
  const blocks = [...sourceText.matchAll(/<UpdateVariable\b[^>]*>[\s\S]*?<\/UpdateVariable\s*>/gi)]
  const unmatched = sourceText.replace(/<UpdateVariable\b[^>]*>[\s\S]*?<\/UpdateVariable\s*>/gi, '')
  if (/<\/?UpdateVariable\b/i.test(unmatched)) throw new Error('原回复的 UpdateVariable 标签不完整，变量尚未写入')
  const command = blocks.map(match => match[0]).join('\n\n')
  if (saved && saved.command !== command) throw new Error('已保存的变量命令与原回复不一致，变量尚未写入')
  return { version: 1, kind: 'sillytavern-once', sourceText, command }
}

function display(value) {
  if (value === undefined) return '（不存在）'
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function variableChanges(before, after, path = '', changes = []) {
  if (isDeepStrictEqual(before, after) || changes.length >= 200) return changes
  if (before && after && typeof before === 'object' && typeof after === 'object'
    && Array.isArray(before) === Array.isArray(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      variableChanges(before[key], after[key], path + '/' + key.replaceAll('~', '~0').replaceAll('/', '~1'), changes)
    }
  } else changes.push({
    operation: before === undefined ? 'insert' : after === undefined ? 'delete' : 'set',
    path: path || '/', before: display(before), after: display(after)
  })
  return changes
}

function receipt(status, diagnosticId, extra = {}) {
  return { version: 1, status, summary: '', diagnosticId, changes: [], sideEffects: [], failures: [], ...extra }
}

const DEFERRED_MESSAGES = {
  'claim-timeout': '本地变量任务领取超时，原回复命令已保存，等待重新投递。',
  'runtime-busy': '本地执行器正在处理其他任务，原回复命令已保存，等待空闲后继续。',
  'runtime-not-ready': 'MVU 执行器尚未就绪，原回复命令已保存，就绪后自动继续。',
  'delivery-interrupted': '本地变量投递中断，原回复命令已保存，等待重新投递。'
}

/** Parse one original reply with the existing local MVU runtime; never call a model. */
export function createSingleReplySettlement({ runtime, now = Date.now } = {}) {
  if (typeof runtime?.settleMvuUpdate !== 'function') throw new Error('酒馆单次回复缺少本地 MVU Runtime adapter')
  const active = new Map()
  const completed = new Map()

  async function settleVariables(input = {}) {
    input.signal?.throwIfAborted()
    const submission = rawSubmission(input)
    const identity = ['operationId', 'chatId', 'sessionId', 'branchId', 'basedOnRevision', 'messageId', 'swipeId', 'expectedLifecycleRevision']
      .map(key => input[key] ?? null)
    if (!text(input.operationId).trim()) throw new Error('酒馆单次回复变量结算缺少 operationId')
    const key = JSON.stringify(identity)
    const prior = completed.get(key) || active.get(key)
    if (prior && (!isDeepStrictEqual(prior.submission, submission)
      || !isDeepStrictEqual(prior.baseline, input.currentVariables))) {
      throw new Error('同一变量结算操作的正文或基线已变化，拒绝重复执行')
    }
    if (completed.has(key)) {
      const result = clone(completed.get(key).result)
      if (input.onPrepared) await input.onPrepared(clone(result))
      return result
    }
    if (active.has(key)) return clone(await active.get(key).promise)
    const entry = { submission: clone(submission), baseline: clone(input.currentVariables), promise: null }
    entry.promise = Promise.resolve().then(async () => {
      const diagnosticId = text(input.operationId) + ':single-reply'
      if (input.onSubmission) await input.onSubmission(clone(submission))
      input.signal?.throwIfAborted()
      const applied = await runtime.settleMvuUpdate({
        compactResult: true, durable: true, preserveForeground: true, allowEmptyCommand: true,
        operationId: input.operationId, chatId: input.chatId, branchId: input.branchId,
        basedOnRevision: input.basedOnRevision, sessionId: input.sessionId,
        messageId: input.messageId, swipeId: input.swipeId,
        expectedLifecycleRevision: input.expectedLifecycleRevision,
        baselineVariables: clone(input.currentVariables || {}), signal: input.signal, diagnosticId,
        // Do not include the protocol twice in the runtime's temporary floor.
        storyText: submission.command
          ? submission.sourceText.replace(/<UpdateVariable\b[^>]*>[\s\S]*?<\/UpdateVariable\s*>/gi, '').trim()
          : submission.sourceText,
        command: submission.command
      })
      input.signal?.throwIfAborted()
      if (applied.deferred) {
        const deferredReason = Object.hasOwn(DEFERRED_MESSAGES, applied.deferredReason) ? applied.deferredReason : 'runtime-not-ready'
        return { submission, variables: clone(input.currentVariables || {}), receipt: receipt('pending', diagnosticId,
          { deferredReason, summary: DEFERRED_MESSAGES[deferredReason] }) }
      }
      if (applied.stale) return { submission, receipt: receipt('stale', diagnosticId, { summary: '变量结算目标已经变化，原回复的迟到结果未写入。' }) }
      const diagnostics = clone(applied.diagnostics || [])
      const failures = clone(applied.validation?.failures || [])
      for (const diagnostic of diagnostics) if (diagnostic?.level === 'error') {
        failures.push({ message: text(diagnostic.message) || '原回复变量协议的本地执行发生错误。' })
      }
      if (applied.rejected && failures.length === 0) failures.push({ message: '本地 MVU 执行器拒绝了原回复的变量命令。' })
      if (failures.length) return { submission, variables: clone(input.currentVariables || {}),
        receipt: receipt('error', diagnosticId, { summary: failures[0].message || '原回复的变量更新未通过本地校验。',
          runtimeDiagnostics: diagnostics, failures }) }
      const variables = clone(applied.variables || applied.context?.messages?.[input.messageId]?.variables || input.currentVariables || {})
      const changes = variableChanges(input.currentVariables || {}, variables)
      const result = { submission, variables, effect: clone(applied.effect), receipt: receipt(changes.length ? 'updated' : 'unchanged', diagnosticId,
        { changes, runtimeDiagnostics: diagnostics, ...(!submission.command && changes.length === 0
          ? { summary: '原回复没有 UpdateVariable 协议，已完成本地消息事件，本轮变量无变化。' } : {}) }) }
      if (input.onPrepared) await input.onPrepared(clone(result))
      completed.set(key, { submission: clone(submission), baseline: clone(input.currentVariables), result: clone(result), completedAt: now() })
      if (completed.size > 64) completed.delete(completed.keys().next().value)
      return result
    }).finally(() => { if (active.get(key) === entry) active.delete(key) })
    active.set(key, entry)
    return clone(await entry.promise)
  }

  return Object.freeze({ settleVariables })
}
