import { createImportContextPreparation, needsImportContextPreparation } from '../domain/import-context-preparation.js'
import { createStoryCompactionRequest, nativelyRetainedRounds, retainRecentStoryRounds, usesStoryCompaction } from '../domain/story-compaction.js'
import { installCompactionRequestProjection } from '../domain/compaction-request.js'
import { installWorkspaceInstructionPresentation } from '../domain/workspace-instruction-presentation.js'
import { presentModelError } from '../domain/model-error-presentation.js'
import { markRequestAttempt, markRequestHandled, requestAttemptOf, requestHandledBy } from '../domain/request-lineage.js'
import { randomUUID } from 'node:crypto'

const DREAM_SIKE_AGENT_PRESET = 'dream-sike-dsh'

export function registerModelStreamHooks({
  agentRegistry,
  backgroundAgentRunner,
  chatForSession,
  chatHeaderForSession,
  ctx,
  foregroundStrategies,
  fullTemplateRuntime,
  modelRequestLog,
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
    const story = createStoryCompactionRequest(request, runtimePrompt('story-compaction'))
    const session = sessionStore.get(story.sessionId) || agentRegistry.get(story.sessionId)?.session
    const retention = await storyRetention(story)
    return retainRecentStoryRounds(story, retention.rounds - nativelyRetainedRounds(session, story), retention)
  })

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
        'playPresetId', 'dreamSikeExecutionPolicy'
      ])
      if (chat && ['story', 'script'].includes(chat.mode) && options.purpose === undefined && chat.requestMode !== 'sillytavern' && !requestHandledBy(options, 'full-template')) {
        const projected = await fullTemplateRuntime.forSession(ownerSessionId).projectRequestProjection({ messages: options.messages, system: options.system, model: options.model })
        yield * ctx.llm.stream(markRequestAttempt(markRequestHandled({ ...options, ...projected }, 'full-template'), attempt))
        return
      }
      const coordinates = requestCoordinates.get(sessionId) || {}
      const purpose = str(options.purpose)
      const plannedStage = str(backgroundContext?.stage || attempt.executionStage || coordinates.executionStage)
      const stage = purpose ? (/compact/i.test(purpose) ? 'compaction' : 'maintenance') : plannedStage
      const rootOperationId = str(backgroundContext?.rootOperationId || attempt.rootOperationId || coordinates.rootOperationId)
      const branchId = str(backgroundContext?.branchId || attempt.branchId || coordinates.branchId)
      const rootTurn = Number(backgroundContext?.rootTurn ?? attempt.rootTurn ?? coordinates.rootTurn ?? coordinates.turn) || 0
      let executionReservation = null
      if (chat?.playPresetId === DREAM_SIKE_AGENT_PRESET && rootOperationId && stage) {
        executionReservation = await modelRequestLog.reserveExecutionAttempt({
          chatId: chat.id, attemptId: attempt.id, rootOperationId, branchId, rootTurn,
          turn: Number(coordinates.turn ?? attempt.turn) || 0, step: Number(coordinates.step ?? attempt.step) || 0,
          operationId: str(coordinates.operationId || attempt.operationId),
          allowPolicyUpdate: !backgroundContext && (coordinates.allowExecutionPolicyUpdate === true || attempt.allowExecutionPolicyUpdate === true),
          stage, purpose, provider: str(options.provider), model: str(options.model), policy: chat.dreamSikeExecutionPolicy
        })
        if (executionReservation?.accepted === false) {
          const error = new Error('梦境思客' + ({ query: '写前查询', initial: '正文初稿', revision: '正文修订', addons: '后续附加内容' }[stage] || stage)
            + '请求额度已用完，当前成果已保留；调整对应额度后可继续。')
          error.code = 'DREAM_SIKE_REQUEST_LIMIT'
          error.stage = stage
          error.used = executionReservation.used
          error.limit = executionReservation.limit
          throw error
        }
      }
      let requestRecord = null
      if (chat !== undefined && ['story', 'script', 'card'].includes(chat.mode)
        && (options.purpose === undefined || chat.playPresetId === DREAM_SIKE_AGENT_PRESET || Boolean(backgroundContext))) {
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
      let responseText = ''
      let finish = null
      let failure = null
      let usage = null
      try {
        const stream = next()
        for await (const chunk of stream) {
          if (chunk && chunk.type === 'text-delta') responseText += str(chunk.text)
          if (chunk && chunk.type === 'usage') usage = chunk.usage
          if (chunk && chunk.type === 'finish') finish = chunk.reason === undefined ? chunk : chunk.reason
          yield chunk
        }
      } catch (error) {
        const displayedError = chat ? presentModelError(error) : error
        failure = str(displayedError && displayedError.message || displayedError)
        throw displayedError
      } finally {
        const aborted = Boolean(options.signal?.aborted) || finish?.kind === 'aborted'
        const completed = !failure && !aborted && finish?.kind !== 'error'
        foregroundStrategies.completeRequest(options, completed)
        if (executionReservation?.tracked && executionReservation.accepted) {
          const status = aborted ? 'aborted' : failure || finish?.kind === 'error' ? 'failed' : 'completed'
          try { await modelRequestLog.completeExecutionAttempt({ chatId: chat.id, rootOperationId, attemptId: attempt.id,
            branchId, status, usage, error: failure }) }
          catch (error) { console.error('dsh-tavern: 梦境思客调用台账写入失败', str(error && error.message || error)) }
        }
        if (chat && requestRecord) {
          try { await modelRequestLog.complete({ chatId: chat.id, id: requestRecord.id, text: responseText, finish, error: failure, usage }) }
          catch (error) { console.error('dsh-tavern: 模型结果日志写入失败', str(error && error.message || error)) }
        }
      }
    })()
  }, { global: true })
}
