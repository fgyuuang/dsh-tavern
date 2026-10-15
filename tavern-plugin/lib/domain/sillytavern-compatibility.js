import { inputAttachments } from './player-input-content.js'
import { applySillyTavernStrictTools } from './sillytavern-strict-tools.js'
function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function role(value) {
  return value === 'user' || value === 'assistant' ? value : 'system'
}

function macro(text, resolveMacros, state, card) {
  const result = resolveMacros(str(text), { charName: str(card.name), macroState: state })
  state.userName = result.macroState.userName
  state.local = result.macroState.local
  state.global = result.macroState.global
  return { text: result.text, diagnostics: result.diagnostics || [] }
}

function exampleMessages(value, options = {}) {
  let source = str(value)
  if (source === '' || source === '<START>') return []
  source = source
    .replace(/{{\s*user\s*}}/gi, str(options.userName))
    .replace(/{{\s*char\s*}}/gi, str(options.charName))
  if (!source.startsWith('<START>')) source = '<START>\n' + source.trim()
  const blocks = source.split(/<START>/i).slice(1)
  const messages = []
  for (const block of blocks) {
    const parsed = []
    let current = null
    function flush() {
      if (current === null) return
      const content = current.lines.join('\n').trim()
      if (content !== '') parsed.push({ role: 'system', content, name: current.name })
      current = null
    }
    for (const line of block.trim().replace(/\r/g, '').split('\n')) {
      const userPrefix = str(options.userName) + ':'
      const charPrefix = str(options.charName) + ':'
      if (userPrefix !== ':' && line.startsWith(userPrefix)) {
        flush()
        current = { name: 'example_user', lines: [line.slice(userPrefix.length).trimStart()] }
      } else if (charPrefix !== ':' && line.startsWith(charPrefix)) {
        flush()
        current = { name: 'example_assistant', lines: [line.slice(charPrefix.length).trimStart()] }
      } else if (current !== null) {
        current.lines.push(line)
      }
    }
    flush()
    if (parsed.length === 0) continue
    messages.push({ role: 'system', content: str(options.newExampleChatPrompt) })
    messages.push(...parsed)
  }
  return messages
}

function markerMessages(identifier, input) {
  const card = input.card
  const settings = input.settings
  const worldInfo = content => str(settings.wi_format).trim() ? str(settings.wi_format).replaceAll('{0}', content) : content
  switch (identifier) {
    case 'worldInfoBefore': return input.worldInfoBefore ? [{ role: input.role, content: worldInfo(input.worldInfoBefore) }] : []
    case 'worldInfoAfter': return input.worldInfoAfter ? [{ role: input.role, content: worldInfo(input.worldInfoAfter) }] : []
    case 'charDescription': return str(card.description).trim() ? [{ role: 'system', content: card.description }] : []
    case 'charPersonality': {
      const value = str(card.personality).trim()
      if (!value) return []
      const format = str(settings.personality_format)
      return [{ role: 'system', content: format ? format.replace(/{{\s*personality\s*}}/gi, value) : value }]
    }
    case 'scenario': {
      const value = str(card.scenario).trim()
      if (!value) return []
      const format = str(settings.scenario_format)
      return [{ role: 'system', content: format ? format.replace(/{{\s*scenario\s*}}/gi, value) : value }]
    }
    case 'personaDescription': return input.persona ? [{ role: 'system', content: input.persona }] : []
    case 'dialogueExamples': return exampleMessages(card.mes_example, {
      userName: input.userName,
      charName: card.name,
      newExampleChatPrompt: settings.new_example_chat_prompt
    })
    case 'chatHistory': return input.history
    default: return null
  }
}

/** ST 1.18 inserts grouped depth prompts into reverse history, then reverses it. */
function insertDepthPrompts(history, injections) {
  const reversed = history.slice().reverse()
  const depths = [...new Set(injections.map(entry => Math.max(0, Math.trunc(Number(entry.depth) || 0))))].sort((a, b) => a - b)
  let inserted = 0
  for (const depth of depths) {
    const selected = injections.filter(entry => Math.max(0, Math.trunc(Number(entry.depth) || 0)) === depth)
    const orderOf = entry => Number.isFinite(Number(entry.order)) ? Number(entry.order) : 100
    const orders = [...new Set(selected.map(orderOf))].sort((a, b) => b - a)
    const groups = []
    for (const order of orders) for (const entryRole of ['system', 'user', 'assistant']) {
      const entries = selected.filter(entry => orderOf(entry) === order && role(entry.role) === entryRole)
      if (!entries.length) continue
      groups.push({ role: entryRole, content: entries.map(entry => entry.content.trim()).filter(Boolean).join('\n'),
        source: { kind: 'preset-depth', depth, order, entries: entries.map(entry => entry.source) } })
    }
    reversed.splice(Math.min(reversed.length, depth + inserted), 0, ...groups)
    inserted += groups.length
  }
  return reversed.reverse()
}

