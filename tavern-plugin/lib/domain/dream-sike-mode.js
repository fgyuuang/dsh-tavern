import { createHash } from 'node:crypto'

export const BASE_PLAY_PRESET = 'tavern'
export const DREAM_SIKE_AGENT_PRESET = 'dream-sike-dsh'
export const DREAM_SIKE_AGENT_INSTRUCTION = '你是梦境思客DSH剧情 Agent。尊重人物卡、世界书、已提交历史与玩家意愿；只在当前回合内推进情节，不替玩家决定下一步。按复杂度检索与规划，使用 sike_put_draft 建立唯一正文，sike_check_draft 检查；必要时用 sike_patch_draft 局部修订，最后以 sike_ready_draft 确认。只有确认后的正文能提交。不要在正文写内部推理、变量协议或工具调用；变量由提交后的后台 Agent 结算。本局有分支独立的持久记忆文档，通过 tavern_memory 按需搜索与读取场景、人物所知和线索；压缩后可以重新读取，核心设定和当前变量仍须核对。'

const PLAY_PRESETS = new Set([BASE_PLAY_PRESET, DREAM_SIKE_AGENT_PRESET])

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function assertPlayPresetId(value) {
  if (!PLAY_PRESETS.has(value)) throw new Error('未知的酒馆 Agent 预设')
  return value
}

export function normalizePlayPresetId(value) {
  return PLAY_PRESETS.has(value) ? value : BASE_PLAY_PRESET
}

/** The imported ST preset is a separate resource, represented by runtimePresetSnapshot. */
export function listPlayPresets({ chat, settings, legacyPresetTitle } = {}) {
  const selected = normalizePlayPresetId(object(chat).playPresetId)
  const fallback = normalizePlayPresetId(object(settings).defaultPlayPresetId)
  const originalName = typeof legacyPresetTitle === 'string' && legacyPresetTitle.trim()
    ? legacyPresetTitle.trim()
    : '原酒馆预设'
  return [
    {
      id: BASE_PLAY_PRESET,
      name: originalName,
      description: '沿用本局导入的酒馆预设与原有请求流程。',
      nativeAgentPreset: BASE_PLAY_PRESET,
      selected: selected === BASE_PLAY_PRESET,
      isDefault: fallback === BASE_PLAY_PRESET
    },
    {
      id: DREAM_SIKE_AGENT_PRESET,
      name: '梦境思客DSH',
      description: '由 DSH Agent 按需检索、规划、起草、检查与修订。',
      nativeAgentPreset: DREAM_SIKE_AGENT_PRESET,
      selected: selected === DREAM_SIKE_AGENT_PRESET,
      isDefault: fallback === DREAM_SIKE_AGENT_PRESET
    }
  ]
}

/**
 * Return a patch for one atomic chat update. The caller checks its storage
 * revision, waits for both Agents to be idle and applies the patch to the same
 * chat record; a stale lifecycle token then rejects old script callbacks.
 */
export function selectPlayPreset(chat, presetId, readiness = {}) {
  const source = object(chat)
  const id = assertPlayPresetId(presetId)
  if (!['story', 'script'].includes(source.mode)) throw new Error('只有游玩中的游戏可以切换 Agent 预设')
  if (readiness.foregroundIdle !== true || readiness.backgroundIdle !== true || readiness.replayIdle === false) {
    throw new Error('请等待当前正文和后台结算完成后再切换预设')
  }
  const previousPresetId = normalizePlayPresetId(source.playPresetId)
  const changed = previousPresetId !== id
  return {
    changed,
    presetId: id,
    previousPresetId,
    expectedChatId: source.id,
    expectedStorageRevision: source._storageRevision,
    patch: changed ? {
      playPresetId: id,
      playPresetRevision: (Number.isSafeInteger(source.playPresetRevision) ? source.playPresetRevision : 0) + 1,
      tavernHelperLifecycleRevision: (Number.isSafeInteger(source.tavernHelperLifecycleRevision) ? source.tavernHelperLifecycleRevision : 0) + 1,
      ...(source.dreamSikeResume ? { dreamSikeResume: null } : {})
    } : {}
  }
}

/** New games read the setting once at creation; existing chats keep their mode. */
export function setDefaultPlayPreset(settings, presetId) {
  const id = assertPlayPresetId(presetId)
  return { defaultPlayPresetId: id }
}

const EMPTY_PHASE = Object.freeze({ entries: [], text: '' })

/** Keep the imported regex rules while excluding its legacy prompt text. */
export function projectPlayPresetSnapshot(snapshot, presetId) {
  if (normalizePlayPresetId(presetId) !== DREAM_SIKE_AGENT_PRESET || !snapshot || typeof snapshot !== 'object') return snapshot
  const regexScripts = Array.isArray(snapshot.regexScripts) ? snapshot.regexScripts : []
  const digest = createHash('sha256').update(JSON.stringify({ mode: DREAM_SIKE_AGENT_PRESET, sourceDigest: snapshot.digest || '', regexScripts })).digest('hex')
  return {
    ...snapshot,
    front: EMPTY_PHASE,
    middle: EMPTY_PHASE,
    back: EMPTY_PHASE,
    text: '',
    regexScripts,
    digest
  }
}

/** Preset-owned Tavern Helper scripts run only in the original mode. */
export function resolvePresetHelperScripts(snapshot, presetId) {
  if (normalizePlayPresetId(presetId) === DREAM_SIKE_AGENT_PRESET) return []
  const document = object(snapshot?.compatibilityPresetDocument)
  const extensions = object(document.extensions)
  const helper = object(extensions.tavern_helper)
  const presetPath = String(snapshot?.presetPath || '')
  const owner = 'preset:' + presetPath
  const namespace = createHash('sha256').update(presetPath).digest('hex').slice(0, 16)
  return (Array.isArray(helper.scripts) ? helper.scripts : [])
    .filter(script => script && typeof script === 'object' && script.type === 'script' && script.enabled !== false && script.disabled !== true)
    .map((script, index) => ({
      id: 'preset-' + namespace + '-' + String(script.id || 'helper-' + (index + 1)),
      sourceId: String(script.id || ''),
      name: String(script.name || script.id || '预设脚本 ' + (index + 1)),
      type: 'script',
      enabled: true,
      content: String(script.content || ''),
      data: object(script.data),
      buttons: Array.isArray(script.button?.buttons) ? script.button.buttons : [],
      buttonsEnabled: script.button?.enabled !== false,
      owner
    }))
}

/** The native preset and ST compatibility resources are selected independently. */
export function resolvePlayPresetRuntime(chat) {
  const source = object(chat)
  const presetId = normalizePlayPresetId(source.playPresetId)
  return {
    presetId,
    nativeAgentPreset: presetId,
    runtimePresetSnapshot: projectPlayPresetSnapshot(source.runtimePresetSnapshot, presetId),
    helperScriptPolicy: presetId === DREAM_SIKE_AGENT_PRESET ? 'card-and-agent' : 'card-and-legacy-preset',
    presetHelperScripts: resolvePresetHelperScripts(source.runtimePresetSnapshot, presetId),
    legacyPresetPath: typeof source.runtimePresetPath === 'string' ? source.runtimePresetPath : ''
  }
}
