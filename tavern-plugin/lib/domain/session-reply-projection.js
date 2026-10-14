import { appendSessionEvent, sessionEvents } from './session-events.js'
import { replaceSessionSurface } from './session-surface-mutations.js'

/** A ready-tool response stays paired with its result; the official body gets its own node. */
export function projectAssistantReply(session, result, bodyText) {
  if (!result) return
  const previous = result.event?.data?.message
  if (!previous || typeof previous !== 'object') return
  const toolCalls = previous.content?.some(block => block.type === 'tool-call')
  if (!toolCalls && result.text === bodyText) return
  const seq = result.event.seq ?? result.index
  const id = 'tavern-reply-projection:' + session.id + ':' + result.event.data.turn + ':' + seq
  const existing = sessionEvents(session).find(event => event.data?.message?.id === id)
  if (existing) {
    if (existing.data.message.content[0]?.text !== bodyText) throw new Error('正式正文投影已存在不同内容，请重新读取会话')
    return existing
  }
  const data = {
    turn: Number(result.event.data.turn) || 0, step: Number(result.event.data.step) || 1,
    message: { ...previous, id, source: { kind:'model',provider:'dsh-tavern',model:'reply-projection' },
      content:[{type:'text',text:bodyText}] }
  }
  return toolCalls ? appendSessionEvent(session, 'assistant/message', data, {surfaceOp:'append'})
    : replaceSessionSurface(session, 'assistant/message', data, {start:seq,end:seq,sourceEventSeqs:[seq]})
}
