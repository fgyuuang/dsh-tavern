export const AGENT_GENERATION_MODE = 'agent'
export const SINGLE_REPLY_GENERATION_MODE = 'sillytavern-once'

/** Reply execution is independent of the selected author's preset and settings. */
export function normalizeGenerationMode(value) {
  return value === SINGLE_REPLY_GENERATION_MODE ? SINGLE_REPLY_GENERATION_MODE : AGENT_GENERATION_MODE
}

export function isSingleReplyMode(chat) {
  return chat?.generationMode === SINGLE_REPLY_GENERATION_MODE && ['story', 'script'].includes(chat.mode || 'story')
}

export function isDreamSikeAgentExecution(chat) {
  return chat?.playPresetId === 'dream-sike-dsh' && !isSingleReplyMode(chat)
    && ['story', 'script'].includes(chat.mode || 'story')
}

/** Both authors share the draft engine while retaining independent rule compilers. */
export function isWritingAgentExecution(chat) {
  return ['dream-sike-dsh', 'hushen-dsh'].includes(chat?.playPresetId) && !isSingleReplyMode(chat)
    && ['story', 'script'].includes(chat.mode || 'story')
}
/** Return an atomic patch; changing execution never replaces the source preset. */
export function selectGenerationMode(chat, value, readiness = {}) {
  if (value !== AGENT_GENERATION_MODE && value !== SINGLE_REPLY_GENERATION_MODE) throw new Error('未知的回复方式')
  if (!chat || !['story', 'script'].includes(chat.mode || 'story')) throw new Error('只有游玩中的游戏可以切换回复方式')
  if (readiness.foregroundIdle !== true || readiness.backgroundIdle !== true || readiness.replayIdle === false) {
    throw new Error('请等待当前正文和后台任务完成后再切换回复方式')
  }
  const previousGenerationMode = normalizeGenerationMode(chat.generationMode)
  const changed = previousGenerationMode !== value
  return {
    changed,
    generationMode: value,
    previousGenerationMode,
    expectedChatId: chat.id,
    expectedStorageRevision: chat._storageRevision,
    patch: changed ? {
      generationMode: value,
      playPresetSettingsIndependent: true,
      generationModeRevision: (Number.isSafeInteger(chat.generationModeRevision) ? chat.generationModeRevision : 0) + 1,
      tavernHelperLifecycleRevision: (Number.isSafeInteger(chat.tavernHelperLifecycleRevision) ? chat.tavernHelperLifecycleRevision : 0) + 1,
      ...(chat.dreamSikeResume ? { dreamSikeResume: null } : {})
    } : {}
  }
}
