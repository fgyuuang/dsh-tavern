import { assistantResultForTurn } from '../domain/session-turn-result.js'
import { inputEventForTurn } from '../domain/session-turn-input.js'
import { roundAnchor } from '../domain/round-anchor.js'
import { inputAttachments } from '../domain/player-input-content.js'
import { prependSystemInstruction } from '../domain/system-append.js'
import { sessionStablePrefixSections, withCurrentWorldbook } from '../domain/session-stable-prefix.js'
import { synchronizeBodyEdits } from '../domain/body-editor.js'
import { synchronizeTemplateHistory } from '../domain/template-history.js'
import { readDreamSikeDraft, dreamSikeTurnIdentity, readyDreamSikeDraft, submitDreamSikeDraft, finishDreamSikeDraftSubmission } from '../domain/dream-sike-draft.js'
import { randomUUID } from 'node:crypto'
import { applyDreamSikeToolPhase, dreamSikeToolPhase } from '../domain/dream-sike-tool-phase.js'
import { dreamSikeExecutionStageForPhase } from '../domain/dream-sike-execution-usage.js'
import { isSingleReplyMode, isWritingAgentExecution } from '../domain/generation-mode.js'
import { collectInterruptedReplies, singleReplyText } from '../domain/interrupted-reply.js'

