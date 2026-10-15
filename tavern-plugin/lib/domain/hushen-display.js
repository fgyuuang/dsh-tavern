const escapeHtml = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;')

/** The original controller renders these hidden protocols by mutating ST's DOM.
 * Its native replacement is a local text view, never another generation task. */
export function projectHushenSupplementDisplay(sourceText, displayText) {
  const source = String(sourceText || '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<!--[\s\S]*?-->/gi, '')
  const parts = []
  for (const match of source.matchAll(/<fox_front\b[^>]*>([\s\S]*?)<\/fox_front\s*>/gi)) {
    const text = match[1].replace(/<\/?fox_front_insert\s*>/gi, '').trim()
    const title = text.match(/^#标题\s+(.+)$/m)?.[1] || text.match(/^#意图\s+(.+)$/m)?.[1] || '剧情载体'
    if (text) parts.push('<details data-dsh-hushen-view="carrier"><summary>' + escapeHtml(title)
      + '</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere;font:inherit">' + escapeHtml(text) + '</pre></details>')
  }
  for (const match of source.matchAll(/<fox_hugou\b[^>]*>([\s\S]*?)<\/fox_hugou\s*>/gi)) {
    const text = match[1].trim()
    if (text) parts.push('<details data-dsh-hushen-view="outline"><summary>剧情大纲</summary>'
      + '<pre style="white-space:pre-wrap;overflow-wrap:anywhere;font:inherit">' + escapeHtml(text) + '</pre></details>')
  }
  if (!parts.length) return String(displayText || '')
  // Hide any unconsumed source descriptors once, retaining the original source
  // and request projection. The source author's other display rules still run.
  const body = String(displayText || '')
    .replace(/<fox-front-view\b[^>]*>\s*<\/fox-front-view\s*>/gi, '')
    .replace(/<fox_(?:front|hugou)\b[^>]*>[\s\S]*?<\/fox_(?:front|hugou)\s*>/gi, '')
  return body + '\n\n' + parts.join('\n\n')
}