/** Provider-independent fields supported by the installed DSH llm adapter. */
export function sillyTavernGenerationOptions(settings = {}) {
  const generationOptions = {}, sourceGenerationOptions = {}, diagnostics = []
  const fields = ['temperature', 'top_p', 'top_k', 'top_a', 'min_p', 'frequency_penalty', 'presence_penalty', 'repetition_penalty', 'seed', 'reasoning_effort', 'verbosity']
  for (const key of fields) if (settings[key] !== undefined) sourceGenerationOptions[key] = settings[key]
  const maxTokens = settings.openai_max_tokens ?? settings.max_completion_tokens ?? settings.max_tokens
  if (maxTokens !== undefined) sourceGenerationOptions.max_tokens = maxTokens
  if (typeof settings.temperature === 'number' && Number.isFinite(settings.temperature) && settings.temperature >= 0 && settings.temperature <= 2) generationOptions.temperature = settings.temperature
  else if (settings.temperature !== undefined) diagnostics.push({ kind: 'preset-generation', code: 'invalid-temperature' })
  if (Number.isSafeInteger(maxTokens) && maxTokens > 0) generationOptions.maxTokens = maxTokens
  else if (maxTokens !== undefined) diagnostics.push({ kind: 'preset-generation', code: 'invalid-max-tokens' })
  if (['off', 'low', 'medium', 'high', 'xhigh'].includes(settings.reasoning_effort)) generationOptions.reasoningEffort = settings.reasoning_effort
  const unsupported = Object.keys(sourceGenerationOptions).filter(key => !['temperature', 'max_tokens'].includes(key)
    && !(key === 'reasoning_effort' && generationOptions.reasoningEffort !== undefined))
  if (unsupported.length) diagnostics.push({ kind: 'preset-generation', code: 'unsupported-adapter-options', fields: unsupported })
  return { generationOptions, sourceGenerationOptions, diagnostics }
}

/** Respect source post-processing rather than forcing strict role conversion. */
export function postProcessSillyTavernMessages(messages, settings = {}, names = {}) {
  let output = messages.map(message => ({ ...message, ...(message.inputAttachments?.length ? { inputAttachments: inputAttachments(message.inputAttachments) } : {}) }))
  if (settings.squash_system_messages === true) {
    const squashed = []
    const squashable = message => message?.role === 'system' && !message.name && !['newMainChat', 'newChat', 'groupNudge'].includes(message.source?.identifier)
    for (const message of output) {
      if (message.role === 'system' && !message.content) continue
      const previous = squashed.at(-1)
      if (squashable(message) && squashable(previous)) previous.content += '\n' + message.content
      else squashed.push(message)
    }
    output = squashed
  }
  const processing = str(settings.custom_prompt_post_processing)
  if (!processing || processing === 'none') return output
  if (processing === 'strict_tools') return applySillyTavernStrictTools(output, names)
  const supported = ['claude', 'merge', 'merge_tools', 'semi', 'semi_tools', 'strict', 'single']
  if (!supported.includes(processing)) throw new Error('尚不支持原预设的提示词后处理：' + processing)
  const keepTools = processing.endsWith('_tools'), strict = ['semi', 'semi_tools', 'strict'].includes(processing)
  const merged = []
  const append = (message, target = merged) => {
    const previous = target.at(-1)
    if (previous && previous.role === message.role && message.role !== 'tool' && (message.content || message.inputAttachments?.length)) {
      if (message.content) previous.content += (previous.content ? '\n\n' : '') + message.content
      if (message.inputAttachments?.length) previous.inputAttachments = [...(previous.inputAttachments || []), ...message.inputAttachments]
    } else target.push(message)
  }
  for (const message of output) {
    const prefix = message.name === 'example_user' ? names.userName : message.name === 'example_assistant' ? names.charName : message.role !== 'system' ? message.name : ''
    if (prefix && !message.content.startsWith(prefix + ': ')) message.content = prefix + ': ' + message.content
    delete message.name
    if (!keepTools) { if (message.role === 'tool') message.role = 'user'; delete message.tool_calls; delete message.tool_call_id }
    if (processing === 'single') {
      const speaker = message.role === 'assistant' ? names.charName : message.role === 'user' ? names.userName : ''
      if (speaker && !message.content.startsWith(speaker + ': ')) message.content = speaker + ': ' + message.content
      message.role = 'user'
    }
    append(message)
  }
  if (!merged.length) merged.push({ role: 'user', content: '[Start a new chat]' })
  if (strict) for (const [index, message] of merged.entries()) if (index > 0 && message.role === 'system') message.role = 'user'
  if (processing === 'strict' && !['system', 'user'].includes(merged[0].role)) merged.unshift({ role: 'user', content: '[Start a new chat]' })
  else if (processing === 'strict' && merged[0].role === 'system' && merged[1]?.role !== 'user') merged.splice(1, 0, { role: 'user', content: '[Start a new chat]' })
  const coalesced = []
  for (const message of merged) append(message, coalesced)
  return coalesced
}

