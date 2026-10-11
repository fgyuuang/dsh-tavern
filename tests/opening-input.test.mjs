import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
const source = await readFile(new URL('../tavern-plugin/src/client/modules/opening-input.js', import.meta.url), 'utf8')
const api = vm.runInNewContext(source + ';({openingPickerInput,updateOpeningPickerInput})')
test('准备页输入只绑定本开场，切换和过期回调不串写，允许清空草稿', () => {
  const picker = { openings: [{ id: 'A' }, { id: 'B' }], index: 0 }
  const first = api.updateOpeningPickerInput(picker, 'A', '第一份开局\n可编辑')
  assert.equal(api.openingPickerInput(first, 'A'), '第一份开局\n可编辑')
  assert.equal(api.openingPickerInput(first, 'B'), '')
  assert.equal(api.updateOpeningPickerInput(first, 'B', '过期'), first)
  const changed = { ...first, index: 1 }
  assert.equal(api.updateOpeningPickerInput(changed, 'A', '失效'), changed)
  const second = api.updateOpeningPickerInput(changed, 'B', '')
  assert.equal(api.openingPickerInput(second, 'B'), '')
  assert.equal(api.openingPickerInput(second, 'A'), '')
  assert(!Object.hasOwn(picker, 'preparedInput'))
})
test('生产准备页转交草稿到显式创建入口，展示和 iframe 回调保持配对', async () => {
  const sidebar = await readFile(new URL('../tavern-plugin/src/client/features/sidebar.js', import.meta.url), 'utf8')
  assert.match(sidebar, /initialMessage = openingPickerInput\(previousOpeningPicker, openingId\)/)
  assert.match(sidebar, /selectedOpening \? h\(TavernOpeningInput/)
  assert.match(sidebar, /onDraftOpening: function \(text\)/)
  const lifecycle = await readFile(new URL('../tavern-plugin/src/client/runtime/message-frame-lifecycle.js', import.meta.url), 'utf8')
  assert.match(lifecycle, /return props\.onDraftOpening\(text\)/)
})
