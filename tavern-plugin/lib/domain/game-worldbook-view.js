import { isMvuUpdateEntry } from './worldbook-recall.js'
import { worldbookContentDigest } from './worldbook-version.js'

/** A read-only view of the actual game resource, including disabled entries. */
export function gameWorldbookView(record, scope = 'snapshot', includeContent = true) {
  const entries = (record?.view?.entries || []).map(entry => ({
    ref: entry.ref, title: entry.comment || entry.title || '未命名条目',
    ...(includeContent ? { content: String(entry.content || '') } : {}),
    enabled: entry.enabled !== false, constant: entry.constant === true,
    mvuRule: isMvuUpdateEntry(entry)
  }))
  const enabled = entries.filter(entry => entry.enabled)
  return { name: record?.view?.displayName || '', source: record?.source || null, scope, entries,
    sources: record?.mergedSources || (record?.source ? [{ source: record.source, name: record.view?.displayName || '' }] : []),
    revision: worldbookContentDigest(record),
    counts: { total: entries.length, enabled: enabled.length,
      constant: enabled.filter(entry => entry.constant && !entry.mvuRule).length,
      dynamic: enabled.filter(entry => !entry.constant && !entry.mvuRule).length,
      mvuRules: enabled.filter(entry => entry.mvuRule).length } }
}

export async function readGameWorldbook({ chat, card, worldBooks, updateStatus }) {
  if (!chat || !['story', 'script'].includes(chat.mode || 'story')) throw new Error('仅支持游玩会话')
  const local = await worldBooks.bound(chat.cardPath, card, chat)
  const result = gameWorldbookView(local, chat.openingWorldbookSnapshot?.version === 1 ? 'snapshot' : 'library')
  const liveChat = { ...chat }; delete liveChat.openingWorldbookSnapshot
  try {
    const library = await worldBooks.bound(chat.cardPath, undefined, liveChat)
    const summary = gameWorldbookView(library, 'library', false)
    result.library = { name: summary.name, source: summary.source, sources: summary.sources, counts: summary.counts }
    result.localChanges = result.scope === 'snapshot' && result.revision !== summary.revision
  } catch (error) { result.library = { error: String(error?.message || error) } }
  result.update = await updateStatus(chat)
  return result
}
