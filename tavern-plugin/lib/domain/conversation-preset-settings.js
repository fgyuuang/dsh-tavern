import { createHash } from 'node:crypto'
import { nativeRegexScriptsOf } from './preset-reading.js'
import { compileDreamSikeContract } from './dream-sike-contract.js'
import { dreamSikeSourceSettings, applyDreamSikeSourceAction } from './dream-sike-source-settings.js'
import { buildDreamSikeAgentProfile } from './dream-sike-agent-profile.js'

const phases = ['front', 'middle', 'back']
function regexCatalog(snapshot) {
  const native = nativeRegexScriptsOf(snapshot.compatibilityPresetDocument)
  const scripts = native.length ? native : snapshot.compatibilityPreset?.regexScripts || []
  const counts = new Map()
  return scripts.map((script, index) => {
    const id = String(script.id || 'regex-' + (index + 1)), count = (counts.get(id) || 0) + 1
    counts.set(id, count)
    return { ...script, regexKey: script.regexKey || id + '#' + count }
  })
}
function orderedEntries(snapshot) {
  const preset = snapshot?.compatibilityPreset
  const entries = preset?.entries || []
  if (preset?.dshPreset) return phases.flatMap(phase => (preset.dshPreset[phase] || []).map(item => ({
    phase, entry: Number.isInteger(item.source?.sourcePromptIndex)
      ? entries.find(entry => entry.sourcePromptIndex === item.source.sourcePromptIndex)
      : entries.find(entry => entry.entryKey === item.id)
  })))
  return entries.filter(entry => entry.ordered === true).map(entry => ({ phase: Number(entry.injectionPosition) === 1 ? 'middle' : 'front', entry }))
}
export function conversationPresetSettings(snapshot, mode = 'tavern') {
  if (!snapshot) return { presetName: '', digest: '', entries: [], regexScripts: [], helperScripts: [] }
  const active = new Map(phases.flatMap(phase => (snapshot[phase]?.entries || []).map(entry => [entry.id, entry])))
  const allEntries = orderedEntries(snapshot).filter(({ entry }) => entry && entry.injectable === true && entry.marker !== true)
  const inspection = { ...snapshot, front: { entries: allEntries.map(({ entry }) => ({ ...entry, id: entry.entryKey,
    enabled: true, source: { identifier: entry.identifier } })) }, middle: { entries: [] }, back: { entries: [] } }
  delete inspection.agentContract
  const actions = new Map((compileDreamSikeContract(inspection)?.agentContract?.entries || []).map(entry => [entry.id, entry.action]))
  const regexActive = new Set((snapshot.regexScripts || []).filter(script => script.enabled !== false).map(script => script.regexKey || script.id))
  const sourceSettings = dreamSikeSourceSettings(snapshot, mode)
  return {
    presetName: snapshot.presetName, digest: snapshot.digest,
    sourceSettings: sourceSettings.groups.length ? sourceSettings : null,
    agentPreset: sourceSettings.groups.length ? buildDreamSikeAgentProfile(snapshot, mode) : null,
    entries: orderedEntries(snapshot).filter(({ entry }) => entry && entry.marker !== true && entry.injectable === true).map(({ phase, entry }) => ({
      key: entry.entryKey, name: entry.name || entry.entryKey, phase, role: entry.role,
      enabled: active.has(entry.entryKey), content: active.get(entry.entryKey)?.content ?? entry.content ?? '',
      editableContent: mode !== 'dream-sike-dsh' || actions.get(entry.entryKey) === 'preserved',
      execution: mode !== 'dream-sike-dsh' || actions.get(entry.entryKey) === 'preserved' ? '写作规则原文注入' : '原执行协议由 Agent 适配；可切换启用状态，修改协议请使用预设库'
    })),
    regexScripts: regexCatalog(snapshot).map(script => ({
      key: script.regexKey || script.id, name: script.name || script.scriptName || script.id,
      enabled: regexActive.has(script.regexKey || script.id),
      layer: [script.promptOnly && '请求', script.markdownOnly && '显示'].filter(Boolean).join('、') || '正式消息'
    })),
    helperScripts: (snapshot.compatibilityPresetDocument?.extensions?.tavern_helper?.scripts || []).filter(script => script.type === 'script').map(script => ({
      name: script.name, configured: script.enabled !== false && script.disabled !== true && script.data?.enabled !== false,
      execution: mode === 'dream-sike-dsh' ? '由 Agent 模式接管；旧预设脚本不启动' : '兼容脚本，是否成功运行需查看执行记录'
    }))
  }
}

