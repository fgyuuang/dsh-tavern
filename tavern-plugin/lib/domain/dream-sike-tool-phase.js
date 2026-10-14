import { dreamSikeTurnIdentity, DREAM_SIKE_MAX_EDITORIAL_ROUNDS } from './dream-sike-draft.js'
import { assertDreamSikePreparation, dreamSikePreparationView, needsDreamSikePreparation } from './dream-sike-preparation.js'
import { draftModuleReceiptCurrent, dreamSikeDraftModulePlan } from './dream-sike-draft-modules.js'

const names = new Set(['sike_read_turn', 'sike_prepare_turn', 'sike_put_draft', 'sike_patch_draft', 'sike_run_module', 'sike_check_draft', 'sike_ready_draft'])
export function dreamSikeToolPhase(chat, sessionId, turn) {
  if (chat?.playPresetId !== 'dream-sike-dsh') return null
  let identity
  try { identity = dreamSikeTurnIdentity(chat, sessionId, turn) } catch { return null }
  const candidate = chat.dreamSikeDraft
  const draft = candidate?.operationId === identity.operationId && candidate.branchId === identity.branchId && candidate.turn === turn ? candidate : null
  const phase = (name, tools, instruction, moduleKind = null) => ({ name, tools: ['sike_read_turn', ...tools], instruction, moduleKind,
    context: { turn, operationId: identity.operationId, expectedVersion: draft?.version ?? null,
      draftStatus: draft?.status ?? null, checkVersion: draft?.checks?.version ?? null,
      blockingIssues: (draft?.checks?.issues || []).map(issue => ({ code: issue.code, message: issue.message })),
      editorialNotes: draft?.checks?.editorial?.notes || [] } })
  const preparation = dreamSikePreparationView(chat, identity)
  if (needsDreamSikePreparation(chat) && !preparation?.readAt) return phase('reading', [], '先读取当前回合与规则；按需分页和检索。')
  try { assertDreamSikePreparation(chat, identity) }
  catch { return phase('preparation', ['sike_prepare_turn'], '读取后保存六项写作准备，再建立主线草稿。') }
  if (!draft) return phase('draft', ['sike_put_draft'], '只建立主线草稿；平行事件由独立模块合入。')
  if (draft.status === 'ready') return { ...phase('ready', [], '草稿已确认。结束工具调用，返回一句完成提示。'), tools: [] }
  const parallel = dreamSikeDraftModulePlan(chat, 'parallel')
  const review = dreamSikeDraftModulePlan(chat, 'review')
  if (parallel && !draftModuleReceiptCurrent(chat, 'parallel')) return phase('modules', ['sike_run_module'], review
    ? '调用 review；宿主先更新过期平行事件，再整体审稿。' : '调用 parallel 补齐平行事件，再检查完整草稿。', review ? 'review' : 'parallel')
  if (review && !draftModuleReceiptCurrent(chat, 'review')) return phase('review', ['sike_run_module'], '调用 review 审稿；使用返回的当前版本和缺陷。', 'review')
  if (review && Object.values(draft.modules.review.review || {}).some(axis => axis.status === 'revise')) {
    // Only spend the revision budget on revise rounds; afterwards the notes still reach the check
    // step but no longer demand another editor pass, so the turn can reach confirmation.
    if ((Number(draft.editorialRounds) || 0) <= DREAM_SIKE_MAX_EDITORIAL_ROUNDS) {
      return phase('revision', ['sike_patch_draft'], '把同次审稿缺陷合并为 patches 一次局部修改；原文不确定时先读取当前草稿。')
    }
  }
  if (draft.checks?.version !== draft.version) return phase('checking', ['sike_check_draft', 'sike_patch_draft'],
    '检查当前草稿；已有当前独立审稿回执时不必重新提交 review。审稿后仍保留的文风建议由宿主记录，是否阻断以当前 checks.issues 为准；不追求每项永远全 pass。收到检查结果后，再在下一模型步骤确认。')
  if (draft.checks.issues.some(issue => /^editorial-(missing|extra-axis|invalid-)/.test(issue.code))) return phase('checking', ['sike_check_draft'], '补齐六维审阅结构和具体依据后重新检查；审阅参数缺失不要求修改正文。')
  if (draft.checks.issues.length) return phase('revision', ['sike_patch_draft'], '依据检查缺陷局部修改；不重复建立草稿，也不预推测后续版本。')
  return phase('confirming', ['sike_ready_draft', 'sike_patch_draft'], '当前检查通过，确认当前版本；记录中的非阻断文风建议不要求再次审稿。仍可自主局部修订，补丁次数不设上限；若修改则重新检查当前版本。')
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
  const keep = name => !names.has(name) || allowed.has(name)
  return { ...assembly,
    tools: (assembly.tools || []).filter(tool => keep(tool.name)).map(tool => tool.name === 'sike_run_module' && phase.moduleKind
      ? { ...tool, parameters: { ...tool.parameters, properties: { ...tool.parameters?.properties,
        kind: { ...tool.parameters?.properties?.kind, enum: [phase.moduleKind] } } } } : tool),
    sections: [...(assembly.sections || []).filter(section => !section.name?.startsWith('tool:') || keep(section.name.slice(5))),
      { name: 'dream-sike-current-phase', text: dreamSikePhaseInstruction(phase) }]
  }
}
