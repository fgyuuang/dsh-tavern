import { synchronizeBodyEdits } from '../domain/body-editor.js'
import { randomUUID } from 'node:crypto'
import { lastRoundVariableChanges } from '../domain/foreground-variable-changes.js'
import { synchronizeTemplateHistory } from '../domain/template-history.js'
import { gameMemoryEnabled } from '../domain/game-memory-task.js'

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
  ctx.on('agent/request', async function (payload, next) {
    const sessionId = payload.agent && payload.agent.session ? payload.agent.session.id : ''
    if (sessionId !== '') requestCoordinates.set(sessionId, { turn: payload.turn, step: payload.step })
    if (sessionId !== '' && Number(payload.step) > 12 && !backgroundAgentRunner.owns(sessionId)) {
      const chat = await chatForSession(sessionId)
      if (chat?.playPresetId === 'dream-sike-dsh' && ['story', 'script'].includes(chat.mode || 'story')) {
        throw new Error('梦境思客DSH本回合已达到 12 个模型执行步骤，草稿已保留')
      }
    }
    return await next()
  })

  ctx.on('agent/request-error', tavernRetryLimiter.handle, { prepend: true })

  ctx.on('agent/pre-step', async function (payload, next) {
    const sessionId = payload.agent && payload.agent.session ? payload.agent.session.id : ''
    if (backgroundAgentRunner.owns(sessionId)) return next()
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const chat = await chatForSession(sessionId)
    if (chat) await synchronizeTemplateHistory(payload.agent.session, chat, session => sessionStore.flush(session))
    if (chat) await synchronizeBodyEdits(payload.agent.session, chat, session => sessionStore.flush(session), persistClearedBodyEdits)
    const prepared = await foregroundStrategies.prepareStep({
      sessionId,
      payload,
      decision,
      chat,
      requestId: requestIdForMessages(payload.messages)
    })
    const withVariables = appendVariableChanges({ chat, payload, decision: prepared })
    const withChanges = await appendGameMemory({ chat, payload, decision: withVariables, workspace: gameMemory })
    try { return await cardMemory.appendRecall({ chat, payload, decision: withChanges }) }
    catch (error) { console.warn('[Tavern card memory] recall unavailable:', error.message); return withChanges }
  })
}
