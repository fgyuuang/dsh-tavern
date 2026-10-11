import { createHash } from 'node:crypto'
import { dreamSikeSourceSettings } from './dream-sike-source-settings.js'
import { compileDreamSikeContract } from './dream-sike-contract.js'
import { resolveRuntimePresetMacros } from './runtime-presets.js'

const phases = ['front', 'middle', 'back']
const personaId = '06b5771b-109d-47b1-94d0-8bbc805bc15e'
const hash = text => createHash('sha256').update(String(text || '')).digest('hex')
const identifier = entry => entry.source?.identifier || entry.identifier || String(entry.id || entry.entryKey || '').replace(/#\d+$/, '')
const stageDefinitions = [
  ['role-scene', '角色与场景', '读取角色、视角、玩家动作及人物可知信息，沿用已选作者规则。'],
  ['narration', '叙事与文风', '按已选文风、叙事者、字数和附加规则组织正文。'],
  ['planning', '写前决策', '执行作者的设定检索、视角核对、写规检查与事件推进步骤。'],
  ['output', '正文与附加输出', '按当前输出模式和已启用场景、平行事件等格式建立唯一草稿。'],
  ['review-state', '审稿与状态结算', '按已选检查规则修订草稿，最终正文确认后结算状态。'],
  ['model', '模型与材料接入', '管理模型适配及外部数据库、表格材料的兼容状态。']
]
const groupStages = new Map([
  ['角色设定', 'role-scene'], ['人称设定', 'role-scene'], ['抢话设定', 'role-scene'], ['角色分析', 'role-scene'],
  ['文风设置', 'narration'], ['次要文风', 'narration'], ['叙事者', 'narration'], ['字数要求', 'narration'],
  ['思考强度', 'planning'], ['MVU适配', 'review-state'], ['输出模式', 'output'], ['模型适配', 'model']
])
// IDs are the original author's entries, rather than guesses from prose keywords.
const optionStages = new Map([
  ['21837143-741e-4cc8-8107-b26acacfdee6', 'model'], ['4f83df17-8d9e-4290-8561-5b74f5573373', 'model'],
  ['e93c52c7-10dc-4c47-88ab-7cc74b31ea60', 'model'], ['cbe5b03e-f488-4afc-bc2b-8650af0f97bf', 'model'],
  ['7cfbff76-346a-400f-b47d-46e55f5fe0fa', 'review-state'], ['4e26a3ac-4d46-45ed-85bf-0110fbe06cd2', 'review-state'],
  ['11cdd506-1513-4008-b6b9-c883dbad65c5', 'output'], ['f96f47f7-01ef-4676-b0fe-6f254ae7e550', 'output'],
  ['f9b03e19-fd96-4782-8867-73ad2cbabfb9', 'output'], ['27bf435f-4283-4937-8c6f-3c31abc4f6d2', 'output'],
  ['6a8e799c-9445-44f2-a853-c6c71b92b855', 'output'], ['43f8a625-93e6-46c0-9c20-b635c57e3b19', 'output'],
  ['807eefad-93ca-490c-a629-1d51038e3626', 'output'], ['0507e8d7-99e4-4cb6-84d8-e0a467da2ff7', 'planning']
])
const chainIds = new Set(['0da6f4d7-961d-4966-a084-857a3dd876ad', '81b2facd-db99-4bdc-9597-7cc1d08726dd', '25e9984e-02c2-40c7-a095-bf4683f7d04e'])

function resolveRules(snapshot, context = {}) {
  const compiled = compileDreamSikeContract(snapshot)
  const rendered = resolveRuntimePresetMacros(compiled, { ...context,
    macroState: { ...context.macroState, userName: context.userName || context.macroState?.userName } })
  const evidence = new Map((compiled?.agentContract?.entries || []).map(entry => [entry.id, entry]))
  const original = new Map(phases.flatMap(phase => (snapshot?.[phase]?.entries || []).map(entry => [entry.id || entry.entryKey, entry])))
  const excluded = [], rules = []
  for (const phase of phases) for (const entry of rendered.snapshot?.[phase]?.entries || []) {
    const id = identifier(entry), key = entry.id || entry.entryKey
    if (id === personaId) { excluded.push({ key, identifier: id, reason: '原身份模块中的优先级与解除限制声明不作为 Agent 能力授权；原始文本保留在设置原文视图。' }); continue }
    const source = original.get(key), trace = evidence.get(key)
    rules.push({ key, identifier: id, name: entry.name || entry.source?.name || '', phase,
      content: String(entry.content || ''), sourceHash: trace?.sourceHash || hash(source?.content || entry.content),
      sourceCharacters: trace?.characters ?? String(source?.content || entry.content || '').length,
      resolvedHash: hash(entry.content), resolvedCharacters: String(entry.content || '').length, action: trace?.action || 'preserved' })
  }
  const allEvidence = compiled?.agentContract?.entries || []
  return { rules, excluded, compiled, rendered,
    sourceDigest: hash(JSON.stringify(allEvidence.map(entry => [entry.id, entry.sourceHash]))),
    resolvedDigest: rendered.snapshot?.digest || hash(''), contractDigest: compiled?.agentContract?.digest || '' }
}
function contextFor(chat, supplied = {}) {
  const operation = Object.values(chat?.timeline?.operations || {}).find(operation => operation.kind === 'body' && operation.status === 'running')
  return { userName: chat?.macroState?.userName, charName: chat?.cardName || '', lastUserMessage: operation?.userText || '',
    macroState: chat?.macroState || {}, ...supplied }
}
export function buildDreamSikeAgentProfile(snapshot, mode = 'tavern', options = {}) {
  const settings = options.sourceSettings || dreamSikeSourceSettings(snapshot, mode)
  const stages = stageDefinitions.map(([id, label, description]) => ({ id, label, description, groupIds: [], optionIds: [], variableIds: [], activeOptions: [], authorRuleIds: [], statusNotes: [] }))
  const byStage = new Map(stages.map(stage => [stage.id, stage]))
  const entries = new Map((snapshot?.compatibilityPreset?.entries || []).map(entry => [entry.entryKey, entry]))
  const selectedStage = new Map(), unmappedOptions = [], unmappedVariables = [], errors = [...settings.errors]
  for (const group of settings.groups) {
    for (const option of group.options) {
      const promptIds = option.prompts.map(prompt => entries.get(prompt.key)?.identifier || prompt.key.replace(/#\d+$/, ''))
      const stageId = groupStages.get(group.id) || promptIds.map(id => optionStages.get(id)).find(Boolean)
      const reference = { groupId: group.id, optionId: option.id }
      const stage = byStage.get(stageId)
      if (!stage) { unmappedOptions.push(reference); continue }
      if (!stage.groupIds.includes(group.id)) stage.groupIds.push(group.id)
      stage.optionIds.push(reference)
      if (option.enabled) stage.activeOptions.push({ ...reference, label: option.label })
      if (option.compatibility.status !== 'supported') stage.statusNotes.push({ ...reference, ...option.compatibility })
      promptIds.forEach(id => selectedStage.set(id, stageId))
    }
    for (const input of group.variableInputs) {
      const stage = byStage.get(groupStages.get(group.id))
      const reference = { groupId: group.id, inputId: input.id }
      if (stage) stage.variableIds.push(reference)
      else unmappedVariables.push(reference)
    }
  }
  const resolved = resolveRules(snapshot, options.context || options.macroContext || options)
  for (const rule of resolved.rules) {
    const stageId = chainIds.has(rule.identifier) ? 'planning' : selectedStage.get(rule.identifier) || optionStages.get(rule.identifier) || 'output'
    byStage.get(stageId).authorRuleIds.push({ key: rule.key, identifier: rule.identifier, name: rule.name,
      sourceHash: rule.sourceHash, resolvedHash: rule.resolvedHash, action: rule.action })
  }
  const sourceOptionCount = settings.groups.reduce((count, group) => count + group.options.length, 0)
  const sourceVariableCount = settings.groups.reduce((count, group) => count + group.variableInputs.length, 0)
  const seen = new Set(), duplicateOptions = []
  for (const reference of stages.flatMap(stage => stage.optionIds)) {
    const key = JSON.stringify([reference.groupId, reference.optionId])
    if (seen.has(key)) duplicateOptions.push(reference)
    seen.add(key)
  }
  const coverage = { sourceGroupCount: settings.groups.length, sourceOptionCount, mappedOptionCount: stages.reduce((count, stage) => count + stage.optionIds.length, 0),
    sourceVariableCount, mappedVariableCount: stages.reduce((count, stage) => count + stage.variableIds.length, 0), unmappedOptions, unmappedVariables,
    duplicateOptions, complete: !unmappedOptions.length && !unmappedVariables.length && !duplicateOptions.length }
  if (!coverage.complete) errors.push('存在未归入 Agent 阶段的作者选项；请在完整原设置中查看，未自动猜测其作用。')
  return { id: 'dream-sike-dsh', title: '梦境思客 DSH Agent 预设', enabled: mode === 'dream-sike-dsh', stages, coverage, errors,
    authorRules: { total: resolved.rules.length, excluded: resolved.excluded, sourceDigest: resolved.sourceDigest,
      resolvedDigest: resolved.resolvedDigest, contractDigest: resolved.contractDigest } }
}
export function readDreamSikeAgentRules(chat, request = {}) {
  const offset = request.offset ?? 0, limit = request.limit ?? 4, contentOffset = request.contentOffset ?? 0, maxChars = request.maxChars ?? 12000
  if (![offset, contentOffset].every(value => Number.isSafeInteger(value) && value >= 0)
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 10 || !Number.isSafeInteger(maxChars) || maxChars < 1 || maxChars > 12000) throw new Error('作者规则分页参数无效')
  const snapshot = chat?.runtimePresetSnapshot
  const resolved = resolveRules(snapshot, contextFor(chat, request.context))
  const summary = rule => rule ? { key: rule.key, identifier: rule.identifier, name: rule.name,
    ruleIndex: resolved.rules.indexOf(rule), sourceHash: rule.sourceHash, resolvedHash: rule.resolvedHash } : null
  const local = resolved.rendered.macroState?.local || {}
  const variable = variableId => ({ variableId, characters: String(local[variableId] || '').length,
    preview: String(local[variableId] || '').slice(0, 240), truncated: String(local[variableId] || '').length > 240, hash: hash(local[variableId]) })
  const selected = { writer: summary(resolved.rules.find(rule => rule.identifier === '881044e5-cbef-43c7-ad19-c6e7f6d150b4')),
    style: variable('sleep_var_wenfeng'), narrator: variable('sleep_var_tuijin'), charAnalysis: variable('sleep_var_char_analysis'),
    chains: resolved.rules.filter(rule => chainIds.has(rule.identifier)).map(summary) }
  if (offset > resolved.rules.length || (offset === resolved.rules.length && contentOffset !== 0)) throw new Error('作者规则分页位置无效')
  // Previews are explicitly partial indexes; the actual authored rules remain paged.
  // Count their text against the same budget instead of duplicating unbounded rules.
  const previewCharacters = selected.style.preview.length + selected.narrator.preview.length + selected.charAnalysis.preview.length
  if (previewCharacters >= maxChars) {
    selected.style.preview = ''; selected.narrator.preview = ''; selected.charAnalysis.preview = ''
  }
  const usedPreviewCharacters = selected.style.preview.length + selected.narrator.preview.length + selected.charAnalysis.preview.length
  let remaining = maxChars - usedPreviewCharacters, nextOffset = offset, nextContentOffset = contentOffset
  const rules = []
  while (nextOffset < resolved.rules.length && rules.length < limit && remaining > 0) {
    const rule = resolved.rules[nextOffset]
    if (nextContentOffset > rule.content.length) throw new Error('作者规则文本分页位置无效')
    const content = rule.content.slice(nextContentOffset, nextContentOffset + remaining)
    const end = nextContentOffset + content.length
    rules.push({ ...rule, content, entryIndex: nextOffset, textOffset: nextContentOffset, nextContentOffset: end < rule.content.length ? end : null })
    remaining -= content.length
    if (end < rule.content.length) { nextContentOffset = end; break }
    nextOffset++; nextContentOffset = 0
  }
  return { offset, limit, total: resolved.rules.length, rules, characters: maxChars - remaining, previewCharacters: usedPreviewCharacters,
    hasMore: nextOffset < resolved.rules.length, nextOffset, nextContentOffset, selected,
    excluded: resolved.excluded, digest: resolved.resolvedDigest, sourceDigest: resolved.sourceDigest,
    resolvedDigest: resolved.resolvedDigest, contractDigest: resolved.contractDigest }
}
