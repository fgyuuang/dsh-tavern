/** Keep a valid explicit level; otherwise let this exact model use its own default.
 * Capability lookup errors propagate so an unavailable model is never silently rerouted.
 */
export async function compatibleReasoningConfig(llm, config, signal) {
  if (!config || config.reasoningEffort === undefined || typeof llm.resolveModelInfo !== 'function') return config
  const info = await llm.resolveModelInfo(config.provider, config.model, signal)
  if (info?.reasoning?.efforts?.some(effort => effort.id === config.reasoningEffort)) return config
  const { reasoningEffort, ...compatible } = config
  return compatible
}
