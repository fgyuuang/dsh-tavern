import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

test('switching into native Agent releases Tavern node overrides and switching back restores them', () => {
  let definition
  const source = readFileSync(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
    .replace('return module.exports;\n\t}', 'exports.__publishSessionMode = publishSessionMode;\nreturn module.exports;\n\t}')
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load: value => { definition = value } } }, console })
  const client = definition.factory(() => ({})), listeners = new Set(), entries = new Map()
  let current = 'native', stop
  const ctx = { sessions: { list: { getSnapshot: () => ({ current }), subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) } } },
    effect(run, label) { if (label.includes('scoped story renderers')) stop = run() } }
  const slots = { inject: (_name, run) => run(), register(options, component) { entries.set(options.key, component); return () => entries.delete(options.key) } }
  client.createTavernAssistantRendererFeatureModule().register({ ctx, slots })
  assert.equal(entries.size, 2)
  client.__publishSessionMode('native', 'agent')
  assert.equal(entries.size, 0, 'native keyed slots become active by normal priority election')
  current = 'story'; client.__publishSessionMode('story', 'story'); listeners.forEach(listener => listener())
  assert.equal(entries.size, 2)
  stop(); assert.equal(entries.size, 0); assert.equal(listeners.size, 0)
})
