import { createHash } from 'node:crypto'
import { sessionEvents } from './session-events.js'

// Compare model-visible history, not prepared Chat state. Rewind/fork naturally
// select their own baseline; compaction of the record causes a full refresh.
export function worldbookSnapshot(session, text, pendingMessages = []) {
  text = String(text || '').trim()
  const events = new Map(sessionEvents(session).map(event => [event.seq, event]))
  const messages = (session?.surface?.nodes || []).map(seq => events.get(seq))
    .filter(event => event?.type === 'user/message').map(event => event.data).concat(pendingMessages)
  let previous
  for (const message of messages) {
    const record = message?.source?.worldbookSnapshot
    if (message?.source?.plugin !== 'dsh-tavern' || record?.schemaVersion !== 1) continue
    const content = (message.content || []).filter(block => block.type === 'text').map(block => block.text).join('')
    if (content.includes(record.rendered)) previous = record
  }
  if (previous ? previous.text === text : !text) return null
  const version = createHash('sha256').update(text).digest('hex').slice(0, 16)
  // One complete ordered snapshot keeps cross-entry XML wrappers intact. Older
  // snapshots stay in the cached history, so each one supersedes them: entries
  // no longer triggered (often directives, not facts) must stop applying.
  const body = text.replace(/^【本轮世界书上下文】\n?/, '')
  const rendered = body
    ? `【本轮世界书上下文】（关键词触发，替代此前各轮触发的条目）\n${body}`
    : '【本轮世界书上下文】本轮没有触发条目，此前各轮触发的条目不再适用。'
  return { schemaVersion: 1, text, version, rendered }
}
