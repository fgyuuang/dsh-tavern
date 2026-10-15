import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { createWritingPresetExtension } from '../tavern-plugin/lib/domain/writing-preset-extension.js'
import { apply } from '../plugins/dsh-tavern-writing-presets/index.mjs'

test('writing extension exposes only whitelisted actions and a narrow session view', async () => {
  const calls = []
  const api = createWritingPresetExtension({ dispatch: async (method, args) => { calls.push({ method, args }); return { ok: true } },
    readView: async id => ({ mode: 'story', playPresetId: 'dream-sike-dsh', sessionId: id }) })
  assert.equal(api.version, 1)
  const args = { sessionId: 'game', generationMode: 'sillytavern-once' }
  await api.request('setGenerationMode', args)
  assert.deepEqual(calls[0], { method: 'setGenerationMode', args })
  assert.notEqual(calls[0].args, args)
  assert.deepEqual(await api.request('getSession', { sessionId: 'game' }), { view: { mode: 'story', playPresetId: 'dream-sike-dsh', sessionId: 'game' } })
  await assert.rejects(api.request('deleteChat', { sessionId: 'game' }), /不支持/)
  await assert.rejects(api.request('getSession', {}), /会话/)
  await assert.rejects(api.request('listPlayPresets', []), /对象/)
})

test('independent plugin registers one owned handler and skips unsupported hosts', async () => {
  const handlers = []
  apply({ tavern: { writingPresets: null, handle() { throw Error('must not register') } } })
  apply({ tavern: { writingPresets: { version: 1, request: async (method, args) => ({ method, args }) },
    handle: (name, handler) => handlers.push({ name, handler }) } })
  assert.equal(handlers.length, 1)
  assert.equal(handlers[0].name, 'dsh-tavern-writing-presets/request')
  assert.deepEqual(await handlers[0].handler({ method: 'listPlayPresets', args: {} }), { method: 'listPlayPresets', args: {} })
})

test('independent browser plugin owns the native slot override and releases it on unload', async () => {
  const source = await readFile(new URL('../plugins/dsh-tavern-writing-presets/client.js', import.meta.url), 'utf8')
  let module
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load: value => { module = value } } } })
  const plugin = module.factory(() => ({}))
  assert.equal(module.id, 'dsh-tavern-writing-presets')
  const disposers = [], nodes = [], records = []
  const document = { createElement: () => ({ remove() { nodes.pop() } }), head: { append: node => nodes.push(node) } }
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load: value => { module = value } } }, document })
  const active = module.factory(() => ({}))
  active.apply({ tavernUi: { writingPresets: { version: 1 }, assetUrl: path => path },
    slots: { inject: (_name, register) => register(), register: (descriptor, component) => { records.push(descriptor); return () => records.pop() } },
    effect: register => disposers.push(register()) })
  assert.equal(records[0].id, 'dsh-tavern-composer-preset')
  assert.equal(records[0].priority, -1)
  assert.equal(nodes.length, 1)
  disposers.reverse().forEach(dispose => dispose())
  assert.equal(nodes.length, 0)
  assert.equal(records.length, 0)
  assert.doesNotMatch(source, /fetch\(|querySelector|useTavernSessionMode|notifyTavernDataChanged|tavernCoordination|agentWorkbenchFeature/)
})
