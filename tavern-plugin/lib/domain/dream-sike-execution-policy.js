export const DEFAULT_DREAM_SIKE_EXECUTION_POLICY = Object.freeze({
  version: 1,
  queryRequests: 1,
  revisionRequests: 1
})

function requestLimit(value, fallback, allowed, name) {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || !allowed.includes(value)) {
    throw new Error('梦境思客执行策略的 ' + name + ' 无效')
  }
  return value
}

/** Normalize the persisted per-chat request policy to the stable v1 shape. */
export function normalizeDreamSikeExecutionPolicy(value) {
  if (value === undefined) return { ...DEFAULT_DREAM_SIKE_EXECUTION_POLICY }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('梦境思客执行策略格式无效')
  }
  if (value.version !== undefined && value.version !== 1) {
    throw new Error('不支持的梦境思客执行策略版本')
  }
  return {
    version: 1,
    queryRequests: requestLimit(value.queryRequests, DEFAULT_DREAM_SIKE_EXECUTION_POLICY.queryRequests, [1, 2], 'queryRequests'),
    revisionRequests: requestLimit(value.revisionRequests, DEFAULT_DREAM_SIKE_EXECUTION_POLICY.revisionRequests, [0, 1, 2], 'revisionRequests')
  }
}
