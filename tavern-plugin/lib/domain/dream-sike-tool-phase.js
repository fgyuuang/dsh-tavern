import { dreamSikeTurnIdentity } from './dream-sike-draft.js'
import { dreamSikePreparationView } from './dream-sike-preparation.js'
import { normalizeDreamSikeExecutionPolicy } from './dream-sike-execution-policy.js'
import { dreamSikeExecutionCounts } from './dream-sike-execution-usage.js'
import { isWritingAgentExecution } from './generation-mode.js'

const names = new Set(['sike_read_turn', 'sike_prepare_turn', 'sike_put_draft', 'sike_patch_draft', 'sike_run_module', 'sike_check_draft', 'sike_ready_draft'])
const queryTools = new Set(['tavern_memory', 'tavern_read_variables', 'tavern_recall_history', 'worldbook_search',
  'tavern_read_worldbook', 'tavern_read_card', 'tavern_read_card_raw', 'tavern_read_preset', 'tavern_read_regex_library',
  'tavern_read_play_chat', 'tavern_read_script', 'tavern_read_skill_reference', 'skill', 'web_search'])

export function dreamSikeToolPhase(chat, sessionId, turn, executionUsage, {
  inFlightAttemptId, inFlightStep, inFlightRootOperationId, inFlightBranchId
} = {}) {
  if (!isWritingAgentExecution(chat)) return null
  let identity
  try { identity = dreamSikeTurnIdentity(chat, sessionId, turn) } catch { return null }
  const operation = chat.timeline?.operations?.[identity.operationId]
  const executionRootOperationId = String(operation?.executionRootOperationId || identity.operationId)
  const executionRootTurn = Math.max(0, Number(operation?.executionRootTurn ?? operation?.turn ?? turn) || 0)
  const executionResumed = executionRootOperationId !== identity.operationId
  const branchId = identity.branchId
  const usageMatches = executionUsage?.rootOperationId === executionRootOperationId && executionUsage?.branchId === branchId
  const currentUsage = usageMatches ? executionUsage : null
  const candidate = chat.dreamSikeDraft
  const draft = candidate?.operationId === identity.operationId && candidate.branchId === identity.branchId && candidate.turn === turn ? candidate : null
  const ledgerPolicy = normalizeDreamSikeExecutionPolicy(currentUsage?.policy || chat.dreamSikeExecutionPolicy)
  const configuredPolicy = normalizeDreamSikeExecutionPolicy(chat.dreamSikeExecutionPolicy)
  const policy = executionResumed ? configuredPolicy : ledgerPolicy
  const observedCounts = dreamSikeExecutionCounts(currentUsage)
  const admissionCounts = { ...observedCounts }
  const coordinatesMatch = inFlightRootOperationId === executionRootOperationId && inFlightBranchId === branchId
  const inFlight = coordinatesMatch && inFlightAttemptId
    ? currentUsage?.requests?.find(request => request.attemptId === inFlightAttemptId)
    : coordinatesMatch && Number.isSafeInteger(inFlightStep)
      ? currentUsage?.requests?.findLast(request => ['reserved', 'completed'].includes(request.status)
        && request.step === inFlightStep && request.turn === turn)
      : null
  if (inFlight && ['reserved', 'completed'].includes(inFlight.status) && Number(admissionCounts[inFlight.stage]) > 0) admissionCounts[inFlight.stage]--
  const remaining = Math.max(0, policy.revisionRequests - admissionCounts.revision)
  const queryRemaining = Math.max(0, policy.queryRequests - admissionCounts.query)
  const phase = (name, tools, instruction, moduleKind = null) => ({ name, tools, instruction, moduleKind,
    context: { turn, operationId: identity.operationId, executionRootOperationId, executionRootTurn,
      executionResumed, branchId, expectedVersion: draft?.version ?? null,
      draftStatus: draft?.status ?? null, checkVersion: draft?.checks?.version ?? null,
      queryRequests: policy.queryRequests, queryRequestsUsed: observedCounts.query,
      queryRequestsRemaining: Math.max(0, policy.queryRequests - observedCounts.query),
      revisionRequests: policy.revisionRequests, revisionRequestsUsed: observedCounts.revision,
      revisionsRemaining: Math.max(0, policy.revisionRequests - observedCounts.revision),
      blockingIssues: (draft?.checks?.issues || []).map(issue => ({ code: issue.code, message: issue.message })),
      editorialNotes: draft?.checks?.editorial?.notes || [] } })
  const preparation = dreamSikePreparationView(chat, identity)
  const readComplete = Boolean(preparation?.queriesCompleteAt)
  if (!draft) {
    if (!readComplete && queryRemaining > 0 && !admissionCounts.initial) return phase('reading',
      ['sike_read_turn', 'sike_put_draft', ...queryTools],
      '首要任务是完成本轮正文。当前请求已装配本局作者原文和场景材料；仅在缺少具体事实时查询记忆、世界书或变量，Skills 按需加载。可直接输出完整正文或用 sike_put_draft 保存并提交。无需为取得写作许可重复读取规则、准备或审阅；查询次数是可选优化预算。')
    return phase('draft', ['sike_put_draft'],
      '可选研究阶段已结束，现在完成本轮正文；直接输出完整可渲染正文，或一次 sike_put_draft({text,review?,brief?}) 保存并提交。已加载的 Skill 和资料并未消耗正文机会。原作者原文与当前场景已随请求装配，停止重复读取或加载 Skill。需要继续优化时显式 finalize=false；否则宿主保存并检查后直接提交。')
  }
  if (draft.status === 'ready') return phase('ready', [], '正文已保存并确认；立即结束，宿主从该版本提交一次，无需完成提示或再次调用模型。')
  if (draft.checks?.version !== draft.version) return phase('checking', ['sike_check_draft', 'sike_ready_draft', ...(remaining ? ['sike_patch_draft'] : [])],
    '正文已保存，结束时宿主会检查当前版本并提交。只在发现具体问题时修订；review 和 brief 均为可选记录，不为补齐结构反复调用模型。')
  const requiredIssues = draft.checks.issues.filter(issue => !/^preset-(?:body-length|banned-word|banned-dash|banned-phrase)$/.test(issue.code))
  if (requiredIssues.length) return phase('repair', ['sike_patch_draft', 'sike_check_draft'],
    '完整正文已保存。修复列明的确定性格式或协议缺陷后提交；必要修复与确认不属于可选文风修订预算。expectedVersion 使用当前版本，不重建正文，不重复研究或审稿。')
  if (remaining > 0 && draft.status === 'draft') return phase('revision', ['sike_patch_draft', 'sike_check_draft', 'sike_ready_draft'],
    '正文已经通过协议检查，可直接结束提交。仅有明确改进时，在剩余可选修订预算内批量局部优化；没有问题则立即完成，不为用满预算增加调用。')
  return phase('confirming', ['sike_ready_draft', 'sike_check_draft'],
    '可选优化已结束；当前可用正文由宿主检查并提交。立即结束即可，无需额外模型确认；不得因优化预算耗尽丢弃或暂停完整正文。')
}

