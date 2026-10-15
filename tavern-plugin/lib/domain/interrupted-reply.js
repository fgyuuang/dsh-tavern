import { createHash } from 'node:crypto'
import { sessionEvents } from './session-events.js'
import { isSingleReplyMode } from './generation-mode.js'

// Attempts are alternatives, not successive paragraphs. Never join retries or
// reasoning/tool chunks into the visible reply.
export function interruptedAttempt(session, turn, step) {
  const events = sessionEvents(session)
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i], data = event?.data
    if (!['assistant/attempt', 'assistant/message'].includes(event?.type)
      || Number(data?.turn) !== Number(turn) || (step !== undefined && data.step !== step)) continue
    const text = Array.isArray(data.stream) ? data.stream.map(entry => {
      if (entry?.type === 'text-chunks') return (entry.texts || []).join('')
      return entry?.type === 'chunk' && entry.chunk?.type === 'text-delta' ? entry.chunk.text || '' : ''
    }).join('') : ''
    const fallback = (data.message?.content || []).filter(block => block?.type === 'text').map(block => block.text || '').join('')
    if ((text || fallback).trim()) return { seq: event.seq, text: text || fallback }
  }
  return null
}

export function mergeInterruptedReply(prefix, suffix) {
  if (!prefix) return suffix
  if (!suffix) return prefix
  if (prefix.length >= 32 && suffix.startsWith(prefix)) return suffix
  // Only remove a substantial exact boundary overlap; short repeated words may
  // be intentional prose. Never use fuzzy matching to alter the author's text.
  for (let n = Math.min(prefix.length, suffix.length, 8192); n >= 32; n--) {
    if (prefix.endsWith(suffix.slice(0, n))) return prefix + suffix.slice(n)
  }
  return prefix + suffix
}

function contract(chat) {
  return JSON.stringify([chat.playPresetId, chat.playPresetRevision, chat.generationModeRevision,
    chat.runtimePresetSnapshot?.digest, chat.cardContextRevision, chat.tavernHelperLifecycleRevision])
}

function currentResume(chat, turn) {
  const marker = chat?.interruptedReplyResume
  if (!marker || marker.nextTurn !== Number(turn) || chat.nativeCommits?.[String(turn)]) return null
  if (!isSingleReplyMode(chat) || marker.sessionId !== chat.sessionId
    || marker.branchId !== chat.timeline?.branchId || marker.storyRevision !== chat.timeline?.revision
    || marker.contract !== contract(chat)) throw new Error('中断正文的分支或预设已变化，请重新生成本轮')
  return marker
}

export function singleReplyText(chat, turn, suffix) {
  const marker = currentResume(chat, turn)
  return marker ? mergeInterruptedReply(marker.text, suffix)
    : String(chat.compatibilityTraces?.[String(turn)]?.assistantPrefill || '') + suffix
}

function publicPreview(text) {
  // Unclosed private blocks are hidden through end of stream. A partial HTML
  // page is returned as plain text and must never run card scripts or MVU.
  return text.replace(/<(think_fox~|think|simple_thinking|dream_self_check|redemption_chain|thought_of_chain|thinking_step)(?=[\s>])[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '')
    .replace(/```(?:thought|analysis|reasoning|redemption_chain|thought_of_chain|thinking_step)\b[\s\S]*?(?:```|$)/gi, '')
}

export function readInterruptedReply(chat, session, turn) {
  if (!isSingleReplyMode(chat) || chat.nativeCommits?.[String(turn)]) return null
  const operation = Object.values(chat.timeline?.operations || {}).findLast(op => op?.kind === 'body' && Number(op.turn) === Number(turn))
  if (!operation || !['running', 'failed'].includes(operation.status)
    || operation.basedOn?.branchId !== chat.timeline?.branchId || operation.basedOn?.revision !== chat.timeline?.revision) return null
  const attempt = interruptedAttempt(session, turn)
  let text
  if (attempt) text = singleReplyText(chat, turn, attempt.text)
  else text = currentResume(chat, turn)?.text || ''
  if (!text.trim()) return null
  const digest = createHash('sha256').update(JSON.stringify([chat.sessionId, turn, operation.id, chat.timeline.branchId,
    chat.timeline.revision, contract(chat), text])).digest('hex')
  return { turn: Number(turn), operationId: operation.id, digest, text, preview: publicPreview(text),
    characters: text.length, branchId: chat.timeline.branchId, storyRevision: chat.timeline.revision }
}

export function planInterruptedReplyResume(chat, session, turn, expectedDigest) {
  const draft = readInterruptedReply(chat, session, turn)
  if (!draft || draft.digest !== expectedDigest) throw new Error('中断正文已变化，请刷新后继续')
  return { failedTurn: Number(turn), nextTurn: Number(turn) + 1, sessionId: chat.sessionId,
    sourceOperationId: draft.operationId, digest: draft.digest, text: draft.text,
    branchId: draft.branchId, storyRevision: draft.storyRevision, contract: contract(chat) }
}

export function collectInterruptedReplies(chat, session, turn) {
  const latest = readInterruptedReply(chat, session, turn)
  if (!latest) return undefined
  const archive = [...(chat.interruptedReplyArchive || [])]
  let changed = false
  for (const event of sessionEvents(session)) {
    if (!['assistant/attempt', 'assistant/message'].includes(event?.type) || Number(event.data?.turn) !== Number(turn)) continue
    const attempt = interruptedAttempt({ events: [event] }, turn)
    if (!attempt || archive.some(row => row.branchId === latest.branchId && row.seq === event.seq)) continue
    const text = singleReplyText(chat, turn, attempt.text)
    archive.push({ turn: Number(turn), seq: event.seq, branchId: latest.branchId, operationId: latest.operationId,
      preview: publicPreview(text), characters: text.length, status: 'interrupted', savedAt: Date.now() })
    changed = true
  }
  return changed ? { ...chat, interruptedReplyArchive: archive } : undefined
}

export function projectInterruptedReply(messages, chat, turn) {
  const marker = currentResume(chat, turn)
  if (!marker) return messages
  return [...messages,
    { role: 'assistant', content: [{ type: 'text', text: marker.text }] },
    { role: 'user', content: [{ type: 'text', text: '上条回复因连接中断而未完成。沿用本轮原有预设、人物与格式要求，只接着补完剩余内容，不要重写或重复已有部分，也不要重新开始本轮。已有内容尚未提交；完整回复由系统合并后统一提交。' }] }
  ]
}
