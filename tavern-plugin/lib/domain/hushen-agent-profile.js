import { createHash } from 'node:crypto'
import { compileHushenContract } from './hushen-contract.js'
import { hushenSourceSettings } from './hushen-source-settings.js'
import { readHushenCapabilities } from './hushen-capabilities.js'
import { HUSHEN_IDS, HUSHEN_CHAIN_IDS, HUSHEN_PHASES, HUSHEN_PRESET_ID,
  hushenIdentifier, hushenStageForIdentifier, resolveHushenPresetMacros } from './hushen-source.js'

const hash = value => createHash('sha256').update(String(value || '')).digest('hex')
const stageDefinitions = [
  ['role-scene', '人物与玩家边界', '沿用角色感知、叙事视角、转述及玩家控制权原文。'],
  ['planning', '狐神写前方法', '按所选导演、角色、自然或世界书方法内部核对，公开简短检查结果。'],
  ['narration', '正文与文风', '按第一阶段基础要求和第二阶段强调要求撰写，保留原文风、篇幅与格式。'],
  ['review-state', '狐稿检查与结算', '沿用作者检查规则按需修订，正式正文确认后进行一次变量结算。'],
  ['interaction', '狐策与可见模块', '启用时保留行动选项、短评、留言、狐构、狐映和总结的原协议。'],
  ['memory-materials', '本局资料与记忆', '使用当前分支人物、世界书、历史与记忆，源导出旧剧情不进入新局。'],
  ['model', '原宿主能力适配', '原生模型、宏帧与工具协议接管，旧助手扩展按实际接入状态显示。']
]

function resolveRules(snapshot, context = {}) {
  const compiled = compileHushenContract(snapshot)
  const rendered = resolveHushenPresetMacros(compiled, context)
  const evidence = new Map((compiled?.agentContract?.entries || []).map(entry => [entry.id, entry]))
  const originals = new Map(HUSHEN_PHASES.flatMap(phase => (snapshot?.[phase]?.entries || []).map(entry => [entry.id || entry.entryKey, entry])))
  const rules = []
  for (const phase of HUSHEN_PHASES) for (const entry of rendered.snapshot?.[phase]?.entries || []) {
    const key = entry.id || entry.entryKey, trace = evidence.get(key), original = originals.get(key)
    const content = String(entry.content || '')
    if (!content.trim()) continue
    rules.push({ key, identifier: hushenIdentifier(entry), name: entry.name || entry.source?.name || '', phase,
      content, sourceHash: trace?.sourceHash || hash(original?.content || entry.content),
      sourceCharacters: trace?.characters ?? String(original?.content || entry.content || '').length,
      resolvedHash: hash(content), resolvedCharacters: content.length, action: trace?.action || 'preserved' })
  }
  return { rules, compiled, rendered,
    excluded: (compiled?.agentContract?.entries || []).filter(entry =>
      ['archive-only-not-in-source-order', 'native-model-adapter', 'native-material-boundary', 'native-current-game-material'].includes(entry.action))
      .map(({ identifier, name, action, sourceHash }) => ({ identifier, name, action, sourceHash })),
    sourceDigest: hash(JSON.stringify((compiled?.agentContract?.entries || []).map(entry => [entry.id, entry.sourceHash]))),
    resolvedDigest: rendered.snapshot?.digest || hash(''), contractDigest: compiled?.agentContract?.digest || '' }
}

function contextFor(chat, supplied = {}) {
  const operation = Object.values(chat?.timeline?.operations || {}).find(operation => operation.kind === 'body'
    && operation.status === 'running' && operation.basedOn?.branchId === chat.timeline?.branchId)
  return { userName: chat?.macroState?.userName, charName: chat?.cardName || '',
    lastUserMessage: operation?.userText || '', macroState: chat?.macroState || {}, ...supplied }
}

function stageOf(id) {
  if ([HUSHEN_IDS.decentralizePlayer, HUSHEN_IDS.paraphraseDirect, HUSHEN_IDS.paraphraseSegmented,
    HUSHEN_IDS.paraphraseNone, HUSHEN_IDS.agencyFull, HUSHEN_IDS.agencyNormal,
    HUSHEN_IDS.agencyDialogue, HUSHEN_IDS.agencyNone].includes(id)) return 'role-scene'
  return hushenStageForIdentifier(id)
}