function overrideContent(entry, card) {
  if (entry.forbidOverrides !== true && entry.identifier === 'main' && str(card.system_prompt).trim() !== '') return card.system_prompt
  if (entry.forbidOverrides !== true && entry.identifier === 'jailbreak' && str(card.post_history_instructions).trim() !== '') return card.post_history_instructions
  return entry.content
}

/**
 * Built-in prompt order for compatibility conversations without an external
 * SillyTavern preset. This is deliberately small: it only projects card,
 * world-book, example and conversation data already owned by Tavern.
 */
export function createCleanCompatibilityPreset() {
  const definitions = [
    ['main', 'system', false],
    ['worldInfoBefore', 'system', true],
    ['charDescription', 'system', true],
    ['charPersonality', 'system', true],
    ['scenario', 'system', true],
    ['personaDescription', 'system', true],
    ['worldInfoAfter', 'system', true],
    ['dialogueExamples', 'system', true],
    ['chatHistory', 'system', true],
    ['jailbreak', 'system', false]
  ]
  return {
    valid: true,
    recognized: true,
    title: '内置纯净预设',
    orderGroupIndex: null,
    entries: definitions.map(function ([identifier, entryRole, marker]) {
      return {
        entryKey: 'builtin:' + identifier,
        identifier,
        name: identifier,
        role: entryRole,
        content: '',
        marker,
        enabled: true,
        ordered: true
      }
    })
  }
}

/**
 * Compile one foreground request at the SillyTavern prompt-order seam.
 * Callers provide resources and projections; this module owns ordering,
 * marker expansion, role preservation and absolute-depth insertion.
 */
