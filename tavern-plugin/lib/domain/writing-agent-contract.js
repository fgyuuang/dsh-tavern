// Shared execution protocol, separate author compilers. Persisted sike_* tools
// and dreamSike* fields retain their names so existing games remain readable.
import { compileDreamSikeContract, dreamSikeContractView, inspectDreamSikeContractDraft, needsDreamSikeEditorialReview } from './dream-sike-contract.js'
import { readDreamSikeAgentRules } from './dream-sike-agent-profile.js'
import { compileHushenContract, inspectHushenContractDraft, needsHushenEditorialReview } from './hushen-contract.js'
import { readHushenAgentRules } from './hushen-agent-profile.js'
import { resolveRuntimePresetMacros } from './runtime-presets.js'

const hushen = presetId => presetId === 'hushen-dsh'

export function compileWritingAgentContract(snapshot, presetId) {
  return hushen(presetId) ? compileHushenContract(snapshot) : compileDreamSikeContract(snapshot)
}

export function writingAgentContractView(snapshot, presetId) {
  return hushen(presetId) ? compileHushenContract(snapshot)?.agentContract || null : dreamSikeContractView(snapshot)
}

export function needsWritingAgentEditorialReview(chat) {
  return hushen(chat?.playPresetId) ? needsHushenEditorialReview(chat) : needsDreamSikeEditorialReview(chat)
}

export function inspectWritingAgentContractDraft(chat, text) {
  return hushen(chat?.playPresetId) ? inspectHushenContractDraft(chat, text) : inspectDreamSikeContractDraft(chat, text)
}

export function readWritingAgentRules(chat, request) {
  return hushen(chat?.playPresetId) ? readHushenAgentRules(chat, request) : readDreamSikeAgentRules(chat, request)
}

/** Author update rules are context for the existing state transaction owner.
 * Text/XML output instructions cannot replace the native aggregate submit tool. */
export function writingAgentSettlementRules(chat) {
  if (!hushen(chat?.playPresetId) || chat.generationMode === 'sillytavern-once') return ''
  const compiled = compileHushenContract(chat.runtimePresetSnapshot)
  const entries = compiled?.agentContract?.stateRules || []
  if (!entries.length) return ''
  const context = { charName: chat.cardName, macroState: chat.macroState }
  const selected = resolveRuntimePresetMacros(compiled, context)
  const original = resolveRuntimePresetMacros({ front: { entries: entries.map(entry => ({ ...entry, id: entry.identifier, role: 'system' })) }, sourceMacroOverrides: compiled.sourceMacroOverrides },
    { ...context, macroState: selected.macroState })
  const rules = original.macroState?.local?.mvu || original.snapshot?.text || ''
  return rules ? '\n【本局狐神抚原作者状态规则】\n' + rules
    + '\n这些原文规定更新依据、字段和边界；旧 UpdateVariable/JSONPatch 文字输出约定由当前原生聚合提交工具承担。只提交本任务允许的状态与记忆，不重写已提交正文或重新生成行动选项。' : ''
}

export function writingAgentInstruction(snapshot, presetId) {
  const contract = writingAgentContractView(snapshot, presetId)
  const role = hushen(presetId)
    ? '你是狐神抚DSH剧情 Agent。写法由本局狐神抚原作者规则定义；遵循其两阶段要求、选定的角色感知边界、导演或自然规划方法、文风和玩家控制范围。'
    : '你是梦境思客DSH剧情 Agent。写法由本局梦境思客原作者规则定义。'
  return role + '\n人物卡、世界书、当前分支历史与变量是剧情依据。首要任务是完成本轮正文；查询、Skills、简报和审阅按需使用，不强制固定流程。可直接输出完整正文或用 sike_put_draft 保存并提交；可选优化预算耗尽仍须提交可用正文，必要格式和协议修复不受该预算限制。只提交一次正式回复，后台依据最终正文结算状态与分支记忆。\n\n' + (contract?.instruction || '')
}