export function buildHushenAgentProfile(snapshot, mode = HUSHEN_PRESET_ID, options = {}) {
  const settings = options.sourceSettings || hushenSourceSettings(snapshot, mode)
  const stages = stageDefinitions.map(([id, label, description]) => ({ id, label, description,
    groupIds: [], optionIds: [], variableIds: [], activeOptions: [], authorRuleIds: [], statusNotes: [] }))
  const byStage = new Map(stages.map(stage => [stage.id, stage]))
  const sourceEntries = new Map((snapshot?.compatibilityPreset?.entries || []).map(entry => [entry.entryKey, entry]))
  const selectedStage = new Map(), unmappedOptions = [], unmappedVariables = []
  for (const group of settings.groups || []) {
    const groupStage = group.options.flatMap(option => option.prompts || []).map(prompt => stageOf(hushenIdentifier(sourceEntries.get(prompt.key))))
      .find(id => id !== 'narration') || 'narration'
    for (const option of group.options || []) {
      const ids = (option.prompts || []).map(prompt => hushenIdentifier(sourceEntries.get(prompt.key) || { id: prompt.key }))
      const stageId = ids.map(stageOf).find(id => id !== 'narration') || groupStage
      const stage = byStage.get(stageId), reference = { groupId: group.id, optionId: option.id }
      if (!stage) { unmappedOptions.push(reference); continue }
      if (!stage.groupIds.includes(group.id)) stage.groupIds.push(group.id)
      stage.optionIds.push(reference)
      if (option.enabled) stage.activeOptions.push({ ...reference, label: option.label })
      if (option.compatibility?.status !== 'supported') stage.statusNotes.push({ ...reference, ...(option.compatibility || {}) })
      ids.forEach(id => selectedStage.set(id, stageId))
    }
    for (const input of group.variableInputs || []) {
      const stage = byStage.get(stageOf(input.id)), reference = { groupId: group.id, inputId: input.id }
      if (stage) stage.variableIds.push(reference)
      else unmappedVariables.push(reference)
    }
  }
  const resolved = resolveRules(snapshot, options.context || options.macroContext || {})
  for (const rule of resolved.rules) byStage.get(selectedStage.get(rule.identifier) || stageOf(rule.identifier)).authorRuleIds.push({
    key: rule.key, identifier: rule.identifier, name: rule.name, sourceHash: rule.sourceHash,
    resolvedHash: rule.resolvedHash, action: rule.action })
  const sourceOptionCount = settings.groups.reduce((sum, group) => sum + (group.options?.length || 0), 0)
  const sourceVariableCount = settings.groups.reduce((sum, group) => sum + (group.variableInputs?.length || 0), 0)
  const coverage = { scope: 'source-setting-placement', sourceGroupCount: settings.groups.length,
    sourceOptionCount, mappedOptionCount: stages.reduce((sum, stage) => sum + stage.optionIds.length, 0),
    sourceVariableCount, mappedVariableCount: stages.reduce((sum, stage) => sum + stage.variableIds.length, 0),
    unmappedOptions, unmappedVariables, duplicateOptions: [], complete: !unmappedOptions.length && !unmappedVariables.length }
  const capabilities = readHushenCapabilities(snapshot, { manifestOnly: true })
  return { id: HUSHEN_PRESET_ID, title: '狐神抚 DSH Agent 预设', enabled: mode === HUSHEN_PRESET_ID,
    stages, coverage, errors: [...(settings.errors || []), ...capabilities.diagnostics],
    capabilities: { ...capabilities, status: 'partial' },
    authorRules: { total: resolved.rules.length, excluded: resolved.excluded, sourceDigest: resolved.sourceDigest,
      resolvedDigest: resolved.resolvedDigest, contractDigest: resolved.contractDigest } }
}

/** Page complete resolved author rules; indexes/previews never replace the rule text. */
export function readHushenAgentRules(chat, request = {}) {
  const offset = request.offset ?? 0, limit = request.limit ?? 50
  const contentOffset = request.contentOffset ?? 0, maxChars = request.maxChars ?? 20000
  if (![offset, contentOffset].every(value => Number.isSafeInteger(value) && value >= 0)
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 50
    || !Number.isSafeInteger(maxChars) || maxChars < 1 || maxChars > 20000) throw new Error('作者规则分页参数无效')
  const resolved = resolveRules(chat?.runtimePresetSnapshot, contextFor(chat, request.context))
  const local = resolved.rendered.macroState?.local || {}
  const summary = rule => rule ? { key: rule.key, identifier: rule.identifier, name: rule.name,
    ruleIndex: resolved.rules.indexOf(rule), sourceHash: rule.sourceHash, resolvedHash: rule.resolvedHash } : null
  const variable = name => ({ variableId: name, characters: String(local[name] || '').length,
    preview: String(local[name] || '').slice(0, 180), truncated: String(local[name] || '').length > 180, hash: hash(local[name]) })
  const selected = { persona: null, writer: summary(resolved.rules.find(rule => rule.identifier === HUSHEN_IDS.preOutputCheck)),
    style: variable('wenfeng'), narrator: variable('POV'), charAnalysis: variable('think1'),
    chains: (resolved.compiled?.agentContract?.entries || []).filter(rule => HUSHEN_CHAIN_IDS.includes(rule.identifier))
      .map(({ id, identifier, name, sourceHash }) => ({ key: id, identifier, name, sourceHash })) }
  if (offset > resolved.rules.length || offset === resolved.rules.length && contentOffset !== 0) throw new Error('作者规则分页位置无效')
  let previewCharacters = selected.style.preview.length + selected.narrator.preview.length + selected.charAnalysis.preview.length
  if (previewCharacters >= maxChars) {
    selected.style.preview = ''; selected.narrator.preview = ''; selected.charAnalysis.preview = ''; previewCharacters = 0
  }
  let remaining = maxChars - previewCharacters, nextOffset = offset, nextContentOffset = contentOffset
  const rules = []
  while (nextOffset < resolved.rules.length && rules.length < limit && remaining > 0) {
    const rule = resolved.rules[nextOffset]
    if (nextContentOffset > rule.content.length) throw new Error('作者规则文本分页位置无效')
    const content = rule.content.slice(nextContentOffset, nextContentOffset + remaining), end = nextContentOffset + content.length
    rules.push({ ...rule, content, entryIndex: nextOffset, textOffset: nextContentOffset,
      nextContentOffset: end < rule.content.length ? end : null })
    remaining -= content.length
    if (end < rule.content.length) { nextContentOffset = end; break }
    nextOffset++; nextContentOffset = 0
  }
  return { author: 'hushen', offset, limit, total: resolved.rules.length, rules, characters: maxChars - remaining,
    previewCharacters, hasMore: nextOffset < resolved.rules.length, nextOffset, nextContentOffset, selected,
    excluded: resolved.excluded, digest: resolved.resolvedDigest, sourceDigest: resolved.sourceDigest,
    resolvedDigest: resolved.resolvedDigest, contractDigest: resolved.contractDigest }
}
