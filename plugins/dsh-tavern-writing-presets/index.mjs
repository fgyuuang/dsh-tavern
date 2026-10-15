export const name = 'dsh-tavern-writing-presets'
export const inject = ['tavern']

export function apply(ctx) {
  if (ctx.tavern.writingPresets?.version !== 1) return
  ctx.tavern.handle('dsh-tavern-writing-presets/request', ({ method, args }) =>
    ctx.tavern.writingPresets.request(method, args))
}
