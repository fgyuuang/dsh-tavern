import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

async function registry() {
  const source = await readFile(new URL('../tavern-plugin/src/client/features/plugin-extensions.js', import.meta.url), 'utf8')
  const start = source.indexOf('function createTavernUiExtensions()')
  const end = source.indexOf('const tavernUiExtensions =', start)
  return vm.runInNewContext(source.slice(start, end) + '\ncreateTavernUiExtensions()')
}

test('workbench modules register dynamically, sort and dispose with their plugin', async () => {
  const r = await registry(), cleanup = [], notices = []
  r.service.ctx = { fiber: { name: 'author-tools' }, effect(register) { const dispose = register(); cleanup.push(dispose); return dispose } }
  const unsubscribe = r.subscribe(() => notices.push(r.getSnapshot()))
  const component = () => null
  r.service.registerWorkbenchPanel({ id: 'author/second', label: '第二', order: 20, component })
  r.service.registerWorkbenchPanel({ id: 'author/first', label: '第一', order: 10, component })
  assert.equal(r.service.apiVersion, 2)
  assert.equal(r.workbenchPanels().map(panel => panel.id).join(','), 'author/first,author/second')
  assert.equal(r.workbenchPanels()[0].owner, 'author-tools')
  assert.throws(() => r.service.registerWorkbenchPanel({ id: 'author/first', label: '重复', component }), /已注册/)
  cleanup.forEach(dispose => dispose())
  assert.equal(r.workbenchPanels().length, 0)
  assert.equal(notices.length, 4)
  cleanup.forEach(dispose => dispose())
  assert.equal(notices.length, 4, 'duplicate cleanup is harmless')
  unsubscribe()
})

test('module validation keeps malformed registrations from breaking existing UI actions', async () => {
  const r = await registry(), component = () => null
  for (const value of [null, { id: 'bad', label: '坏', component }, { id: 'author/panel', label: '', component },
    { id: 'author/panel', label: '无组件' }, { id: 'author/panel', label: '坏条件', component, when: true }]) {
    assert.throws(() => r.service.registerWorkbenchPanel(value))
  }
  const removeAction = r.service.registerComposerAction({ id: 'old-api', label: '原动作', run() {} })
  const removePanel = r.service.registerWorkbenchPanel({ id: 'author/panel', label: '文风', component })
  assert.equal(r.composerActions().length, 1)
  removePanel()
  assert.equal(r.composerActions().length, 1)
  removeAction()
  assert.equal(r.composerActions().length, 0)
})
