import { createHash } from 'node:crypto'

/** Evidence from the final provider request, after all template projections. */
export function confirmWritingRuleDelivery(request, snapshot, coordinates) {
  const text = [request.system || '', ...(request.messages || []).flatMap(message => (Array.isArray(message.content) ? message.content : []).filter(block => block.type === 'text').map(block => block.text || ''))].join('\n')
  const hashes = new Set(), entries = ['front', 'middle', 'back'].flatMap(phase => snapshot?.[phase]?.entries || [])
  let characters = 0
  for (const entry of entries) {
    const content = typeof entry.content === 'string' ? entry.content : ''
    if (!content.trim() || !text.includes(content)) continue
    hashes.add(createHash('sha256').update(content).digest('hex')); characters += content.length
  }
  return { turn: coordinates.turn, step: coordinates.step, hashes: [...hashes], characters }
}

/** A reference never stands in for text absent from this exact model request. */
export function rulePageDelivered(page, proof, identity, step) {
  if (!proof || !Number.isSafeInteger(step) || proof.turn !== identity.turn || proof.step !== step) return false
  const hashes = new Set(proof.hashes)
  return page.rules.every(rule => rule.resolvedCharacters === 0 || hashes.has(rule.resolvedHash))
}
