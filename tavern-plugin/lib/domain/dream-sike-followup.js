import { createHash, randomUUID } from 'node:crypto'
import { compileDreamSikeContract } from './dream-sike-contract.js'
import { resolveRuntimePresetMacros } from './runtime-presets.js'

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const idOf = entry => entry.source?.identifier || entry.identifier || String(entry.id || entry.entryKey || '').replace(/#\d+$/, '')
const DISCUSS = '27bf435f-4283-4937-8c6f-3c31abc4f6d2'
const MODULE_TAGS = new Map([
  ['f9b03e19-fd96-4782-8867-73ad2cbabfb9', 'dream_discuss'], [DISCUSS, 'dream_big_discuss'],
  ['11cdd506-1513-4008-b6b9-c883dbad65c5', 'dream_option'], ['f96f47f7-01ef-4676-b0fe-6f254ae7e550', 'dream_option'],
  ['6a8e799c-9445-44f2-a853-c6c71b92b855', 'dream_summary']
])
const TAG_ORDER = ['dream_discuss', 'dream_big_discuss', 'dream_option', 'dream_summary']
export const DREAM_SIKE_FOLLOWUP_TOOL = Object.freeze({
  name: 'sike_submit_followup', description: '提交本轮结算后的梦境后续内容。仅提交已启用作者模块的 dream_discuss / dream_big_discuss / dream_option / dream_summary 原文，不重写剧情、不输出变量更新或完整私有推理。摘要只摘录本回合既成事实，不替代原生压缩或记忆。按校验反馈修正，成功后停止。',
  parameters: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } }, required: ['text'] }
})

export function dreamSikeFollowupPlan(chat) {
  if (chat?.playPresetId !== 'dream-sike-dsh' || !['story', 'script'].includes(chat.mode || 'story')) return null
  const snapshot = compileDreamSikeContract(chat.runtimePresetSnapshot)
  const entries = snapshot?.deferredFollowup?.entries || []
  if (!entries.length || snapshot.agentContract.outputMode !== 'plot') return null
  const latest = (chat.messages || []).findLastIndex(row => row.role === 'assistant')
  const message = chat.messages[latest]
  if (!message || message.greeting || !chat.timeline?.branchId) return null
  const text = String(message.projectionText ?? message.sourceText ?? message.text ?? '')
  if (!text.trim() || !Number.isSafeInteger(Number(message.turn)) || Number(message.turn) < 1) return null
  const action = [...chat.messages.slice(0, latest)].reverse().find(row => row.role === 'user')
  const playerAction = action?.sourceText ?? action?.text ?? ''
  const enabledModules = entries.map(entry => ({ id: idOf(entry), name: entry.name || entry.source?.name || '' }))
  const tags = TAG_ORDER.filter(tag => entries.some(entry => MODULE_TAGS.get(idOf(entry)) === tag))
  if (!tags.length) return null
  const resolved = resolveRuntimePresetMacros({ front: { entries }, sourceMacroOverrides: snapshot.sourceMacroOverrides },
    { charName: chat.cardName, macroState: chat.macroState, lastUserMessage: playerAction }).snapshot
  const ruleDigest = hash([snapshot.deferredFollowup.digest, resolved.text, snapshot.regexScripts])
  const variables = message.variables?.[message.swipeId || 0] || chat.variables || {}
  const identity = { branchId: chat.timeline.branchId, turn: Number(message.turn), sourceHash: hash(text), ruleDigest,
    stateHash: hash(variables), lifecycleRevision: Number(chat.tavernHelperLifecycleRevision) || 0 }
  return { ...identity, key: hash(identity), latest, text, rules: resolved.text, tags, enabledModules,
    revision: chat.timeline.revision, variables,
    playerAction,
    optionCount: Number(entries.filter(entry => MODULE_TAGS.get(idOf(entry)) === 'dream_option').map(entry => String(entry.content).match(/选项数量为\s*(\d+)\s*个/)?.[1]).find(Boolean)) || null }
}

