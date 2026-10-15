import { dreamSikeTurnIdentity } from './dream-sike-draft.js'
import { assertDreamSikePreparation, dreamSikePreparationView } from './dream-sike-preparation.js'
import { normalizeDreamSikeExecutionPolicy } from './dream-sike-execution-policy.js'
import { dreamSikeExecutionCounts } from './dream-sike-execution-usage.js'

const names = new Set(['sike_read_turn', 'sike_prepare_turn', 'sike_put_draft', 'sike_patch_draft', 'sike_run_module', 'sike_check_draft', 'sike_ready_draft'])
const queryTools = new Set(['tavern_memory', 'tavern_read_variables', 'tavern_recall_history', 'worldbook_search',
  'tavern_read_worldbook', 'tavern_read_card', 'tavern_read_card_raw', 'tavern_read_preset', 'tavern_read_regex_library',
  'tavern_read_play_chat', 'tavern_read_script', 'tavern_read_skill_reference', 'skill', 'web_search'])

export function dreamSikeToolPhase(chat, sessionId, turn, executionUsage, {
  inFlightAttemptId, inFlightStep, inFlightRootOperationId, inFlightBranchId
} = {}) {
  if (chat?.playPresetId !== 'dream-sike-dsh') return null
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
  const requiresRead = true
  const readComplete = Boolean(preparation?.queriesCompleteAt)
  if (requiresRead && !preparation?.readAt && queryRemaining === 0) {
    return phase('query-paused', [], '查询额度已用完但当前回合材料尚未成功读取；保留本轮，不能跳过必要材料检查。')
  }
  if (requiresRead && preparation?.readAt && !readComplete && queryRemaining === 0) {
    return phase('query-paused', [], '作者规则或必要材料仍未读完，查询额度已用尽；保留本轮，不得跳过未读规则直接起草。')
  }
  if (requiresRead && (!preparation?.readAt || !readComplete && queryRemaining > 0)) {
    return phase('reading', ['sike_read_turn', ...queryTools], '先用一次请求读取本回合材料与作者规则，并在同一请求内按需调用允许的记忆、历史、世界书和变量检索工具。sike_read_turn 的 finishResearch 默认 true；仅当已经明确缺少关键资料且查询额度仍有剩余时才传 false，以保留一次补查。每个模型请求都计入查询额度。')
  }
  if (!draft) {
    if (admissionCounts.initial > 0) return remaining
      ? phase('draft-retry', ['sike_put_draft'], '上一次初稿请求没有建立可用草稿；本次重新提交完整正文与六维 review，计入一次修订/恢复额度。')
      : phase('paused', [], '初稿请求已失败，修订/恢复额度为零；保留本轮状态，调整额度后继续。')
    return phase('draft', ['sike_put_draft'], '查询结束后一次提交 text 与六维 review；可选 brief 同时提交。宿主在同一写入中保存、检查并确认，通过后直接结束，不再单独调用 prepare、check 或 ready。')
  }
  try { assertDreamSikePreparation(chat, identity) }
  catch { return phase('preparation', ['sike_prepare_turn'], '读取后保存六项写作准备，再建立主线草稿。') }
  if (draft.status === 'ready') return { ...phase('ready', [], '草稿已确认。结束工具调用，返回一句完成提示。'), tools: [] }
  if (draft.checks?.version !== draft.version) return phase('checking', ['sike_check_draft', ...(remaining ? ['sike_patch_draft'] : [])],
    '对当前完整草稿提交六维 review；宿主同时检查并直接确认，通过即结束。需要修订时一次提交批量补丁与修改后 review，不再单独请求 ready。')
  if (draft.checks.issues.some(issue => /^editorial-(missing|extra-axis|invalid-)/.test(issue.code))) return phase('checking', ['sike_check_draft'], '补齐六维审阅结构和具体依据后重新检查；审阅参数缺失不要求修改正文。')
  if (draft.checks.issues.length) return remaining
    ? phase('revision', ['sike_patch_draft'], '依据本次缺陷一次提交 patches 与修改后六维 review；宿主批量应用、检查并直接确认。不重复建立草稿，不猜测版本，不为非阻断建议反复审稿。')
    : { ...phase('paused', [], '局部修订额度已用尽，协议或格式问题仍未通过；保留当前草稿并暂停，调整额度后继续。'), tools: [] }
  return phase('confirming', ['sike_ready_draft'], '旧检查已通过，直接确认当前版本；正常的新正文与补丁提交由宿主自动完成此步骤。')
}

/** Shared by the model prompt and rejected out-of-phase calls; never relies on old tool results. */
export function dreamSikePhaseInstruction(phase) {
  if (!phase) return ''
  return '【当前执行阶段】' + JSON.stringify({ phase: phase.name, allowedTools: phase.tools, moduleKind: phase.moduleKind, ...phase.context })
    + '\n' + phase.instruction
    + ' 只调用 allowedTools 中的写作工具；expectedVersion 使用此处当前值，不能沿用历史版本。每个模型步骤只执行一次写作状态变更；收到结果后依据新版本继续，其他修改合并进 patches。规则续页只使用实际返回的nextOffset，不在同一步猜测后续页。'
}

export function applyDreamSikeToolPhase(assembly, phase) {
  if (!phase) return assembly
  const allowed = new Set(phase.tools)
  const queryStage = phase.name === 'reading'
  const keep = name => (!names.has(name) && (!queryTools.has(name) || queryStage)) || allowed.has(name)
  return { ...assembly,
    tools: (assembly.tools || []).filter(tool => keep(tool.name)).map(tool => tool.name === 'sike_run_module' && phase.moduleKind
      ? { ...tool, parameters: { ...tool.parameters, properties: { ...tool.parameters?.properties,
        kind: { ...tool.parameters?.properties?.kind, enum: [phase.moduleKind] } } } } : tool),
    sections: [...(assembly.sections || []).filter(section => !section.name?.startsWith('tool:') || keep(section.name.slice(5))),
      { name: 'dream-sike-current-phase', text: dreamSikePhaseInstruction(phase) }]
  }
}
