import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createProjectAgentWorkspace, PROJECT_AGENT_MODES } from '../tavern-plugin/lib/domain/project-agent-workspace.js'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'
import { workspaceFiles } from '../plugins/dsh-tavern-project-agent/workspace-files.mjs'
import { createWritingPresetCatalog } from '../tavern-plugin/lib/domain/writing-preset-catalog.js'
import { listPlayPresets } from '../tavern-plugin/lib/domain/dream-sike-mode.js'
import { registerTurnLifecycleHooks } from '../tavern-plugin/lib/hooks/turn-lifecycle.js'

test('native workspace bootstrap preserves edited documents and session registration survives reload', async t => {
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'tavern-project-agent-'))
  t.after(() => rm(dataRoot, { recursive: true, force: true }))
  const native = { header: { cwd: dataRoot, agentPreset: 'tavern' }, events: [{ type: 'agent-preset/selected', data: { agentPreset: 'standard' } }] }
  const options = { dataRoot, store: createProfileDataStore({ dataRoot }), readSession: async () => native, readChat: async () => undefined }
  const api = createProjectAgentWorkspace(options), info = await api.request('info')
  assert.deepEqual(info.modes.map(row => row.id), ['standard', 'ptc', 'minimal', 'cordis'])
  const files = workspaceFiles(info)
  assert.equal((await api.request('initialize', { files })).created, files.length)
  await writeFile(path.join(info.root, 'AGENTS.md'), '用户维护的指令', 'utf8')
  assert.equal((await api.request('initialize', { files })).created, 0)
  assert.equal(await readFile(path.join(info.root, 'AGENTS.md'), 'utf8'), '用户维护的指令')
  await api.request('register', { sessionId: 'native', presetId: 'standard' })
  assert.equal((await createProjectAgentWorkspace(options).list())[0].mode, 'agent')
  await assert.rejects(api.request('register', { sessionId: 'native', presetId: 'cordis' }), /独立项目/)
  await assert.rejects(api.request('initialize', { files: [{ path: 'memory/../../escape.md', text: 'x' }] }), /Markdown/)
  const bound = createProjectAgentWorkspace({ ...options, readChat: async () => ({ mode: 'story' }) })
  await assert.rejects(bound.request('register', { sessionId: 'native', presetId: 'standard' }), /独立项目/)
})

test('native prompt, tools and completion bypass the play pipeline', async () => {
  const handlers = new Map(), assembly = { sections: [{ name: 'native', text: 'native persona' }], contexts: ['cwd'], tools: ['read', 'pwsh', 'skill', 'cordis_inspect_list', 'sike_read_turn', 'tavern_read_card', 'worldbook_search'].map(name => ({ name })) }
  registerTurnLifecycleHooks({ ctx: { on: (event, handler) => handlers.set(event, handler) },
    hookChatForSession: async () => undefined, chatForSession: async () => undefined,
    backgroundAgentRunner: { owns: () => false, requestContext: () => null },
    fullTemplateRuntime: { cancel() {} }, clearRuntimePresetRequestState() {},
    userMessageForTurn: () => ({ content: [{ type: 'text', text: '修改项目' }] }), contentText: () => '修改项目', requestIdForTurn: () => 'r',
    foregroundHandoff: { finalize() { throw new Error('native turn must not settle a story') } },
  })
  const agent = { session: { id: 'native', header: { agentPreset: 'standard' }, events: [] } }
  assert.equal(await handlers.get('system-prompt/assemble')({}, { agent }, async () => assembly), assembly)
  assert.equal(assembly.sections[0].text, 'native persona')
  assert.deepEqual(assembly.tools.map(tool => tool.name), ['read', 'pwsh', 'skill', 'cordis_inspect_list'])
  await handlers.get('agent/turn-stopping')({ agent, turn: 1 })
})

test('writing preset plugins register independently; unload preserves old settings and removes new selection', () => {
  const catalog = createWritingPresetCatalog(), chat = { playPresetId: 'dream-sike-dsh', runtimePresetSnapshot: { original: true } }
  const before = JSON.stringify(chat)
  const stop = catalog.register({ id: 'dream-sike-dsh', name: '梦境思客DSH', owner: 'dream-plugin' })
  catalog.register({ id: 'hushen-dsh', name: '狐神抚DSH', owner: 'fox-plugin' })
  assert.equal(listPlayPresets({ chat, providers: catalog.list() })[1].provider.name, 'dream-plugin')
  catalog.assertAvailable('dream-sike-dsh'); stop()
  assert.equal(listPlayPresets({ chat, providers: catalog.list() })[1].selected, true)
  assert.equal(listPlayPresets({ chat, providers: catalog.list() })[1].available, false)
  assert.throws(() => catalog.assertAvailable('dream-sike-dsh'), /未启用/)
  catalog.assertAvailable('hushen-dsh'); catalog.assertAvailable('tavern')
  assert.equal(JSON.stringify(chat), before)
  assert.equal(PROJECT_AGENT_MODES.length, 4)
})
