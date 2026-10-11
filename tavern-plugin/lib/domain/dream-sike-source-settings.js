// Interpret the author's preset-helper configuration as data; never run its script.
const phases = ['front', 'middle', 'back']
const substitute = (value, name) => String(value || '').split('{match}').join(name)
const compatibility = (status, label, reason = '') => ({ status, label, reason })

function sourceOf(snapshot) {
  const document = snapshot?.compatibilityPresetDocument
  const source = document?.preset || document
  const config = source?.extensions?.tavern_helper?.scripts?.find(script => Array.isArray(script.data?.groups))?.data
  return { source, config }
}
function regex(value, flags = '') {
  if (typeof value !== 'string') throw new Error('匹配规则必须为字符串')
  if (value.startsWith('/')) {
    const last = value.lastIndexOf('/')
    if (last > 0) return new RegExp(value.slice(1, last), value.slice(last + 1))
  }
  return new RegExp(value, flags)
}
function boundary(value) {
  if (value.startsWith('/') && value.lastIndexOf('/') > 0) {
    const expression = regex(value)
    return name => { expression.lastIndex = 0; return expression.test(name) }
  }
  return name => name === value
}
function matchIndexes(matchers, prompts, matchedName, errors) {
  const result = new Set()
  for (const matcher of matchers || []) {
    try {
      let test
      if (typeof matcher === 'string') test = name => name === substitute(matcher, matchedName)
      else if (typeof matcher?.name === 'string') test = name => name === substitute(matcher.name, matchedName)
      else {
        const expression = regex(substitute(matcher?.regex, matchedName), substitute(matcher?.flags, matchedName))
        test = name => { expression.lastIndex = 0; return expression.test(name) }
      }
      prompts.forEach((prompt, index) => { if (test(String(prompt.name || ''))) result.add(index) })
    } catch (error) { errors.push('提示词匹配无效：' + error.message) }
  }
  return [...result]
}
function catalog(snapshot) {
  const { source, config } = sourceOf(snapshot)
  const active = new Set(phases.flatMap(phase => (snapshot?.[phase]?.entries || [])
    .filter(entry => entry.enabled !== false).map(entry => entry.source?.entryKey || entry.id)))
  const entries = snapshot?.compatibilityPreset?.entries || []
  const prompts = (source?.prompts || []).map((prompt, index) => {
    const entry = entries.find(entry => entry.sourcePromptIndex === index)
    return { index, name: String(prompt.name || ''), content: String(prompt.content || ''),
      key: entry?.entryKey || '', available: !!entry && entry.injectable === true && entry.marker !== true,
      enabled: !!entry && (typeof entry.enabled === 'boolean' ? entry.enabled : active.has(entry.entryKey)) }
  })
  return { source, config, prompts }
}
function optionCompatibility(option, mode) {
  if (option.type === 'check_reasoner_format') return compatibility('unsupported', '原宿主设置不可用',
    '这是 SillyTavern 的 reasoning.auto_parse 和 think 前后缀设置；DSH 使用原生推理协议，不能在此修改该宿主设置。')
  if ((option.effect || []).length) return compatibility('partial', '提示词可选；扩展效果未支持',
    '可切换该选项的原始提示词；DSH 未实现 ' + option.effect.join('、') + '，选择此项不会启用 Kimi Partial Mode。')
  if (/数据库|记忆表格|柏宝书|Ruby/.test(option.label || '')) return compatibility('partial', '原文可选；材料提供方待接入',
    '保留原作者提示词；对应数据库、表格或扩展宏的动态材料提供方尚未在 Agent 模式恢复，启用条目不代表这些依赖已运行。')
  if (mode === 'dream-sike-dsh' && /八股超杀|自检修复|总结/.test(option.label || '')) return compatibility('partial', '原文可选；流程待验收',
    '保留原作者提示词；旧脚本的检查、修复或总结流程与 Agent 执行协议不同，尚未完成此选项的端到端验收。')
  if (mode === 'dream-sike-dsh' && /预填充|思考|思维链|写作模式|聊天模式/.test(option.label || '')) {
    return compatibility('adapted', '原文规则与 Agent 协议适配', '提示词选项保留；原宿主预填充和文本思考封装由原生 Agent 协议处理，不能保证模型内部推理格式。')
  }
  return compatibility('supported', '原文启用已支持', '按原助手规则修改本局提示词启用状态；这不代表该选项的生成体验已经逐项验收。')
}
function build(snapshot, mode) {
  const { config, prompts } = catalog(snapshot)
  const errors = []
  if (!config) return { title: '', description: '', errors, groups: [] }
  const groups = (config.groups || []).map(group => {
    const groupErrors = []
    const disableGroup = matchIndexes(group.disable_group, prompts, '', groupErrors)
    const enableGroup = matchIndexes(group.enable_group, prompts, '', groupErrors)
    const options = [], variableInputs = []
    for (const raw of group.options || []) {
      const id = raw.id || (['var_input', 'global_var_input'].includes(raw.type) ? `${raw.type}:${raw.variable_id}` : raw.type)
      if (['var_input', 'global_var_input'].includes(raw.type)) {
        const scope = raw.type === 'global_var_input' ? 'global' : 'chat'
        const value = snapshot?.sourceMacroOverrides?.[scope === 'chat' ? 'local' : 'global']?.[raw.variable_id]
        variableInputs.push({ id, label: raw.label, description: raw.description || '', variableId: raw.variable_id,
          scope, value: value === undefined ? '' : String(value), available: true,
          compatibility: compatibility('supported', '仅本局生效', scope === 'global'
            ? '原助手的全局宏在这里作为本局覆盖保存，不会修改其他游戏。' : '按原助手的聊天变量保存到本局。') })
        continue
      }
      let expansions = [{ raw, id, name: '' }]
      if (raw.type === 'between') {
        try {
          if (!raw.match) throw new Error('缺少区间匹配配置')
          const startTest = boundary(raw.match.below || '')
          const start = raw.match.below === '' ? -1 : prompts.findIndex(prompt => startTest(prompt.name))
          if (start < 0 && raw.match.below !== '') throw new Error('未找到起始标记：' + raw.match.below)
          const endTest = boundary(raw.match.above || '')
          const end = raw.match.above === '' ? prompts.length : prompts.findIndex((prompt, index) => index > start && endTest(prompt.name))
          if (end < 0) throw new Error('未找到结束标记：' + raw.match.above)
          expansions = prompts.slice(start + 1, end).map(prompt => ({ raw, id: `${substitute(id, prompt.name)}:${prompt.index}`, name: prompt.name }))
          if (!expansions.length) throw new Error('区间中没有提示词')
        } catch (error) {
          groupErrors.push(error.message)
          expansions = [{ raw, id: `${id}:between-unmatched`, name: '', error: error.message }]
        }
      }
      for (const expansion of expansions) {
        const optionErrors = []
        const enable = matchIndexes(raw.enable, prompts, expansion.name, optionErrors)
        const disable = matchIndexes(raw.disable, prompts, expansion.name, optionErrors)
        const related = [...new Set([...enable, ...disable])]
        const expected = new Map()
        disableGroup.forEach(index => expected.set(index, false)); enableGroup.forEach(index => expected.set(index, true))
        disable.forEach(index => expected.set(index, false)); enable.forEach(index => expected.set(index, true))
        const available = raw.type !== 'check_reasoner_format' && !expansion.error && !optionErrors.length
          && related.length > 0 && [...expected.keys()].every(index => prompts[index].available)
        const enabled = available && [...expected].every(([index, value]) => prompts[index].enabled === value)
        const option = { id: expansion.id, label: substitute(raw.label || id, expansion.name),
          description: substitute(raw.description, expansion.name), status: available ? (enabled ? 'active' : 'inactive') : 'unmatched',
          enabled, available, compatibility: optionCompatibility({ ...raw, label: substitute(raw.label || id, expansion.name) }, mode),
          prompts: related.map(index => { const prompt = prompts[index]; return { key: prompt.key, name: prompt.name, content: prompt.content, enabled: prompt.enabled } }),
          _enable: enable, _disable: disable, _raw: raw }
        if (expansion.error) option.compatibility = compatibility('unsupported', '原始区间未匹配', expansion.error)
        options.push(option); groupErrors.push(...optionErrors)
      }
    }
    errors.push(...groupErrors.map(error => `${group.label || group.id}：${error}`))
    return { id: group.id, label: group.label || group.id, description: group.description || '', mode: group.mode || 'single',
      options, variableInputs, _disable: disableGroup, _enable: enableGroup, _prompts: prompts }
  })
  return { title: config.title || '梦鲸思客设置', description: '读取原预设助手的设置分组；修改仅作用于本局，从下一回合生效。', errors: [...new Set(errors)], groups }
}
export function dreamSikeSourceSettings(snapshot, mode = 'tavern') {
  const view = build(snapshot, mode)
  return { ...view, groups: view.groups.map(({ _disable, _enable, _prompts, ...group }) => ({ ...group,
    options: group.options.map(({ _enable, _disable, _raw, ...option }) => option) })) }
}
export function applyDreamSikeSourceAction(snapshot, action, mode = 'tavern') {
  if (!action || typeof action.groupId !== 'string' || typeof action.optionId !== 'string') throw new Error('原预设设置操作无效')
  const group = build(snapshot, mode).groups.find(group => group.id === action.groupId)
  if (!group) throw new Error('原预设设置组不存在')
  const macroOverrides = structuredClone(snapshot?.sourceMacroOverrides || { local: {}, global: {} })
  macroOverrides.local ||= {}; macroOverrides.global ||= {}
  const input = group.variableInputs.find(input => input.id === action.optionId)
  if (input) {
    if (typeof action.value !== 'string' || action.value.length > 10000 || ['__proto__', 'prototype', 'constructor'].includes(input.variableId)) throw new Error('自定义变量值无效')
    macroOverrides[input.scope === 'chat' ? 'local' : 'global'][input.variableId] = action.value
    return { entries: [], macroOverrides }
  }
  const option = group.options.find(option => option.id === action.optionId)
  if (!option || !option.available) throw new Error('原预设选项不可用')
  if (action.enabled !== undefined && typeof action.enabled !== 'boolean') throw new Error('选项启用状态无效')
  if (group.mode === 'single' && action.enabled === false) throw new Error('单选设置需要选择一个选项')
  const states = new Map(), set = (indexes, enabled) => indexes.forEach(index => states.set(index, enabled))
  if (group.mode === 'single') {
    if (group._disable.length || group._enable.length) { set(group._disable, false); set(group._enable, true) }
    else group.options.filter(item => item.id !== option.id).forEach(item => set(item._enable, false))
    set(option._disable, false); set(option._enable, true)
  } else if (action.enabled ?? !option.enabled) { set(option._disable, false); set(option._enable, true) }
  else set(option._enable, false)
  if ([...states.keys()].some(index => !group._prompts[index]?.available)) throw new Error('原预设操作引用不可注入的提示词')
  return { entries: [...states].map(([index, enabled]) => ({ key: group._prompts[index].key, enabled })), macroOverrides }
}
