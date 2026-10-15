import { readHushenStaticMetadata } from './hushen-capabilities.js'

const off = '__SS_GROUP_OFF__'
const phases = ['front', 'middle', 'back']
const compatible = (status, label, reason) => ({ status, label, reason })
function sourceOf(snapshot) {
  const document = snapshot?.compatibilityPresetDocument
  return document?.preset || document
}
function promptsOf(snapshot) {
  const active = new Set(phases.flatMap(phase => (snapshot?.[phase]?.entries || []).map(item => item.id)))
  const entries = snapshot?.compatibilityPreset?.entries || []
  return (sourceOf(snapshot)?.prompts || []).map((raw, index) => {
    const entry = entries.find(item => item.sourcePromptIndex === index)
    return { id: raw.identifier || raw.id, name: String(raw.name || ''), content: String(raw.content || ''),
      key: entry?.entryKey || '', enabled: entry ? (typeof entry.enabled === 'boolean' ? entry.enabled : active.has(entry.entryKey)) : false,
      available: !!entry && entry.injectable === true && entry.marker !== true }
  })
}
function build(snapshot, mode) {
  const metadata = readHushenStaticMetadata(snapshot), registry = metadata.registry, prompts = promptsOf(snapshot)
  const errors = [...metadata.diagnostics], groups = []
  if (!registry) return { title: '', description: '', groups, errors }
  const byId = new Map(prompts.map(prompt => [prompt.id, prompt]))
  const makeOption = raw => {
    const prompt = byId.get(raw.id)
    return { id: raw.id, label: raw.name || prompt?.name || raw.id, description: '',
      enabled: prompt?.enabled === true, available: prompt?.available === true,
      status: !prompt?.available ? 'unmatched' : prompt.enabled ? 'active' : 'inactive',
      compatibility: !prompt?.available ? compatible('unsupported', '源条目不可用', '原设置引用的提示词未找到或不可注入。')
        : mode === 'hushen-dsh' && /思维链|尾部|MVU|变量|小说|狐裁/.test(raw.name || prompt.name)
          ? compatible('partial', '作者原文可选；执行协议另行适配', '切换仅保留本局原文选项，不会启动原助手的生成拦截、模型调用或状态更新；模块执行状态另行显示。')
          : compatible('supported', '本局原文开关', '只修改本局预设副本，从下一回合生效；尚未逐项验收生成效果。'),
      prompts: prompt ? [{ key: prompt.key, name: prompt.name, content: prompt.content, enabled: prompt.enabled }] : [], _prompt: prompt }
  }
  for (const [index, raw] of (registry.SELECT_GROUPS || []).entries()) {
    const options = (raw.options || []).map(makeOption)
    const enabled = options.filter(option => option.enabled)
    if (enabled.length > 1) errors.push(raw.label + '：原文件同时启用了多个互斥条目，已保留现状；选择后按作者规则只保留一项。')
    options.unshift({ id: off, label: '❌已关闭此模块', description: '', enabled: enabled.length === 0,
      available: options.some(option => option.available), status: enabled.length ? 'inactive' : 'active', prompts: [],
      compatibility: compatible('supported', '关闭该组原条目', '沿用作者下拉框的关闭操作，关闭此组全部提示词。') })
    groups.push({ id: 'hushen:SELECT_GROUPS:' + index, label: raw.label, description: '', mode: 'single', options, variableInputs: [] })
  }
  for (const [field, label] of [['QUICK_TOGGLE_IDS', '🔧 快捷开关'], ['KILL_TOGGLES', '😡 杀八股']]) {
    groups.push({ id: 'hushen:' + field, label, description: '', mode: 'multiple',
      options: (registry[field] || []).map(makeOption), variableInputs: [] })
  }
  const normal = registry.JAILBREAK_NORMAL_ID, strict = registry.JAILBREAK_STRICT_ID
  if (normal && strict) groups.push({ id: 'hushen:JAILBREAK', label: '🧨 破限模式', description: '保留原作者两个条目的选择关系。', mode: 'single',
    options: [makeOption({ id: normal, name: '普通破限' }), makeOption({ id: strict, name: '严格破限' })], variableInputs: [] })
  const custom = (registry.CUSTOM_EDIT_IDS || []).filter((raw, index, all) => all.findIndex(item => item.id === raw.id) === index)
  groups.push({ id: 'hushen:CUSTOM_EDIT_IDS', label: '✏️ 自定义内容编辑', description: '编辑原助手登记的本局提示词原文。', mode: 'multiple', options: [],
    variableInputs: custom.map(raw => {
      const prompt = byId.get(raw.id)
      return { id: raw.id, label: raw.name, description: '', variableId: raw.knownVar || raw.id, scope: 'chat', multiline: true, maxLength: 100000,
        value: prompt?.content || '', available: prompt?.available === true,
        compatibility: prompt?.available ? compatible('supported', '本局条目原文', '保存至本局提示词副本，不写入源预设或其他游戏。')
          : compatible('unsupported', '源条目不可用', '未找到作者登记的自定义提示词条目。'), _prompt: prompt }
    }) })
  return { title: metadata.scriptName || '🦊玄狐・狐神撫',
    description: '从原助手的静态注册表读取作者选项；本页开关只修改本局原文，独立模块的数据库、生成与界面不会因此自动启动。',
    groups, errors, source: { scriptId: metadata.scriptId, sourceHash: metadata.sourceHash }, _prompts: byId }
}
export function hushenSourceSettings(snapshot, mode = 'hushen-dsh') {
  const { _prompts, ...view } = build(snapshot, mode)
  return { ...view, groups: view.groups.map(group => ({ ...group,
    options: group.options.map(({ _prompt, ...option }) => option),
    variableInputs: group.variableInputs.map(({ _prompt, ...input }) => input) })) }
}
export function applyHushenSourceAction(snapshot, action, mode = 'hushen-dsh') {
  if (!action || typeof action.groupId !== 'string' || typeof action.optionId !== 'string') throw new Error('原预设设置操作无效')
  const group = build(snapshot, mode).groups.find(item => item.id === action.groupId)
  if (!group) throw new Error('狐神抚原设置组不存在')
  const input = group.variableInputs.find(item => item.id === action.optionId)
  if (input) {
    if (!input.available || typeof action.value !== 'string' || action.value.length > 100000) throw new Error('自定义原文无效')
    return { entries: [{ key: input._prompt.key, enabled: input._prompt.enabled, content: action.value }] }
  }
  const option = group.options.find(item => item.id === action.optionId)
  if (!option?.available) throw new Error('狐神抚原选项不可用')
  if (action.enabled !== undefined && typeof action.enabled !== 'boolean') throw new Error('选项启用状态无效')
  if (group.mode === 'single' && action.enabled === false) throw new Error('请选择一个选项，或选择作者的关闭此模块项')
  const states = new Map()
  if (group.mode === 'single') for (const candidate of group.options) {
    if (candidate.id === off) continue
    // The author's groups also contain empty novel-mode slots. Those have no
    // injectable rule to toggle and must not block the other original options.
    if (!candidate._prompt?.available) continue
    states.set(candidate._prompt.key, candidate.id === option.id)
  }
  else states.set(option._prompt.key, action.enabled ?? !option.enabled)
  return { entries: [...states].map(([key, enabled]) => ({ key, enabled })) }
}