// Edit a game's immutable preset copy. Never mutate the library or defaults.
export function updateConversationPresetSettings(snapshot, changes, expectedDigest, mode = 'tavern') {
  if (!snapshot || snapshot.digest !== expectedDigest) throw new Error('本局预设已变化，请刷新设置后重试')
  let sourcePatch = null
  if (changes?.sourceAction !== undefined) {
    if ((changes.entries?.length || changes.regexScripts?.length)) throw new Error('原设置选项不能与高级编辑同时保存')
    sourcePatch = applyDreamSikeSourceAction(snapshot, changes.sourceAction, mode)
    changes = { entries: sourcePatch.entries || [], regexScripts: [] }
  }
  if (!changes || !Array.isArray(changes.entries) || !Array.isArray(changes.regexScripts)
    || changes.entries.length > 300 || changes.regexScripts.length > 300) throw new Error('预设设置格式无效')
  const next = structuredClone(snapshot)
  if (sourcePatch?.macroOverrides) next.sourceMacroOverrides = {
    local: { ...snapshot.sourceMacroOverrides?.local, ...sourcePatch.macroOverrides.local },
    global: { ...snapshot.sourceMacroOverrides?.global, ...sourcePatch.macroOverrides.global }
  }
  const current = conversationPresetSettings(snapshot, mode)
  const activeRegexes = new Set(current.regexScripts.filter(script => script.enabled).map(script => script.key))
  const regexes = regexCatalog(snapshot).map(script => ({ ...script, enabled: activeRegexes.has(script.regexKey) }))
  for (const kind of ['entries', 'regexScripts']) {
    const known = new Map(current[kind].map(item => [item.key, item]))
    const seen = new Set()
    for (const change of changes[kind]) {
      if (!change || !known.has(change.key) || seen.has(change.key) || typeof change.enabled !== 'boolean') throw new Error('预设设置包含未知或重复项目')
      if (change.content !== undefined && (kind !== 'entries' || typeof change.content !== 'string' || change.content.length > 100000)) throw new Error('提示内容格式无效')
      if (change.content !== undefined && known.get(change.key).editableContent === false && change.content !== known.get(change.key).content) throw new Error('该执行协议由 Agent 适配，请使用预设库维护')
      seen.add(change.key)
      if (kind === 'entries') {
        const entry = next.compatibilityPreset.entries.find(entry => entry.entryKey === change.key)
        entry.enabled = change.enabled
        if (change.content !== undefined) entry.content = change.content
        // Keep the per-game source copy coherent for the original group resolver.
        // The resource library and other games are never written here.
        const raw = next.compatibilityPresetDocument?.prompts?.[entry.sourcePromptIndex]
        if (raw && raw.identifier === entry.identifier) {
          raw.enabled = entry.enabled
          if (change.content !== undefined) raw.content = entry.content
        }
        const order = next.compatibilityPresetDocument?.prompt_order?.[entry.sourceOrderGroupIndex]?.order?.[entry.sourceOrderItemIndex]
        if (order && order.identifier === entry.identifier) order.enabled = entry.enabled
      } else {
        const script = regexes.find(script => script.regexKey === change.key)
        script.enabled = change.enabled
      }
    }
  }
  for (const phase of phases) {
    const entries = orderedEntries(next).filter(item => item.phase === phase && item.entry && item.entry.enabled !== false
      && item.entry.marker !== true && item.entry.injectable === true).map(({ entry }) => ({
        id: entry.entryKey, name: entry.name, role: entry.role, content: entry.content,
        source: { path: next.presetPath, entryKey: entry.entryKey, identifier: entry.identifier, name: entry.name }
      }))
    next[phase] = { entries, text: entries.map(entry => entry.content).join('\n\n') }
  }
  next.text = phases.map(phase => next[phase].text).filter(Boolean).join('\n\n')
  // Keep runtime-specific regex fields from the original working copy.
  const working = new Map((snapshot.regexScripts || []).map(script => [script.regexKey || script.id, script]))
  next.regexScripts = regexes.filter(script => script.enabled !== false && script.findRegex)
    .map(script => ({ ...(working.get(script.regexKey || script.id) || script), enabled: true }))
  next.sources = phases.flatMap(phase => next[phase].entries.map(entry => ({ phase, ...entry.source })))
  next.regexSources = next.regexScripts.map(script => ({ path: next.presetPath, regexKey: script.regexKey, id: script.id, name: script.name }))
  delete next.agentContract
  next.digest = createHash('sha256').update(JSON.stringify({ front: next.front, middle: next.middle, back: next.back,
    regexScripts: next.regexScripts, compatibilityPreset: next.compatibilityPreset, compatibilityPresetDocument: next.compatibilityPresetDocument,
    sourceMacroOverrides: next.sourceMacroOverrides })).digest('hex')
  return next
}