export function registerTurnLifecycleHooks({
  reconcileWhenIdle,
  backgroundAgentRunner,
  chatForSession,
  hookChatForSession,
  clearRuntimePresetRequestState,
  contentText,
  ctx,
  executionUsageForChat,
  ensureNativeSystemPrefix,
  foregroundHandoff,
  foregroundStrategies,
  fullTemplateRuntime,
  nativeWorldBookTemplateContext,
  persistClearedBodyEdits,
  pluginPromptSections,
  publishResourceWorkspace,
  readChatCard,
  replaceAssistantReply,
  requestIdForTurn,
  requestCoordinates,
  runtimePrompt,
  sessionStore,
  turnOrchestrator,
  userMessageForTurn,
  updateChat,
}) {
  const incompleteStops = new WeakMap()
  ctx.on('agent/turn-stopping', async function (payload) {
    const session = payload.agent && payload.agent.session
    if (session === undefined) return
    const sessionId = session.id
    const templateOwner = backgroundAgentRunner.requestContext(sessionId)?.parentSessionId || sessionId
    fullTemplateRuntime.cancel(templateOwner)
    clearRuntimePresetRequestState(payload.agent)
    if (backgroundAgentRunner.owns(sessionId)) return
    const userMessage = userMessageForTurn(session, payload.turn)
    const userText = contentText(userMessage)
    const userContent = userMessage?.content || []
    if (userText === '' && !inputAttachments(userContent).length) return
    const requestId = requestIdForTurn(session, payload.turn)
    const assistant = assistantResultForTurn(session, payload.turn)
    let chat = await chatForSession(sessionId)
    if (!chat) return
    const dreamMode = isWritingAgentExecution(chat) && ['story', 'script'].includes(chat.mode || 'story')
    let draft = dreamMode ? readDreamSikeDraft(chat) : null
    if (dreamMode && draft?.status === 'committed' && draft.turn === payload.turn
      && draft.sessionId === sessionId && draft.branchId === chat.timeline?.branchId && chat.nativeCommits?.[String(payload.turn)]) return
    if (dreamMode && updateChat) {
      const currentDraft = draft?.turn === payload.turn && draft.sessionId === sessionId
        && draft.branchId === chat.timeline?.branchId && draft.storyRevision === chat.timeline?.revision
      // Normal visible prose is a valid Agent result too. Saving it must not
      // depend on a particular tool choreography or optional review metadata.
      const body = assistant?.text?.trim() || ''
      const statusOnly = body.length < 120 && /^(?:[（(]?正文|草稿|本回合|已(?:经)?完成|完成|done|completed)/i.test(body)
        && /已(?:保存|确认|提交|完成)|由宿主|完成提示|^(?:完成|done|completed)[。.!！\s]*$/i.test(body)
      if (currentDraft || body && !statusOnly) {
        const expected = dreamSikeTurnIdentity(chat, sessionId, payload.turn)
        chat = await updateChat(chat.id, current => {
          const identity = dreamSikeTurnIdentity(current, sessionId, payload.turn)
          if (identity.operationId !== expected.operationId || identity.branchId !== expected.branchId
            || identity.storyRevision !== expected.storyRevision) throw new Error('回合或分支已变化，拒绝过期正文完成事件')
          const live = current.dreamSikeDraft
          if (live?.status === 'committed' && current.nativeCommits?.[String(payload.turn)]) return current
          const matches = live?.turn === identity.turn && live.sessionId === identity.sessionId
            && live.operationId === identity.operationId && live.branchId === identity.branchId
            && live.storyRevision === identity.storyRevision
          if (matches) {
            finishDreamSikeDraftSubmission(current, identity, live.version, undefined, Date.now(),
              { text: body && !statusOnly ? body : undefined })
          } else submitDreamSikeDraft(current, identity, { text: body })
          return current
        }, { source: 'dream-sike.complete-body', touchUpdatedAt: false }) || chat
        draft = readDreamSikeDraft(chat)
      }
    }
    let ready = draft?.status === 'ready' && draft.turn === payload.turn && draft.sessionId === sessionId
      && draft.branchId === chat.timeline?.branchId && draft.storyRevision === chat.timeline?.revision
    if (ready) {
      // A persisted ready flag may predate the current preparation or contract.
      // Validate on a detached copy; the stopping hook does not confirm a draft.
      try { readyDreamSikeDraft(structuredClone(chat), dreamSikeTurnIdentity(chat, sessionId, payload.turn), draft.version) }
      catch { ready = false }
    }
    if (dreamMode && !ready) {
      const fingerprint = JSON.stringify([draft?.version, draft?.status, draft?.checks?.version,
        draft?.checks?.issues?.map(issue => issue.code), draft?.checks?.editorial?.passed,
        chat.dreamSikePreparation?.preparedAt, chat.dreamSikePreparation?.ruleReadRanges?.length])
      const previous = incompleteStops.get(payload.agent)
      const sameTurn = previous?.turn === payload.turn
      const count = sameTurn && previous.fingerprint === fingerprint ? previous.count + 1 : 1
      // The fingerprint carries the draft version, so a turn that keeps regenerating the draft
      // resets the repeated-stop counter. Keep a per-turn total as well so churn cannot steer forever.
      const total = (sameTurn ? Number(previous.total) || Number(previous.count) || 0 : 0) + 1
      incompleteStops.set(payload.agent, { turn: payload.turn, fingerprint, count, total })
      if (count < 3 && total <= 8 && typeof payload.agent?.steer === 'function') {
        payload.agent.steer({
          id: randomUUID(), role: 'user',
          content: [{ type: 'text', text: ready
            ? '草稿已确认。请结束本回合，输出一句简短的完成提示；正式正文由酒馆从已确认草稿提交。'
            : draft?.text ? '正文已保留。只修复当前版本列明的确定性格式或协议问题，然后结束提交；使用 sike_patch_draft 局部修复，不重读、重做准备或追加六维审阅。可选优化额度不限制必要修复。'
              : '请直接完成本回合的完整可见正文，或用 sike_put_draft 保存正文。检索、Skill、准备和审阅均按需使用，不要求额外流程或完成提示。' }],
          source: { kind: 'plugin', plugin: 'dsh-tavern', form: 'dream-sike-continue' }
        })
        return
      }
      const message = ready ? '草稿已确认，但模型没有结束回复；草稿已保留，请继续处理。'
        : '梦境思客DSH连续结束回复但草稿状态没有推进；草稿已保留，可继续处理。'
      await turnOrchestrator.recordFailure({ sessionId, turn: payload.turn, requestId, code: 'dream-sike-incomplete', message })
      throw new Error(message)
    }
    incompleteStops.delete(payload.agent)
    if (!(dreamMode && ready) && (assistant === null || assistant.text === '')) {
      const reasoningOnly = assistant !== null && assistant.reasoningOnly === true
      const message = reasoningOnly
        ? '模型本轮只返回了思考过程，没有返回正文；请重新生成本轮正文。'
        : '模型本轮没有返回正文；请重新生成本轮正文。'
      await turnOrchestrator.recordFailure({
        sessionId,
        turn: payload.turn,
        requestId,
        code: reasoningOnly ? 'reasoning-only' : 'empty-response',
        message
      })
      throw new Error(message)
    }
    const saved = await foregroundHandoff.finalize({
      sessionId,
      turn: payload.turn,
      requestId,
      userText,
      userContent,
      assistantText: dreamMode ? draft.text : (isSingleReplyMode(chat)
        ? singleReplyText(chat, payload.turn, assistant?.text || '')
        : (assistant === null ? '' : assistant.text)),
      nativeAnchor: roundAnchor(payload.turn, inputEventForTurn(session, payload.turn), assistant?.event)
    })
    if (saved.reply) replaceAssistantReply(session, assistant, saved.reply.sessionText)
  })

  ctx.on('agent/error', function (payload) {
    clearRuntimePresetRequestState(payload.agent)
  })

  ctx.on('session/event', function (session, event) {
    if (!event || event.type !== 'turn/end') return
    foregroundStrategies.endTurn(session.id)
    if (backgroundAgentRunner.owns(session.id)) return
    const reason = event.data && event.data.reason ? event.data.reason.kind : ''
    if (['error', 'aborted'].includes(reason) && updateChat) {
      void chatForSession(session.id).then(chat => chat && updateChat(chat.id,
        current => collectInterruptedReplies(current, session, event.data.turn), { source: 'foreground.preserve-interrupted' }))
        .catch(error => console.error('dsh-tavern: 保留中断正文失败', String(error?.message || error)))
    }
    foregroundHandoff.end({ sessionId: session.id, turn: event.data && event.data.turn, reason })
    // A turn whose record went missing (#196) is adopted before the player's next
    // message, once the agent has gone idle; reconcile never blocks this hook.
    setTimeout(() => { void reconcileWhenIdle?.(session.id) }, 0)
  })

  ctx.on('system-prompt/assemble', async function (_assembly, context, next) {
    const assembly = await next()
    const agent = context && context.agent
    if (agent === undefined || agent.session === undefined) return assembly
    if (backgroundAgentRunner.owns(agent.session.id)) return assembly
    const chat = await hookChatForSession(agent.session.id)
    if (!chat) {
      // Native project Agents keep their own persona, instructions and tool set.
      assembly.tools = assembly.tools.filter(tool => !/^(?:tavern_|sike_)/.test(tool.name) && !['worldbook_search', 'character_design_finish'].includes(tool.name))
      return assembly
    }
    if (isSingleReplyMode(chat)) {
      return foregroundStrategies.assembleSystemPrompt(assembly, { sessionId: agent.session.id, chat })
    }
    if (chat) await synchronizeTemplateHistory(agent.session, chat, session => sessionStore.flush(session))
    if (chat) await synchronizeBodyEdits(agent.session, chat, session => sessionStore.flush(session), persistClearedBodyEdits)
    if (chat && chat.requestMode !== 'sillytavern' && ['story', 'script', 'card'].includes(await turnOrchestrator.modeFor(agent.session.id))) {
      await ensureNativeSystemPrefix(agent.session, chat)
    }
    let workspaceProjection = null
    try { workspaceProjection = await publishResourceWorkspace(agent.session.id, chat) }
    catch { console.error('dsh-tavern: 资源工作区投影刷新失败，继续使用现有资源文件') }
    const assembled = await foregroundStrategies.assembleSystemPrompt(assembly, {
      sessionId: agent.session.id,
      chat,
      cwd: agent.session.header && agent.session.header.cwd,
      workspaceProjection,
      fixedSystemSections: chat && ['story', 'script'].includes(chat.mode || 'story')
        ? withCurrentWorldbook(sessionStablePrefixSections(agent.session), (await nativeWorldBookTemplateContext(chat, await readChatCard(chat))).prefixContext ?? '')
        : sessionStablePrefixSections(agent.session)
    })
    // Third-party plugin sections join the play prompt only, after Tavern's own.
    if (pluginPromptSections && chat && chat.requestMode !== 'sillytavern' && ['story', 'script'].includes(await turnOrchestrator.modeFor(agent.session.id))) {
      const extra = await pluginPromptSections({ gameId: agent.session.id })
      if (extra.length) assembled.sections = [...(assembled.sections || []), ...extra]
    }
    const turn = Number(agent.phase?.turn)
    let phase = dreamSikeToolPhase(chat, agent.session.id, turn)
    if (phase && chat?.id) {
      const usage = await executionUsageForChat?.(chat.id, phase.context.executionRootOperationId, phase.context.branchId)
      phase = dreamSikeToolPhase(chat, agent.session.id, turn, usage)
      requestCoordinates.set(agent.session.id, Object.assign({}, requestCoordinates.get(agent.session.id), {
        turn, step: Number(agent.phase?.step) || 0,
        executionStage: dreamSikeExecutionStageForPhase(phase),
        operationId: phase.context.operationId,
        rootOperationId: phase.context.executionRootOperationId,
        rootTurn: phase.context.executionRootTurn,
        branchId: phase.context.branchId,
        allowExecutionPolicyUpdate: phase.context.executionResumed === true,
        executionPolicy: chat.dreamSikeExecutionPolicy
      }))
    }
    return prependSystemInstruction(applyDreamSikeToolPhase(assembled, phase), chat ? runtimePrompt('system-append') : '')
  })
}
