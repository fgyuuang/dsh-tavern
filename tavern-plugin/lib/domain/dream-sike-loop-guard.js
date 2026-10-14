import { createHash } from 'node:crypto'
import { dreamSikeToolPhase } from './dream-sike-tool-phase.js'
import { sessionEvents } from './session-events.js'

const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value
const hash = value => createHash('sha256').update(JSON.stringify(sorted(value))).digest('hex')
function argumentsOf(value) { if (typeof value !== 'string') return value; try { return JSON.parse(value) } catch { return value } }
function recentEvents(session) {
  if (Number.isSafeInteger(session?.seq) && typeof session.eventAt === 'function') {
    const events = []
    for (let seq = session.seq - 1; seq >= Math.max(0, session.seq - 128); seq--) events.push(session.eventAt(seq))
    return events.filter(Boolean).reverse()
  }
  return sessionEvents(session).slice(-128)
}
function stableState(chat, phase) {
  const prepared = chat.dreamSikePreparation
  return hash([phase.name, phase.context, prepared && {
    operationId: prepared.operationId, contractDigest: prepared.contractDigest, profileDigest: prepared.profileDigest,
    read: Boolean(prepared.readAt), prepared: Boolean(prepared.preparedAt), brief: prepared.brief,
    coverage: prepared.coverage, materialRefs: prepared.materialRefs, servedRuleIds: prepared.servedRuleIds,
    ranges: prepared.ruleReadRanges
  }, Object.fromEntries(Object.entries(chat.dreamSikeDraft?.modules || {}).map(([kind, receipt]) => [kind, {
    status: receipt.status, version: receipt.version, sourceHash: receipt.sourceHash,
    ruleDigest: receipt.ruleDigest, review: receipt.review
  }]))])
}
function stepSignature(events, turn, step, state) {
  if (!events.some(event => event.type === 'step/end' && event.data?.turn === turn && event.data.step === step)
    || !events.some(event => event.type === 'step/start' && event.data?.turn === turn && event.data.step === step)) return null
  const scoped = events.filter(event => event.data?.turn === turn && event.data.step === step)
  const calls = scoped.filter(event => event.type === 'tool/call')
  if (!calls.length) return null
  const results = new Map()
  for (const event of scoped.filter(event => event.type === 'tool/result')) {
    const message = event.data.message, block = message?.content?.find(item => item.type === 'tool-result')
    const id = message?.source?.callId || block?.toolCallId
    if (id && block) results.set(id, { content: block.content, error: Boolean(event.data.error || block.isError) })
  }
  const signatures = []
  for (const event of calls) {
    const result = results.get(event.data.callId)
    if (!result) return null
    const sike = event.data.name?.startsWith('sike_')
    // Sike success reports include wall-clock receipts and traces. Actual phase/state is the
    // stable result; failures keep their error content so different corrections remain distinct.
    signatures.push([event.data.name, argumentsOf(event.data.arguments), result.error,
      sike && !result.error ? state : hash(result.content)])
  }
  return hash(signatures)
}

/** Stop only three identical completed tool steps without durable writing progress. */
export function createDreamSikeLoopGuard() {
  const observations = new WeakMap()
  return (payload, chat) => {
    const agent = payload.agent, step = Number(payload.step) - 1, turn = Number(payload.turn)
    if (!agent || chat?.playPresetId !== 'dream-sike-dsh' || step < 1) { if (agent) observations.delete(agent); return }
    const phase = dreamSikeToolPhase(chat, agent.session?.id, turn)
    if (!phase || phase.name === 'ready') { observations.delete(agent); return }
    const state = stableState(chat, phase), signature = stepSignature(recentEvents(agent.session), turn, step, state)
    if (!signature) { observations.delete(agent); return }
    const previous = observations.get(agent)
    if (previous?.turn === turn && previous.step === step) return
    const repeated = previous?.turn === turn && previous.step === step - 1 && previous.state === state && previous.signature === signature
    const count = repeated ? previous.count + 1 : 1
    observations.set(agent, { turn, step, state, signature, count })
    if (count >= 3) throw Object.assign(new Error('梦境思客DSH连续三个步骤重复相同工具请求和结果，写作状态没有推进；草稿已保留，请使用“继续本回合”继续处理。'), { code: 'DREAM_SIKE_NO_PROGRESS' })
  }
}
