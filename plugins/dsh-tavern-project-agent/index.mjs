import { workspaceFiles } from './workspace-files.mjs'
import { readFile } from 'node:fs/promises'
export const name = 'dsh-tavern-project-agent'
export const inject = ['tavern']
export async function apply(ctx) {
  if (ctx.tavern.projectAgents?.version !== 1) throw new Error('项目 Agent 插件需要支持 projectAgents v1 的 Tavern')
  const info = await ctx.tavern.projectAgents.request('info')
  const css = await readFile(new URL('./assets/workspace.css', import.meta.url), 'utf8')
  await ctx.tavern.projectAgents.request('initialize', { files: workspaceFiles(info) })
  ctx.tavern.handle('dsh-tavern-project-agent/request', ({ method, args }) => method === 'stylesheet' ? { css } : ctx.tavern.projectAgents.request(method, args))
}
