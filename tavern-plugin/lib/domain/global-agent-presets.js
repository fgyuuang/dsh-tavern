import { normalizePlayPresetId } from './dream-sike-mode.js'
import { normalizeGenerationMode } from './generation-mode.js'
import { normalizeDreamSikeExecutionPolicy } from './dream-sike-execution-policy.js'

export function globalAgentPresetDefaults(document, presetId) {
  if (normalizePlayPresetId(presetId) !== presetId) throw new Error('未知的酒馆 Agent 预设')
  const value = document?.globalAgentPresets?.[presetId]
  return value ? structuredClone(value) : { revision: 0, generationMode: 'agent', snapshot: null }
}

// Called with a server-owned author snapshot; never accepts raw snapshot data from RPC.
export function saveGlobalAgentPresetDefaults(document, presetId, value, expectedRevision) {
  const previous = globalAgentPresetDefaults(document, presetId)
  if (previous.revision !== expectedRevision) throw new Error('全局预设已在其他页面修改，请重新载入后重试')
  if (!['agent', 'sillytavern-once'].includes(value.generationMode)) throw new Error('回复方式无效')
  return { ...document, globalAgentPresets: { ...document?.globalAgentPresets, [presetId]: {
    revision: previous.revision + 1, generationMode: normalizeGenerationMode(value.generationMode),
    executionPolicy: normalizeDreamSikeExecutionPolicy(value.executionPolicy), snapshot: structuredClone(value.snapshot)
  } } }
}