export function inspectDreamSikeFollowup(text, plan) {
  if (typeof text !== 'string' || !text.trim() || text.length > 24000) throw new Error('后续互动须为非空文本，最多 24000 字符')
  if (/<\/?(?:dream_plot|dream_body|dream_scene|dream_parallel_event|UpdateVariable|initvar|think|simple_thinking|thinking_step)\b/i.test(text)) throw new Error('后续互动不能包含正文、场景、平行事件、变量协议或私有推理')
  let remainder = text
  const sections = []
  for (const tag of plan.tags) {
    const matches = [...text.matchAll(new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + tag + '\\s*>', 'gi'))]
    if (matches.length !== 1 || !matches[0][1].trim()) throw new Error('已启用模块需要一个完整非空 ' + tag)
    if (TAG_ORDER.some(other => new RegExp('<\\/?' + other + '\\b', 'i').test(matches[0][1]))) throw new Error('后续模块须独立，不能嵌套或重复')
    if (tag === 'dream_option' && plan.optionCount && matches[0][1].trim().split('|').filter(value => value.trim()).length !== plan.optionCount) throw new Error('请按原作者要求提交 ' + plan.optionCount + ' 个行动选项，以 | 分隔')
    if (tag === 'dream_big_discuss') {
      const questions = [...matches[0][1].matchAll(/<q\s+[^>]*content\s*=\s*(["'])([\s\S]*?)\1[^>]*>([\s\S]*?)<\/q\s*>/gi)]
      if (questions.length < 1 || questions.length > 3 || questions.some(q => !q[2].trim() || [...q[3].matchAll(/<a>([\s\S]*?)<\/a\s*>/gi)].filter(a => a[1].trim()).length !== 3)) throw new Error('思客大调查需 1–3 个 q content 问题，每个问题提供 3 个非空 a 方向')
    }
    if (tag === 'dream_summary') {
      const details = matches[0][1].trim().split(/\r?\n/).filter(line => /^\s*[-*]\s+\S/.test(line))
      if (details.length < 2 || details.length > 3) throw new Error('梦鲸小摘要需按作者要求提供 2–3 条原文细节，以 Markdown 无序列表列出')
    }
    remainder = remainder.replace(matches[0][0], '')
    sections.push(matches[0][0])
  }
  if (remainder.trim()) throw new Error('只提交已启用的后续模块，不添加正文或额外外壳')
  return sections.join('\n\n')
}

export function dreamSikeFollowupView(chat) {
  const value = chat?.dreamSikeFollowup
  if (!value || chat.playPresetId !== 'dream-sike-dsh' || value.branchId !== chat.timeline?.branchId) return null
  const latest = (chat.messages || []).findLast(row => row.role === 'assistant')
  if (latest && Number(latest.turn) !== value.turn) return null
  const text = latest?.projectionText ?? latest?.sourceText ?? latest?.text
  if (typeof text === 'string' && hash(text) !== value.sourceHash) return null
  return value
}

/** Derived interaction only. The existing coordinator owns the resident worker and commit guard. */
export function createDreamSikeFollowups({ read, update, tasks, run, selection, project, publish = () => {}, busy = () => false, now = Date.now }) {
  const jobs = new Map(), timers = new Map()
  let disposed = false
  const current = (chat, plan) => dreamSikeFollowupPlan(chat)?.key === plan.key
  const record = (plan, status, extra = {}) => ({ key: plan.key, turn: plan.turn, branchId: plan.branchId, revision: plan.revision,
    sourceHash: plan.sourceHash, ruleDigest: plan.ruleDigest, enabledModules: plan.enabledModules,
    status, waitingForSettlement: false, error: '', projection: null, updatedAt: now(), ...extra })
  async function save(chatId, plan, status, extra = {}) {
    const saved = await update(chatId, chat => {
      if (current(chat, plan)) chat.dreamSikeFollowup = record(plan, status, extra)
      return chat
    }, { source: 'dream-sike.followup.' + status, touchUpdatedAt: false })
    if (saved) publish(saved.sessionId)
    return saved
  }
  async function wait(chatId) {
    const chat = await read(chatId), plan = dreamSikeFollowupPlan(chat)
    if (disposed || jobs.has(chatId)) return
    if (!plan || !['pending', 'running'].includes(chat.settleStatus)) return
    if (chat.dreamSikeFollowup?.key === plan.key && ['queued', 'running'].includes(chat.dreamSikeFollowup.status)) return
    await save(chatId, plan, 'queued', { waitingForSettlement: true })
  }
  async function invalidate(chatId, plan) {
    const saved = await update(chatId, chat => {
      if (chat.dreamSikeFollowup?.key === plan.key && chat.timeline?.branchId === plan.branchId) {
        chat.dreamSikeFollowup = { ...chat.dreamSikeFollowup, status: 'failed', error: '正文、状态或预设已变化，本次后续结果已作废，可以重新生成。', updatedAt: now() }
      }
      return chat
    }, { source: 'dream-sike.followup.stale', touchUpdatedAt: false })
    if (saved) publish(saved.sessionId)
  }
  function retryLater(chatId) {
    if (disposed || timers.has(chatId)) return
    timers.set(chatId, setTimeout(() => { timers.delete(chatId); void start(chatId).catch(() => {}) }, 2000))
  }
  async function execute(chatId, plan, controller) {
    let taskRun, trace
    try {
      const chat = await read(chatId)
      if (!current(chat, plan) || chat.settleStatus !== 'done') return
      if (busy(chat)) { retryLater(chatId); return }
      const model = selection(chat)
      if (!model) throw new Error('没有可用的后续互动模型配置')
      taskRun = await tasks.begin(chat, 'dream-followup', { requestId: 'sike-followup:' + randomUUID(), bindExistingSession: true })
      if (!current(taskRun.chat, plan) || taskRun.chat.settleStatus !== 'done') { await taskRun.fail(); await invalidate(chatId, plan); return }
      await save(chatId, plan, 'running')
      const participant = taskRun.participantRequest
      let submitted = null
      trace = await run({ sessionId: chat.sessionId, task: 'dream-followup', selection: model, persistent: true,
        persistentSessionId: participant.sessionId || '', rewindTo: participant.rewindTo,
        signal: controller.signal, onPersistentSessionReady: id => taskRun.bindSession(id, { stateOnly: true }),
        system: '你负责梦境思客本轮结算后的后续互动。依照下列选定作者原文工作，尊重最终正文、玩家身份和当前变量。原文中的正文后/末尾位置在本阶段指独立互动面板；仅输出选定模块，不推进剧情、不替玩家作选择、不修改变量或记忆，不展示完整私有推理。说书及共创中的未来设想只是建议，不是已发生事件；小摘要只摘录本回合最终正文已经成立的事实，原话须来自正文，不捏造细节，不作为原生压缩或记忆更新。用 sike_submit_followup 提交，收到 ok=true 后停止。\n\n【作者原文】\n' + plan.rules,
        turnContext: '【本轮已提交正文】\n' + plan.text + '\n\n【结算后的变量】\n' + JSON.stringify(plan.variables) + '\n\n【当前人物状态】\n' + String(chat.posture || '') + '\n\n【玩家本轮输入】\n' + plan.playerAction,
        messages: [{ id: randomUUID(), role: 'user', content: [{ type: 'text', text: '正文和变量结算已经完成。现在只生成本轮已启用的后续互动。' }] }],
        tools: [DREAM_SIKE_FOLLOWUP_TOOL], maxToolCalls: 4,
        stopToolsWhen: () => submitted !== null, acceptWithoutText: () => submitted !== null,
        async onToolCall(call) {
          try {
            if (call.name !== DREAM_SIKE_FOLLOWUP_TOOL.name) throw new Error('此阶段只提交后续互动')
            if (submitted !== null) throw new Error('后续互动已提交，请停止')
            const args = typeof call.arguments === 'string' ? JSON.parse(call.arguments) : call.arguments
            submitted = inspectDreamSikeFollowup(args?.text, plan)
            return JSON.stringify({ ok: true, accepted: plan.tags })
          } catch (error) { return JSON.stringify({ ok: false, retryable: true, error: error.message }) }
        }
      })
      if (!submitted) throw new Error('后续 Agent 未提交有效互动内容')
      controller.signal.throwIfAborted()
      const latest = await read(chatId)
      if (!current(latest, plan)) { await taskRun.fail(trace); await invalidate(chatId, plan); return }
      const projected = await project(submitted, latest)
      const projection = { version: 2, turn: plan.turn, text: projected.displayText, mode: projected.displayMode,
        parts: projected.displayParts, warnings: projected.warnings }
      const completed = await taskRun.commit({ stateChanged: false, participant: taskRun.participant(trace), apply(draft) {
        if (!current(draft, plan)) throw new Error('正文或预设已变化，拒绝过期后续互动')
        draft.dreamSikeFollowup = record(plan, 'done', { text: submitted, projection,
          operationId: taskRun.operationId, traceSessionId: trace.traceSessionId })
      } })
      if (completed.status === 'committed') publish(chat.sessionId)
    } catch (error) {
      if (taskRun) await taskRun.fail(trace || error).catch(() => {})
      if (disposed || controller.signal.aborted) return
      if (['BACKGROUND_BUSY', 'COMPACTION_RUNNING'].includes(error.code)) { retryLater(chatId); return }
      if (!current(await read(chatId), plan)) await invalidate(chatId, plan)
      else await save(chatId, plan, 'failed', { error: error.message || String(error) })
    }
  }
  async function start(chatId, { force = false } = {}) {
    if (disposed || jobs.has(chatId)) return
    const chat = await read(chatId), plan = dreamSikeFollowupPlan(chat)
    if (disposed || jobs.has(chatId)) return
    if (!plan || chat.settleStatus !== 'done') return
    if (!force && chat.dreamSikeFollowup?.key === plan.key && ['done', 'failed'].includes(chat.dreamSikeFollowup.status)) return
    // Reserve before the first write so concurrent wakes cannot launch two workers.
    const controller = new AbortController(), job = { controller, promise: null }
    jobs.set(chatId, job)
    const queued = save(chatId, plan, 'queued')
    job.promise = queued.then(() => { controller.signal.throwIfAborted(); return execute(chatId, plan, controller) })
      .catch(() => {}).finally(() => { if (jobs.get(chatId) === job) jobs.delete(chatId) })
    await queued
  }
  async function recover(chatIds) {
    for (const chatId of chatIds) {
      const chat = await read(chatId)
      if (['queued', 'running'].includes(chat?.dreamSikeFollowup?.status)) await start(chatId)
    }
  }
  async function cancel(chatId) {
    const timer = timers.get(chatId); if (timer) { clearTimeout(timer); timers.delete(chatId) }
    const job = jobs.get(chatId)
    if (!job && !timer) return false
    if (job) { job.controller.abort(); await job.promise }
    const saved = await update(chatId, chat => {
      if (['queued', 'running'].includes(chat.dreamSikeFollowup?.status)) chat.dreamSikeFollowup = { ...chat.dreamSikeFollowup,
        status: 'failed', error: '玩家已继续下一回合，本轮后续生成已停止，正式正文与变量保留。', updatedAt: now() }
      return chat
    }, { source: 'dream-sike.followup.cancelled', touchUpdatedAt: false })
    if (saved) publish(saved.sessionId)
    return true
  }
  function dispose() { disposed = true; for (const job of jobs.values()) job.controller.abort(); for (const timer of timers.values()) clearTimeout(timer); timers.clear() }
  return { wait, start, recover, cancel, dispose }
}
