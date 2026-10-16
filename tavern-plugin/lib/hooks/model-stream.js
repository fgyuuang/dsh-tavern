import { projectWithoutSessionSeedTrajectory } from '../domain/session-seed-trajectory.js'
import { compatibleReasoningConfig } from '../domain/model-reasoning-compatibility.js'
import { createImportContextPreparation, needsImportContextPreparation } from '../domain/import-context-preparation.js'
import { createStoryCompactionRequest, nativelyRetainedRounds, retainRecentStoryRounds, usesStoryCompaction } from '../domain/story-compaction.js'
import { installCompactionRequestProjection } from '../domain/compaction-request.js'
import { installWorkspaceInstructionPresentation } from '../domain/workspace-instruction-presentation.js'
import { presentModelError } from '../domain/model-error-presentation.js'
import { markRequestAttempt, markRequestHandled, requestAttemptOf, requestHandledBy } from '../domain/request-lineage.js'
import { randomUUID } from 'node:crypto'
import { isSingleReplyMode, isWritingAgentExecution } from '../domain/generation-mode.js'
import { boundedReplyStream } from '../domain/bounded-reply-stream.js'


export function registerModelStreamHooks({
  agentRegistry,
  backgroundAgentRunner,
  chatForSession,
  chatHeaderForSession,
  ctx,
  foregroundStrategies,
  fullTemplateRuntime,
  modelRequestLog,
  pluginCompactionNotes,
  pluginSettlementProgress,
  requestCoordinates,
  storyRetention,
  runtimePrompt,
  sessionStateForSession,
  sessionStore,
  str,
  updateChat,
  worldbookRecallLog,
}) {
  const importContextPreparation = createImportContextPreparation({
    readChat: chatForSession, readHeader: chatHeaderForSession, updateChat,
    getSession: id => sessionStore.get(id) || agentRegistry.get(id)?.session,
    flush: session => sessionStore.flush(session),
    modelInfo: request => ctx.llm.resolveModelInfo(request.provider, request.model, request.signal),
    estimateMessage: message => {
      const meter = ctx.get('tokenMeter')
      if (!meter?.estimateMessage) throw new Error('当前宿主缺少原生 token 计量接口，请更新 DSH 后重试')
      const native = meter.estimateMessage(message)
      // The host's fixed four-characters/token estimate underprices CJK text.
      // Use a conservative Unicode floor for this one-time admission check.
      const text = (message.content || []).map(block => block.text || JSON.stringify(block)).join('')
      const nonAscii = [...text].filter(char => char.codePointAt(0) > 127).length
      return Math.max(native, Math.ceil((text.length - nonAscii) / 4) + nonAscii * 2 + 8)
    }
  })
  installWorkspaceInstructionPresentation(ctx, async sessionId => {
    if (backgroundAgentRunner.owns(sessionId)) return true
    const chat = await sessionStateForSession(sessionId)
    return Boolean(chat)
  })
  installCompactionRequestProjection(ctx, async sessionId => backgroundAgentRunner.owns(sessionId) || Boolean(await sessionStateForSession(sessionId)), async request => {
    // Story/script chats summarize with the story prompt and keep the latest rounds
    // verbatim after the summary; other sessions keep DSH's prompt.
    const chat = await chatForSession(str(request.sessionId))
    if (!usesStoryCompaction(chat)) return { request }
    if (needsImportContextPreparation(chat)) throw new Error('导入对话尚未完成首次上下文容量检查，暂不调用摘要模型')
    if (isWritingAgentExecution(chat)) {
      const messages = projectWithoutSessionSeedTrajectory(request.messages)
      if (messages !== request.messages) request = { ...request, messages }
    }
    // Seam to the plugin layer: plugins may add what the summary must keep.
    const notes = pluginCompactionNotes ? await pluginCompactionNotes({ gameId: str(request.sessionId) }).catch(() => []) : []
    const instruction = [runtimePrompt('story-compaction'), ...(notes.length ? ['【插件附加的摘要要求】', ...notes.map(note => note.text)] : [])].join('\n\n')
    const story = createStoryCompactionRequest(request, instruction)
    const session = sessionStore.get(story.sessionId) || agentRegistry.get(story.sessionId)?.session
    const retention = await storyRetention(story)
    return retainRecentStoryRounds(story, retention.rounds - nativelyRetainedRounds(session, story), retention)
  })

  async function gameChildSession(sessionId) {
    const parentSessionId = str((sessionStore.get(sessionId) || agentRegistry.get(sessionId)?.session)?.header?.parentSession)
    if (!parentSessionId || parentSessionId === sessionId || backgroundAgentRunner.owns(parentSessionId)) return null
    const chat = await chatHeaderForSession(parentSessionId, ['requestMode', 'compatibilityTraces', 'bypassPlanId', 'runtimePresetSnapshot'])
    if (!chat || !['story', 'script'].includes(chat.mode)) return null
    // The request carries no turn; file it under the game's latest turn so old bodies are pruned with the rest.
    const turn = (await modelRequestLog.list(chat.id)).reduce((latest, entry) => Math.max(latest, Number(entry.turn) || 0), 0)
    return { chat, context: { scope: 'background', task: 'subagent', parentSessionId, turn } }
  }
  ctx.on('llm/stream', function (options, next) {
    const sessionId = str(options && options.sessionId)
    const coordinates = requestCoordinates.get(sessionId)
    const inheritedAttempt = requestAttemptOf(options)
    const attempt = inheritedAttempt || {
      // A purpose-tagged call (notably compaction) is a separate provider attempt,
      // even when it reuses the session's most recent foreground coordinates.
      id: options?.purpose ? randomUUID() : str(coordinates?.attemptId) || randomUUID(),
      turn: Number(coordinates?.turn) || 0,
      step: Number(coordinates?.step) || 0,
      attemptOrdinal: Number(coordinates?.attemptOrdinal) || 1,
      executionStage: str(coordinates?.executionStage),
      rootTurn: Number(coordinates?.rootTurn ?? coordinates?.turn) || 0,
      rootOperationId: str(coordinates?.rootOperationId),
      branchId: str(coordinates?.branchId),
      operationId: str(coordinates?.operationId),
      allowExecutionPolicyUpdate: coordinates?.allowExecutionPolicyUpdate === true
    }
    if (!inheritedAttempt) options = markRequestAttempt(options, attempt)
    if (coordinates !== undefined) {
      requestCoordinates.set(sessionId, Object.assign({}, coordinates, {
        source: { kind: 'model', provider: str(options.provider), model: str(options.model) }
      }))
    }
    const projectedRequest = (requestHandledBy(options, 'full-template') || importContextPreparation.isPrepared(options)) ? null : foregroundStrategies.projectRequest(options, coordinates)
    if (projectedRequest !== null) return ctx.llm.stream(markRequestAttempt(projectedRequest, attempt))
    const backgroundContext = backgroundAgentRunner.requestContext(sessionId)
    const ownerSessionId = backgroundContext ? backgroundContext.parentSessionId : sessionId
    return (async function * () {
      const prepared = await importContextPreparation.prepare(options)
      if (prepared !== options) { yield * ctx.llm.stream(markRequestAttempt(prepared, attempt)); return }
      const chat = ownerSessionId === '' ? undefined : await chatHeaderForSession(ownerSessionId, [
        'requestMode', 'compatibilityTraces', 'bypassPlanId', 'runtimePresetSnapshot', 'foregroundFrames',
        'playPresetId', 'dreamSikeExecutionPolicy', 'generationMode'
      ])
      if (isSingleReplyMode(chat) && !backgroundContext && options.purpose === undefined
        && !requestHandledBy(options, 'bounded-single-reply')) {
        yield * boundedReplyStream(signal => ctx.llm.stream(markRequestHandled({ ...options, signal }, 'bounded-single-reply')), options.signal)
        return
      }
      // Apply the same seed projection to writing and maintenance requests. Re-entry
      // preserves the attempt identity and counts only the final provider dispatch.
      if (isWritingAgentExecution(chat)) {
        const messages = projectWithoutSessionSeedTrajectory(options.messages)
        if (messages !== options.messages) {
          yield * ctx.llm.stream(markRequestAttempt({ ...options, messages }, attempt))
          return
        }
      }
      if (chat && !isSingleReplyMode(chat) && ['story', 'script'].includes(chat.mode) && options.purpose === undefined && chat.requestMode !== 'sillytavern' && !requestHandledBy(options, 'full-template')) {
        const projected = await fullTemplateRuntime.forSession(ownerSessionId).projectRequestProjection({ messages: options.messages, system: options.system, model: options.model })
        yield * ctx.llm.stream(markRequestAttempt(markRequestHandled({ ...options, ...projected }, 'full-template'), attempt))
        return
      }
      // ST sampling options are merged by projectRequest AFTER agent/request.
      // Validate the final projected envelope, before logging/counting/dispatch.
      if (chat || backgroundContext) {
        const compatible = await compatibleReasoningConfig(ctx.llm, options, options.signal)
        if (compatible !== options) { yield * ctx.llm.stream(markRequestAttempt(compatible, attempt)); return }
      }
      const coordinates = requestCoordinates.get(sessionId) || {}
      const purpose = str(options.purpose)
      const plannedStage = str(backgroundContext?.stage || attempt.executionStage || coordinates.executionStage)
      let stage = purpose ? (/compact/i.test(purpose) ? 'compaction' : 'maintenance') : plannedStage
      const rootOperationId = str(backgroundContext?.rootOperationId || attempt.rootOperationId || coordinates.rootOperationId)
      const branchId = str(backgroundContext?.branchId || attempt.branchId || coordinates.branchId)
      const rootTurn = Number(backgroundContext?.rootTurn ?? attempt.rootTurn ?? coordinates.rootTurn ?? coordinates.turn) || 0
      let executionReservation = null
      if (isWritingAgentExecution(chat) && rootOperationId && stage) {
        executionReservation = await modelRequestLog.reserveExecutionAttempt({
          chatId: chat.id, attemptId: attempt.id, rootOperationId, branchId, rootTurn,
          turn: Number(coordinates.turn ?? attempt.turn) || 0, step: Number(coordinates.step ?? attempt.step) || 0,
          operationId: str(coordinates.operationId || attempt.operationId),
          allowPolicyUpdate: !backgroundContext && (coordinates.allowExecutionPolicyUpdate === true || attempt.allowExecutionPolicyUpdate === true),
          allowBodyCompletion: !backgroundContext && !purpose,
          stage, purpose, provider: str(options.provider), model: str(options.model), policy: chat.dreamSikeExecutionPolicy
        })
        if (executionReservation?.accepted && executionReservation.stage) stage = executionReservation.stage
        if (executionReservation?.accepted === false) {
          const error = new Error('剧情 Agent ' + ({ query: '写前查询', initial: '正文初稿', revision: '正文修订', addons: '后续附加内容' }[stage] || stage)
            + '请求额度已用完，当前成果已保留；调整对应额度后可继续。')
          error.code = 'DREAM_SIKE_REQUEST_LIMIT'
          error.stage = stage
          error.used = executionReservation.used
          error.limit = executionReservation.limit
          throw error
        }
      }
      let requestRecord = null
      // Agents a plugin creates under a game are not Tavern's own sessions; log them
      // as that game's background requests so 完整上下文 can show them.
      const child = options.purpose === undefined && !backgroundContext && !chat ? await gameChildSession(sessionId) : null
      if (child) requestRecord = await modelRequestLog.record({ chat: child.chat, context: child.context, coordinates: {}, options })
      else if (chat !== undefined && ['story', 'script', 'card'].includes(chat.mode)
        && (options.purpose === undefined || isWritingAgentExecution(chat) || Boolean(backgroundContext))) {
        const auditCoordinates = { ...coordinates, executionStage: stage, rootOperationId, branchId, rootTurn,
          operationId: str(coordinates.operationId || attempt.operationId), attemptId: attempt.id }
        try {
          requestRecord = await modelRequestLog.record({ chat, context: backgroundContext, coordinates: auditCoordinates,
            options, attemptId: attempt.id, stage, rootOperationId, branchId, purpose })
        } catch (error) {
          console.warn('dsh-tavern: 模型请求详细日志写入失败，继续请求并保留额度台账', str(error && error.message || error))
        }
        if (requestRecord && !backgroundContext && options.purpose === undefined && ['story', 'script'].includes(chat.mode)) {
          // Evidence only: scanning a multi-MB request must not delay the first token.
          worldbookRecallLog.requested(chat, options, requestRecord.id, coordinates.frame)
            .catch(error => console.warn('dsh-tavern: 世界书请求日志关联失败', String(error?.message || error)))
        }
      }
      const progress = child ? event => pluginSettlementProgress?.model(child.context.parentSessionId, event) : () => {}
      progress('start')
      let responseText = ''
      let finish = null
      let failure = null
      let usage = null
      try {
        if (isWritingAgentExecution(chat) && !backgroundContext && options.purpose === undefined) {
          requestCoordinates.set(sessionId, { ...requestCoordinates.get(sessionId), authorRuleDelivery: foregroundStrategies.authorRuleDelivery?.(options) || null })
        }
        const stream = next()
        for await (const chunk of stream) {
          if (chunk && chunk.type === 'text-delta') responseText += str(chunk.text)
          if (chunk && chunk.type === 'usage') usage = chunk.usage
          if (chunk && ['text-delta', 'reasoning-delta', 'tool-call-delta'].includes(chunk.type)) progress('output')
          if (chunk && chunk.type === 'finish') finish = chunk.reason === undefined ? chunk : chunk.reason
          yield chunk
        }
      } catch (error) {
        const displayedError = chat ? presentModelError(error) : error
        failure = str(displayedError && displayedError.message || displayedError)
        throw displayedError
      } finally {
        progress('end')
        const aborted = Boolean(options.signal?.aborted) || finish?.kind === 'aborted'
        const completed = !failure && !aborted && finish?.kind !== 'error'
        foregroundStrategies.completeRequest(options, completed)
        if (executionReservation?.tracked && executionReservation.accepted) {
          const status = aborted ? 'aborted' : failure || finish?.kind === 'error' ? 'failed' : 'completed'
          try { await modelRequestLog.completeExecutionAttempt({ chatId: chat.id, rootOperationId, attemptId: attempt.id,
            branchId, status, usage, error: failure }) }
          catch (error) { console.error('dsh-tavern: 梦境思客调用台账写入失败', str(error && error.message || error)) }
        }
        const owner = child ? child.chat : chat
        if (owner && requestRecord) {
          try { await modelRequestLog.complete({ chatId: owner.id, id: requestRecord.id, text: responseText, finish, error: failure, usage }) }
          catch (error) { console.error('dsh-tavern: 模型结果日志写入失败', str(error && error.message || error)) }
        }
      }
    })()
  }, { global: true })
}
