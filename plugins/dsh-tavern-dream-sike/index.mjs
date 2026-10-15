export const name = 'dsh-tavern-dream-sike'
export const inject = ['tavern']
export function apply(ctx) {
  ctx.tavern.registerWritingPreset({ id: 'dream-sike-dsh', name: '梦境思客DSH',
    description: '梦境思客原作者规则与设置，支持酒馆直出及按需 Agent 写作；正文、记忆和状态由共享引擎管理。' })
}