export function compileSillyTavernRequest(options = {}) {
  const card = options.card && typeof options.card === 'object' ? options.card : {}
  const preset = options.preset && typeof options.preset === 'object' ? options.preset : {}
  const settings = options.presetDocument && typeof options.presetDocument === 'object' ? options.presetDocument : {}
  const macroResolver = typeof options.resolveMacros === 'function'
    ? options.resolveMacros
    : function (text, context) { return { text: str(text), diagnostics: [], macroState: context.macroState } }
  const resolveMacros = (text, context) => macroResolver(text, { ...context, lastUserMessage: str(options.input) })
  const projectPromptText = typeof options.projectPromptText === 'function'
    ? options.projectPromptText
    : function (text) { return { text: str(text), warnings: [], applied: [] } }
  const state = {
    userName: str(options.userName).trim() || '你',
    local: Object.assign({}, options.macroState && options.macroState.local || {}),
    global: Object.assign({}, options.macroState && options.macroState.global || {})
  }
  const diagnostics = []
  let history = (Array.isArray(options.history) ? options.history : []).map(function (item) {
    const sourceText = str(item.sourceText || item.text || item.content)
    return { role: role(item.role), content: sourceText, ...(item.inputAttachments?.length ? { inputAttachments: inputAttachments(item.inputAttachments) } : {}), source: { kind: 'chat-history' } }
  })
  const inputText = str(options.input).trim()
  if (inputText !== '' || options.inputAttachments?.length) {
    history.push({ role: 'user', content: inputText, ...(options.inputAttachments?.length ? { inputAttachments: inputAttachments(options.inputAttachments) } : {}), source: { kind: 'current-input' } })
  }
  for (const [index, item] of history.entries()) {
    const rendered = macro(item.content, resolveMacros, state, card)
    const messageRole = role(item.role)
    const depth = history.length - index - 1
    const placement = messageRole === 'user' ? 1 : (messageRole === 'assistant' ? 2 : null)
    const projected = placement === null
      ? { text: rendered.text, warnings: [] }
      : projectPromptText(rendered.text, { role: messageRole, placement, depth, sourceKind: item.source.kind })
    diagnostics.push(...rendered.diagnostics, ...(projected.warnings || []))
    item.content = projected.text
    item.source.depth = depth
  }

  if (history.at(-1)?.role === 'assistant' && str(settings.send_if_empty)) history.push({ role: 'user', content: str(settings.send_if_empty), source: { kind: 'empty-input-replacement' } })
  const selected = (Array.isArray(preset.entries) ? preset.entries : []).filter(function (entry) {
    return entry && entry.ordered === true && entry.enabled === true
  })
  const regular = []
  const absolute = []
  for (const entry of selected) {
    if (Number(entry.injectionPosition) === 1 && !['chatHistory', 'dialogueExamples'].includes(entry.identifier)) absolute.push(entry)
    else regular.push(entry)
  }
  const injections = (Array.isArray(options.depthInjections) ? options.depthInjections : []).map(entry => ({ ...entry }))
  for (const entry of absolute) {
    const marker = markerMessages(str(entry.identifier), { card, settings, history, role: role(entry.role), persona: str(options.persona),
      userName: state.userName, worldInfoBefore: str(options.worldInfoBefore), worldInfoAfter: str(options.worldInfoAfter) })
    for (const value of marker === null ? [{ content: overrideContent(entry, card) }] : marker) {
      const rendered = macro(value.content, resolveMacros, state, card)
      diagnostics.push(...rendered.diagnostics)
      if (!rendered.text.trim()) continue
      injections.push({ role: role(entry.role), content: rendered.text, depth: Number(entry.injectionDepth) || 0,
        order: entry.injectionOrder ?? 100, source: { entryKey: entry.entryKey, identifier: entry.identifier } })
    }
  }
  for (const injection of injections) {
    if (injection.source?.entryKey) continue
    const rendered = macro(injection.content, resolveMacros, state, card)
    injection.content = rendered.text
    diagnostics.push(...rendered.diagnostics)
  }
  history = insertDepthPrompts(history, injections.filter(entry => str(entry.content).trim()))
  const newChat = macro(settings.new_chat_prompt, resolveMacros, state, card)
  diagnostics.push(...newChat.diagnostics)
  if (newChat.text) history.unshift({ role: 'system', content: newChat.text, source: { kind: 'new-chat', identifier: 'newMainChat' } })

  const messages = []
  for (const entry of regular) {
    const marker = markerMessages(str(entry.identifier), {
      card, settings, history,
      role: role(entry.role),
      userName: state.userName,
      persona: str(options.persona),
      worldInfoBefore: str(options.worldInfoBefore),
      worldInfoAfter: str(options.worldInfoAfter)
    })
    let values = marker === null ? [{ role: entry.role, content: overrideContent(entry, card) }] : marker
    if (marker !== null && !['chatHistory', 'dialogueExamples'].includes(entry.identifier)) values = values.map(value => ({ ...value, role: role(entry.role) }))
    if (entry.identifier === 'dialogueExamples') values = [...(options.exampleBefore || []).map(content => ({ role: 'system', content })), ...values,
      ...(options.exampleAfter || []).map(content => ({ role: 'system', content }))]
    for (const value of values) {
      const alreadyProjected = value.source && ['chat-history', 'current-input', 'preset-depth', 'new-chat'].includes(value.source.kind)
      const rendered = alreadyProjected ? { text: value.content, diagnostics: [] } : macro(value.content, resolveMacros, state, card)
      diagnostics.push(...rendered.diagnostics)
      if (rendered.text.trim() === '' && !value.inputAttachments?.length) continue
      messages.push({
        role: role(value.role), content: rendered.text,
        ...(value.inputAttachments?.length ? { inputAttachments: inputAttachments(value.inputAttachments) } : {}),
        ...(value.name ? { name: value.name } : {}),
        source: value.source || { kind: entry.marker ? 'marker' : 'preset', entryKey: entry.entryKey, identifier: entry.identifier, name: entry.name }
      })
    }
  }

  const prefill = macro(settings.assistant_prefill, resolveMacros, state, card)
  diagnostics.push(...prefill.diagnostics)
  if (prefill.text) messages.push({ role: 'assistant', content: prefill.text, source: { kind: 'assistant-prefill' } })
  const sampling = sillyTavernGenerationOptions(settings)
  diagnostics.push(...sampling.diagnostics)
  return {
    messages,
    generationOptions: sampling.generationOptions,
    sourceGenerationOptions: sampling.sourceGenerationOptions,
    macroState: state,
    diagnostics,
    trace: {
      presetPath: str(options.presetPath),
      presetTitle: str(preset.title),
      selectedEntryKeys: selected.map(function (entry) { return entry.entryKey }),
      promptOrderGroupIndex: Number.isInteger(preset.orderGroupIndex) ? preset.orderGroupIndex : null,
      sourceRevision: str(options.sourceRevision)
    }
  }
}