/** Shared by the model prompt and rejected out-of-phase calls; never relies on old tool results. */
export function dreamSikePhaseInstruction(phase) {
  if (!phase) return ''
  return '【当前执行阶段】' + JSON.stringify({ phase: phase.name, allowedTools: phase.tools, moduleKind: phase.moduleKind, ...phase.context })
    + '\n' + phase.instruction
    + ' expectedVersion 使用此处当前值，不能沿用历史版本。正文是首要成果，检索、Skills、简报和审阅按需使用；允许直接输出符合原作者规则的完整正文。一次请求可先读取后保存正文，版本修改合并进 patches。规则续页只使用实际返回的 nextOffset，不在同一步猜测后续页。'
}

export function applyDreamSikeToolPhase(assembly, phase) {
  if (!phase) return assembly
  const allowed = new Set(phase.tools)
  // A prose Agent is deliberately smaller than the native project Agent. Once
  // optional research ends, no generic read/shell/Skill tools can reopen it.
  const keep = name => allowed.has(name)
  return { ...assembly,
    tools: (assembly.tools || []).filter(tool => keep(tool.name)).map(tool => tool.name === 'sike_run_module' && phase.moduleKind
      ? { ...tool, parameters: { ...tool.parameters, properties: { ...tool.parameters?.properties,
        kind: { ...tool.parameters?.properties?.kind, enum: [phase.moduleKind] } } } } : tool),
    sections: [...(assembly.sections || []).filter(section => !section.name?.startsWith('tool:') || keep(section.name.slice(5))),
      { name: 'dream-sike-current-phase', text: dreamSikePhaseInstruction(phase) }]
  }
}
