import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const start = source.indexOf('async function switchMode(nextMode)')
const end = source.indexOf('async function switchPlayRequestMode', start)
assert.ok(start >= 0 && end > start, 'Tavern workspace switch handler is available')
const handler = source.slice(start, end)

for (const initialSession of ['play-session', 'agent-session', undefined]) test(`Agent tab clears a foreign chat and preserves its own session (${initialSession || 'empty'})`, async () => {
  const actions = []
  const ids = ['agent-session']
  const context = vm.createContext({
    mainOpening: false,
    playPrewarmRef: { current: { cancel() { actions.push('cancel-prewarm') } } },
    setUiMode(mode) { actions.push(['mode', mode]) },
    setPicking(value) { actions.push(['picking', value]) },
    setMenuSession(value) { actions.push(['menu', value]) },
    extraWorkspaces: [{ id: 'agent', sessions: { getSnapshot: () => ids } }],
    current: initialSession,
    props: { sessions: { clear() { actions.push('clear-session') } } },
  })
  vm.runInContext(handler, context)
  await context.switchMode('agent')
  assert.deepEqual(actions.slice(0, 4), ['cancel-prewarm', ['mode', 'agent'], ['picking', false], ['menu', null]])
  assert.equal(actions.includes('clear-session'), initialSession !== 'agent-session')
})
