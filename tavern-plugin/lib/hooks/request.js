import { compatibleReasoningConfig } from '../domain/model-reasoning-compatibility.js'
import { synchronizeBodyEdits } from '../domain/body-editor.js'
import { randomUUID } from 'node:crypto'
import { lastRoundVariableChanges } from '../domain/foreground-variable-changes.js'
import { synchronizeTemplateHistory } from '../domain/template-history.js'
import { gameMemoryEnabled } from '../domain/game-memory-task.js'
import { createDreamSikeLoopGuard } from '../domain/dream-sike-loop-guard.js'
import { isSingleReplyMode } from '../domain/generation-mode.js'

// Appended once at the start of a reply, so it joins the history after the cached prefix.
export function appendVariableChanges({ chat, payload, decision }) {
  if (!chat || decision.kind !== 'enter' || Number(payload.step) !== 1 || chat.backgroundTasks?.variableFeedback === false) return decision
  if (decision.messages.some(message => message.source?.form === 'variable-changes')) return decision
  const text = lastRoundVariableChanges(chat)
  if (!text) return decision
  return { ...decision, messages: [...decision.messages, { id: randomUUID(), role: 'user', content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: 'dsh-tavern', form: 'variable-changes' } }] }
}

export async function appendGameMemory({ chat, payload, decision, workspace }) {
  if (!workspace || !gameMemoryEnabled(chat) || decision.kind !== 'enter' || Number(payload.step) !== 1) return decision
  if (decision.messages.some(message => message.source?.form === 'game-memory')) return decision
  const files = await workspace.list(chat, { limit: 20 })
  const text = [
    '【本局记忆工作区】',
    '这里保存当前分支的长期资料。需要时调用 tavern_memory 搜索或读取具体文档，尤其是当前场景、未完成线索、相关人物记忆；压缩后可重新读取。正文确认后后台 Agent 会维护文档。',
    '记忆须与原文及当前变量核对；人物核心设定和世界规则以本局绑定资料为准。',
    JSON.stringify({ branchId: chat.timeline?.branchId, revision: chat.timeline?.revision, ...files })
  ].join('\n')
  return { ...decision, messages: [...decision.messages, { id: randomUUID(), role: 'user', content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: 'dsh-tavern', form: 'game-memory', trace: { turn: Number(payload.turn) || 0 } } }] }
}

export function registerRequestHooks({
  backgroundAgentRunner,
  cardMemory,
  chatForSession,
  ctx,
  foregroundStrategies,
  gameMemory,
  persistClearedBodyEdits,
  requestCoordinates,
  requestIdForMessages,
  sessionStore,
  tavernRetryLimiter,
}) {
  const checkDreamSikeProgress = createDreamSikeLoopGuard()
  // Run after downstream model selection, before the native prepareCall validates it.
  ctx.on('agent/request', async function (payload, next) {
    const config = await next()
    if (config?.reasoningEffort === undefined) return config
    const sessionId = payload.agent?.session?.id || ''
    if (!sessionId || (!backgroundAgentRunner.owns(sessionId) && !await chatForSession(sessionId))) return config
    return await compatibleReasoningConfig(ctx.llm, config, payload.signal)
  }, { prepend: true })

  ctx.on('agent/request', async function (payload, next) {
    const sessionId = payload.agent && payload.agent.session ? payload.agent.session.id : ''
    if (sessionId !== '') {
      const previous = requestCoordinates.get(sessionId)
      const frame = previous?.frame && (previous.framePending === true || previous.turn === payload.turn) ? previous.frame : undefined
      const sameStep = previous?.turn === payload.turn && previous?.step === payload.step
      const background = backgroundAgentRunner.requestContext(sessionId)
      const preserved = { ...(previous || {}) }
      delete preserved.source
      if (!frame) { delete preserved.frame; delete preserved.framePending }
      requestCoordinates.set(sessionId, {
        ...preserved, turn: payload.turn, step: payload.step,
        attemptId: randomUUID(), attemptOrdinal: sameStep ? (Number(previous?.attemptOrdinal) || 1) + 1 : 1,
        ...(frame ? { frame } : {}),
        ...(background ? {
          executionStage: background.stage,
          rootTurn: background.rootTurn,
          rootOperationId: background.rootOperationId,
          branchId: background.branchId
        } : {})
      })
    }
    return await next()
  })

  ctx.on('agent/request-error', tavernRetryLimiter.handle, { prepend: true })

  ctx.on('agent/pre-step', async function (payload, next) {
    const sessionId = payload.agent && payload.agent.session ? payload.agent.session.id : ''
    // Tavern drives only top-level sessions; child agents (its own background
    // agents, plugin agents, DSH subagents) never get a turn frame or status.
    if (backgroundAgentRunner.owns(sessionId) || payload.agent.session.header?.parentSession) return next()
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const chat = await chatForSession(sessionId)
    checkDreamSikeProgress(payload, chat)
    if (chat) await synchronizeTemplateHistory(payload.agent.session, chat, session => sessionStore.flush(session))
    if (chat) await synchronizeBodyEdits(payload.agent.session, chat, session => sessionStore.flush(session), persistClearedBodyEdits)
    const prepared = await foregroundStrategies.prepareStep({
      sessionId,
      payload,
      decision,
      chat,
      requestId: requestIdForMessages(payload.messages)
    })
    if (isSingleReplyMode(chat)) return prepared
    const withVariables = appendVariableChanges({ chat, payload, decision: prepared })
    const withChanges = await appendGameMemory({ chat, payload, decision: withVariables, workspace: gameMemory })
    try { return await cardMemory.appendRecall({ chat, payload, decision: withChanges }) }
    catch (error) { console.warn('[Tavern card memory] recall unavailable:', error.message); return withChanges }
  })
}
