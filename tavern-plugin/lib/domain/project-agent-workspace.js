import path from 'node:path'
import { mkdir, writeFile, lstat } from 'node:fs/promises'
import { sessionEvents } from './session-events.js'

export const PROJECT_AGENT_MODES = Object.freeze([
  { id: 'standard', name: '标准模式', description: '原生文件、Shell、检索、Skills、计划与子代理。' },
  { id: 'ptc', name: 'PTC 模式', description: '用程序组合原生工具，适合批量检查与处理。' },
  { id: 'minimal', name: '极简模式', description: '使用原生持久 Shell，减少工具与上下文开销。' },
  { id: 'cordis', name: '创造模式', description: '原生运行时检查、插件开发与 Agent 预设创作。' },
])
const modes = new Set(PROJECT_AGENT_MODES.map(mode => mode.id))
const registryPath = 'project-agent-sessions.json'

/** Native sessions have their own registry; they are never adopted as story/card chats. */
export function createProjectAgentWorkspace({ dataRoot, store, readSession, readChat }) {
  const root = path.resolve(dataRoot, 'project-workspace')
  async function list() { return (await store.readJson(registryPath))?.sessions || [] }
  async function initialize(files) {
    if (!Array.isArray(files) || files.length > 20) throw new Error('项目工作区文件清单无效')
    const prepared = files.map(file => {
      if (!file || typeof file.path !== 'string' || !/^(?:AGENTS\.md|PROJECT\.md|memory\/[a-zA-Z0-9._/-]+\.md|\.agents\/skills\/[a-z0-9-]+\/SKILL\.md)$/.test(file.path)
        || file.path.split('/').includes('..') || typeof file.text !== 'string' || file.text.length > 64000) throw new Error('项目工作区只接受受支持的 Markdown 文档')
      return { ...file, target: path.resolve(root, file.path) }
    })
    let created = 0
    for (const file of prepared) {
      for (let cursor = path.dirname(file.target); cursor; cursor = path.dirname(cursor)) {
        const entry = await lstat(cursor).catch(error => { if (error.code !== 'ENOENT') throw error })
        if (entry?.isSymbolicLink()) throw new Error('项目工作区不写入重解析目录')
        if (cursor === path.dirname(cursor)) break
      }
      await mkdir(path.dirname(file.target), { recursive: true })
      try { await writeFile(file.target, file.text, { encoding: 'utf8', flag: 'wx' }); created++ }
      catch (error) { if (error.code !== 'EEXIST') throw error }
    }
    return { root, created }
  }
  async function request(method, args = {}) {
    if (method === 'info') return { root, resourceRoot: path.resolve(dataRoot, 'resources'), pluginRoot: path.resolve(dataRoot, 'plugins'), modes: PROJECT_AGENT_MODES }
    if (method === 'list') return { sessions: await list() }
    if (method === 'initialize') return initialize(args.files)
    if (method === 'register') {
      const sessionId = args.sessionId, session = typeof sessionId === 'string' && await readSession(sessionId)
      const selectedPreset = session && (sessionEvents(session).findLast(event => event.type === 'agent-preset/selected')?.data?.agentPreset || session.header?.agentPreset)
      if (!session || !modes.has(args.presetId) || selectedPreset !== args.presetId || session.header?.parentSession || await readChat(sessionId)) throw new Error('只能登记使用原生四模式的独立项目 Session')
      const cwd = session.header.cwd
      if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) throw new Error('项目 Session 缺少有效工作目录')
      const row = { sessionId, mode: 'agent', nativePresetId: args.presetId, path: cwd, title: PROJECT_AGENT_MODES.find(mode => mode.id === args.presetId).name, createdAt: Date.now() }
      await store.updateJson(registryPath, current => ({ version: 1, sessions: [...(current?.sessions || []).filter(item => item.sessionId !== sessionId), row] }))
      return { session: row }
    }
    if (method === 'forget') {
      await store.updateJson(registryPath, current => ({ version: 1, sessions: (current?.sessions || []).filter(item => item.sessionId !== args.sessionId) }))
      return { removed: true }
    }
    throw new Error('未知的项目 Agent 操作')
  }
  return Object.freeze({ version: 1, request, list })
}
