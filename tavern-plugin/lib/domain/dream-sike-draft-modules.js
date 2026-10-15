import { createHash, randomUUID } from 'node:crypto'
import { compileDreamSikeContract, DREAM_SIKE_REVIEW_AXES } from './dream-sike-contract.js'
import { resolveRuntimePresetMacros } from './runtime-presets.js'
import { hasPrivateWritingProtocol } from './writing-private-protocol.js'

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const PARALLEL = /<dream_parallel_event\b[^>]*>[\s\S]*?<\/dream_parallel_event\s*>\n?/gi
const visibleSource = text => String(text).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<!--[\s\S]*?-->/gi, value => ' '.repeat(value.length))
const ranges = (text, pattern) => [...visibleSource(text).matchAll(pattern)]
const splice = (text, start, length, value) => text.slice(0, start) + value + text.slice(start + length)
export const DREAM_SIKE_MODULE_TOOL = Object.freeze({
  name: 'sike_submit_module', description: '提交当前独立草稿模块。parallel 提交完整 dream_parallel_event；review 提交六维审稿 JSON。只保存可观察的剧情或简短审稿依据，不输出私有推理，不提交正式正文或变量。',
  parameters: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } }, required: ['text'] }
})
export function draftModuleBase(text, kind) {
  let result = String(text)
  if (kind === 'parallel') for (const match of ranges(result, /<dream_parallel_event\b[^>]*>[\s\S]*?<\/dream_parallel_event\s*>\n?|<dream_parallel_event\s*\/>\n?/gi).reverse()) result = splice(result, match.index, match[0].length, '')
  return result
}
export function dreamSikeDraftModulePlan(chat, kind) {
  if (chat?.playPresetId !== 'dream-sike-dsh' || !['parallel', 'review'].includes(kind)) return null
  const compiled = compileDreamSikeContract(chat.runtimePresetSnapshot)
  const entries = compiled?.deferredDraft?.entries.filter(entry => entry.moduleKind === kind) || []
  if (!entries.length || compiled.agentContract.outputMode !== 'plot') return null
  const timeline = chat.timeline || {}, draft = chat.dreamSikeDraft
  const matchesBranch = operation => operation?.kind === 'body' && operation.basedOn?.branchId === timeline.branchId
    && operation.basedOn?.revision === timeline.revision
  const running = Object.values(timeline.operations || {}).filter(operation => matchesBranch(operation) && operation.status === 'running')
    .sort((a, b) => Number(b.turn) - Number(a.turn) || Number(b.createdAt || 0) - Number(a.createdAt || 0))[0]
  const bound = timeline.operations?.[draft?.operationId]
  const validDraft = ['draft', 'ready'].includes(draft?.status) && draft.branchId === timeline.branchId
    && draft.storyRevision === timeline.revision && draft.turn === bound?.turn && matchesBranch(bound)
  // An interrupted older operation can still say running. The current draft owns its action;
  // before a new draft exists, the newest running turn owns it instead of the first map entry.
  const operation = validDraft && (!running || Number(bound.turn) >= Number(running.turn)) ? bound : running
  const resolved = resolveRuntimePresetMacros(compiled, { charName: chat.cardName, macroState: chat.macroState, lastUserMessage: operation?.userText })
  const module = resolveRuntimePresetMacros({ front: { entries } }, { charName: chat.cardName, macroState: resolved.macroState }).snapshot
  const authorContext = kind === 'review' ? resolved.snapshot.text : ''
  const last = (chat.messages || []).findLast(message => message.role === 'assistant')
  const variables = last?.variables?.[last.swipeId || 0] || chat.variables || {}
  const state = variables.stat_data || variables
  const stateDigest = hash([state, chat.posture || '', chat.openingWorldbookSnapshot?.document || null])
  return { kind, names: entries.map(entry => entry.name), rules: module.text, authorContext,
    state, stateDigest, ruleDigest: hash([module.text, authorContext, stateDigest]), contractDigest: compiled.agentContract.digest }
}
export function draftModuleReceiptCurrent(chat, kind) {
  const draft = chat?.dreamSikeDraft, plan = dreamSikeDraftModulePlan(chat, kind), receipt = draft?.modules?.[kind]
  return Boolean(plan && receipt?.status === 'done' && receipt.sourceHash === hash(draftModuleBase(draft.text, kind)) && receipt.ruleDigest === plan.ruleDigest)
}
export function inspectDraftModuleResult(kind, text) {
  if (typeof text !== 'string' || !text.trim() || text.length > 12000 || hasPrivateWritingProtocol(text)
    || /<\/?(?:UpdateVariable|initvar|dream_body|dream_plot|dream_option|dream_big_discuss|dream_discuss|dream_summary)\b/i.test(text)) throw new Error('模块仅接受当前剧情或简短审稿结果，不能含正文、变量或私有推理')
  if (kind === 'parallel') {
    const match = /^\s*<dream_parallel_event>([\s\S]*?)<\/dream_parallel_event>\s*$/i.exec(text)
    const bare = text.trim()
    // The model often supplies valid event rows without the transport wrapper. Add only that
    // wrapper; partial tags, another module's JSON, code and arbitrary HTML remain invalid.
    const unwrapped = !match && !/[<>]/.test(bare.replace(/<br\s*\/?\s*>/gi, ''))
      && !/^\s*[\[{]/.test(bare) && !bare.includes('```')
    const body = match?.[1] ?? (unwrapped ? bare : null)
    const rows = body?.trim().split(/\r?\n/).filter(line => line.trim())
    if (!rows || rows.length < 1 || rows.length > 3 || rows.some(line => !line.includes('|') || !/<br\s*\/?\s*>/i.test(line))) throw new Error('当前模块 parallel：提交 1–3 行地点|事件，每行至少一个 <br>，仅使用 dream_parallel_event 外壳；审稿 JSON 属于后续 review 模块')
    return { text: match ? bare : '<dream_parallel_event>' + body + '</dream_parallel_event>' }
  }
  const review = JSON.parse(text)
  if (!review || typeof review !== 'object' || Array.isArray(review) || Object.keys(review).length !== DREAM_SIKE_REVIEW_AXES.length
    || DREAM_SIKE_REVIEW_AXES.some(axis => !['pass', 'revise'].includes(review[axis]?.status) || typeof review[axis]?.evidence !== 'string'
      || review[axis].evidence.trim().length < 8 || review[axis].evidence.length > 500 || Object.keys(review[axis]).some(key => !['status', 'evidence'].includes(key)))) throw new Error('审稿需要六项 {status:pass/revise,evidence:8–500字具体依据}，不展开推理')
  return { review }
}
export function mergeDreamSikeDraftModule(chat, identity, expectedVersion, plan, result, trace, now = Date.now()) {
  const draft = chat.dreamSikeDraft
  if (!draft || draft.status !== 'draft' || draft.version !== expectedVersion || draft.operationId !== identity.operationId
    || draft.branchId !== identity.branchId || draft.storyRevision !== identity.storyRevision
    || chat.timeline?.operations?.[identity.operationId]?.status !== 'running') throw new Error('当前草稿或回合已变化，拒绝过期模块结果')
  const latest = dreamSikeDraftModulePlan(chat, plan.kind)
  if (!latest || latest.ruleDigest !== plan.ruleDigest) throw new Error('作者模块已变化，请重新读取并执行')
  const sourceHash = hash(draftModuleBase(draft.text, plan.kind))
  const beforeVersion = draft.version
  if (plan.kind === 'parallel') {
    const existing = ranges(draft.text, PARALLEL)
    const markers = ranges(draft.text, /<dream_parallel_event\s*\/>/gi)
    if (existing.length > 1 || markers.length > 1 || existing.length && markers.length) throw new Error('平行区块必须唯一定位，不能盲目覆盖多个位置')
    if (existing.length) draft.text = splice(draft.text, existing[0].index, existing[0][0].length, result.text + '\n')
    else if (markers.length) draft.text = splice(draft.text, markers[0].index, markers[0][0].length, result.text)
    else {
      const closing = '</dream_after_format>'
      const slots = ranges(draft.text, /<\/dream_after_format>/g)
      if (slots.length > 1) throw new Error('dream_after_format 不是唯一定位')
      draft.text = slots.length ? splice(draft.text, slots[0].index, closing.length, result.text + '\n' + closing) : draft.text + '\n' + result.text + '\n'
    }
    if (draft.text.length > 100000) throw new Error('合并后草稿超出大小限制')
    draft.version++
  }
  draft.modules ||= {}
  draft.modules[plan.kind] = { status: 'done', ruleDigest: plan.ruleDigest,
    sourceHash: hash(draftModuleBase(draft.text, plan.kind)), originalSourceHash: sourceHash, version: draft.version,
    review: result.review || null, traceSessionId: trace?.traceSessionId || '', completedAt: now }
  draft.checks = null
  if (plan.kind === 'review') {
    // Count revise-driven rounds so the phase can stop demanding another pass once the budget is
    // spent; an all-pass review is not reachable, so the budget is what makes the turn terminate.
    const revise = Object.values(result.review || {}).some(axis => axis?.status === 'revise')
    draft.editorialRounds = revise ? (Number(draft.editorialRounds) || 0) + 1 : 0
  }
  draft.phase = plan.kind === 'parallel' ? 'draft' : 'checking'
  draft.trace.push({ phase: draft.phase, action: plan.kind === 'parallel' ? '独立生成的平行事件已合入草稿，等待整体审稿' : '独立审稿已完成，等待检查与修订', at: now })
  draft.changes.push({ kind: 'module-' + plan.kind, summary: plan.kind === 'parallel' ? '独立平行事件已合入主线草稿' : '独立审稿已记录，正文尚未提交', beforeVersion, afterVersion: draft.version, at: now })
  return draft
}

/** A module is not a formal message: its result only mutates a matching live draft. */
export function createDreamSikeDraftModules({ read, update, tasks, run, selection, publish = () => {} }) {
  const jobs = new Map()
  async function execute({ chat, identity, kind, expectedVersion, signal }) {
    let plan = dreamSikeDraftModulePlan(chat, kind), draft = chat.dreamSikeDraft
    if (!plan) throw new Error('本局没有启用该作者模块')
    if (!Number.isSafeInteger(expectedVersion) || draft?.version !== expectedVersion || draft.status !== 'draft') throw new Error('请先建立并读取当前未确认的草稿版本')
    // Review owns its prerequisite so a stale parallel block does not consume a
    // failed foreground step before the Agent can review the amended story.
    if (kind === 'review' && dreamSikeDraftModulePlan(chat, 'parallel') && !draftModuleReceiptCurrent(chat, 'parallel')) {
      const prepared = await execute({ chat, identity, kind: 'parallel', expectedVersion, signal })
      chat = await read(chat.id)
      draft = chat?.dreamSikeDraft
      expectedVersion = prepared.draft.version
      plan = dreamSikeDraftModulePlan(chat, kind)
      if (!plan || draft?.version !== expectedVersion || draft.status !== 'draft') throw new Error('平行事件更新后草稿已变化，请重新读取当前版本')
    }
    if (draftModuleReceiptCurrent(chat, kind)) return { draft: structuredClone(draft), reused: true, module: kind }
    if (jobs.has(chat.id)) throw new Error('本局已有独立草稿模块执行中')
    const controller = new AbortController(); jobs.set(chat.id, controller)
    const basedOn = hash([draft.text, plan.ruleDigest, expectedVersion])
    let taskRun, trace
    try {
      const model = selection(chat); if (!model) throw new Error('没有可用的独立模块模型配置')
      taskRun = await tasks.begin(chat, 'dream-draft-module', { requestId: 'sike-module:' + randomUUID(), bindExistingSession: true })
      let result = null
      const submission = kind === 'parallel'
        ? '当前只执行 parallel 场外事件。用 sike_submit_module({text:"<dream_parallel_event>场外地点|可观察的事件。<br>角色仅知亲历事实。</dream_parallel_event>"}) 提交 1–3 行，不在本次提交六维审稿 JSON。'
        : '当前只执行 review 六维审稿。用 sike_submit_module({text:JSON.stringify({character:{status:"pass",evidence:"具体正文依据至少八个字符"},knowledge:{status:"pass",evidence:"具体正文依据至少八个字符"},style:{status:"pass",evidence:"具体正文依据至少八个字符"},continuity:{status:"pass",evidence:"具体正文依据至少八个字符"},playerAgency:{status:"pass",evidence:"具体正文依据至少八个字符"},format:{status:"pass",evidence:"具体正文依据至少八个字符"}})}) 提交；按实际正文填 pass 或 revise 及依据。'
      const moduleSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
      trace = await run({ sessionId: chat.sessionId, task: 'dream-draft-module', selection: model, persistent: true,
        rootOperationId: identity.operationId, rootTurn: identity.turn, branchId: identity.branchId, stage: 'addons',
        persistentSessionId: taskRun.participantRequest.sessionId || '', rewindTo: taskRun.participantRequest.rewindTo,
        signal: moduleSignal, onPersistentSessionReady: id => taskRun.bindSession(id, { stateOnly: true }),
        system: '你在正式提交之前独立执行选定作者模块：' + kind + '。遵循下列作者原文的内容职责；旧文本传输标签与私有思考输出由原生工具协议取代。不提交正式剧情或变量，也不创建其他 Agent。用 sike_submit_module 提交，成功后停止。\n【作者模块原文】\n' + plan.rules + (plan.authorContext ? '\n【已选正文写法】\n' + plan.authorContext : '') + '\n【本次唯一提交任务】\n' + submission,
        turnContext: '【当前草稿，尚未发生】\n' + draft.text + '\n【当前回合行动】\n' + (chat.timeline.operations[identity.operationId]?.userText || '')
          + '\n【已结算人物状态】\n' + (chat.posture || '') + '\n【当前变量事实】\n' + JSON.stringify(plan.state)
          + '\n【最近正式剧情】\n' + JSON.stringify(chat.messages.slice(-4).map(message => ({ role: message.role, text: message.projectionText ?? message.sourceText ?? message.text }))),
        messages: [{ id: randomUUID(), role: 'user', content: [{ type: 'text', text: '按本阶段职责执行作者模块，提交可观察结果。' }] }],
        tools: [DREAM_SIKE_MODULE_TOOL], maxToolCalls: 4, stopToolsWhen: () => result !== null, acceptWithoutText: () => result !== null,
        async onToolCall(call) { try {
          if (call.name !== DREAM_SIKE_MODULE_TOOL.name || result) throw new Error('请只提交当前模块一次')
          const args = typeof call.arguments === 'string' ? JSON.parse(call.arguments) : call.arguments
          result = inspectDraftModuleResult(kind, args?.text)
          return JSON.stringify({ ok: true, module: kind })
        } catch (error) { return JSON.stringify({ ok: false, retryable: true, currentKind: kind, error: error.message, submissionHint: submission }) } }
      })
      moduleSignal.throwIfAborted()
      if (!result) throw new Error('独立模块未提交有效结果，草稿已保留')
      const latest = await read(chat.id)
      if (hash([latest?.dreamSikeDraft?.text, dreamSikeDraftModulePlan(latest, kind)?.ruleDigest, latest?.dreamSikeDraft?.version]) !== basedOn) throw new Error('草稿或预设已变化，拒绝过期结果')
      const completed = await taskRun.commit({ stateChanged: false, participant: taskRun.participant(trace), apply(current) {
        mergeDreamSikeDraftModule(current, identity, expectedVersion, plan, result, trace)
      } })
      if (completed.status !== 'committed') throw new Error('分支已变化，模块结果未采用')
      const saved = await read(chat.id); publish(saved.sessionId)
      return { draft: structuredClone(saved.dreamSikeDraft), reused: false, module: kind }
    } catch (error) { if (taskRun) await taskRun.fail(trace || error).catch(() => {}); throw error }
    finally { jobs.delete(chat.id) }
  }
  return { execute, dispose() { for (const controller of jobs.values()) controller.abort(); jobs.clear() } }
}
