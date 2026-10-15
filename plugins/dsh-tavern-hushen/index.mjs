export const name = 'dsh-tavern-hushen'
export const inject = ['tavern']
export function apply(ctx) {
  ctx.tavern.registerWritingPreset({ id: 'hushen-dsh', name: '狐神抚DSH',
    description: '狐神抚原作者规则与设置，支持酒馆直出及按需 Agent 写作；正文、记忆和状态由共享引擎管理。' })
}
