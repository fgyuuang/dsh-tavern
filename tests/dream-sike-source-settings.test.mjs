import assert from 'node:assert/strict'
import test from 'node:test'
import { dreamSikeSourceSettings, applyDreamSikeSourceAction } from '../tavern-plugin/lib/domain/dream-sike-source-settings.js'

function fixture() {
  const prompts = ['===文风===', '白话', '诗意', '===结束===', '官方', '禁词', '普通链', '专用链', 'MVU强制', 'MVU额外']
    .map((name, index) => ({ name, identifier: 'p' + index, content: index === 0 || index === 3 ? '' : `原文${name}` }))
  const groups = [
    { id: '文风', label: '文风', mode: 'single', options: [{ id: 'style', label: '{match}', type: 'between',
      match: { below: '/^===文风===$/', above: '/^===结束===$/' }, enable: ['{match}'] }] },
    { id: '模型', label: '模型', mode: 'single', disable_group: ['官方', '禁词', '专用链'], enable_group: ['普通链'], options: [
      { id: 'plain', label: '普通', enable: ['官方', '禁词'] },
      { id: 'deep', label: '专用', enable: ['官方', '专用链'], disable: ['普通链'] },
      { id: 'kimi', label: 'Kimi', enable: ['官方'], effect: ['kimi_partial_mode'] },
      { type: 'check_reasoner_format', label: '模型思考格式化' }] },
    { id: 'MVU', label: 'MVU', mode: 'multiple', options: [
      { id: 'main', label: 'MVU强制', enable: ['MVU强制'], disable: ['MVU额外'] },
      { id: 'extra', label: 'MVU额外', enable: ['MVU额外'], disable: ['MVU强制'] }] },
    { id: '变量', label: '变量', options: [{ id: 'role', label: '角色', type: 'var_input', variable_id: 'roleName' },
      { label: '字数', type: 'global_var_input', variable_id: 'wordCount' }] }
  ]
  return { compatibilityPresetDocument: { prompts, extensions: { tavern_helper: { scripts: [{ content: 'throw new Error("never execute")', data: { title: '原设置', groups } }] } } },
    compatibilityPreset: { entries: prompts.map((prompt, index) => ({ ...prompt, sourcePromptIndex: index, entryKey: prompt.identifier + '#1',
      injectable: !!prompt.content, enabled: [1, 4, 5, 6, 8].includes(index) })) }, front: { entries: [1, 4, 5, 6, 8].map(index => ({ id: 'p' + index + '#1' })) } }
}
const option = (view, group, id) => view.groups.find(item => item.id === group).options.find(item => item.id === id)
function apply(snapshot, action) {
  const result = applyDreamSikeSourceAction(snapshot, action, 'dream-sike-dsh')
  const active = new Set(snapshot.front.entries.map(entry => entry.id))
  result.entries.forEach(entry => entry.enabled ? active.add(entry.key) : active.delete(entry.key))
  return { ...snapshot, compatibilityPreset: { entries: snapshot.compatibilityPreset.entries.map(entry => ({ ...entry,
    enabled: result.entries.find(change => change.key === entry.entryKey)?.enabled ?? entry.enabled })) },
    front: { entries: [...active].map(id => ({ id })) }, sourceMacroOverrides: result.macroOverrides }
}
test('source groups dynamically expand original boundaries and expose verbatim prompts without running JS', () => {
  const snapshot = fixture(), before = JSON.stringify(snapshot)
  const view = dreamSikeSourceSettings(snapshot, 'dream-sike-dsh')
  assert.equal(view.title, '原设置')
  assert.deepEqual(view.groups[0].options.map(item => item.id), ['style:1', 'style:2'])
  assert.equal(option(view, '文风', 'style:1').prompts[0].content, '原文白话')
  assert.equal(option(view, '文风', 'style:1').enabled, true)
  assert.equal(option(view, '文风', 'style:2').enabled, false)
  assert.equal(JSON.stringify(snapshot), before)
  assert.equal('_enable' in view.groups[0].options[0], false)
})
test('single choices disable sibling enables and preserve unrelated prompts', () => {
  const next = apply(fixture(), { groupId: '文风', optionId: 'style:2' })
  const view = dreamSikeSourceSettings(next)
  assert.equal(option(view, '文风', 'style:1').enabled, false)
  assert.equal(option(view, '文风', 'style:2').enabled, true)
  assert.ok(next.front.entries.some(entry => entry.id === 'p8#1'))
})
test('single group reset precedes selected enable/disable; switching back restores default chain', () => {
  const first = apply(fixture(), { groupId: '模型', optionId: 'deep' })
  assert.equal(option(dreamSikeSourceSettings(first), '模型', 'deep').enabled, true)
  assert.ok(!first.front.entries.some(entry => entry.id === 'p6#1'))
  const next = apply(first, { groupId: '模型', optionId: 'plain' })
  assert.equal(option(dreamSikeSourceSettings(next), '模型', 'plain').enabled, true)
  assert.ok(next.front.entries.some(entry => entry.id === 'p6#1'))
  assert.ok(!next.front.entries.some(entry => entry.id === 'p7#1'))
})
test('multiple mutually exclusive options match original off behavior instead of enabling disabled peer', () => {
  let next = apply(fixture(), { groupId: 'MVU', optionId: 'extra', enabled: true })
  assert.equal(option(dreamSikeSourceSettings(next), 'MVU', 'extra').enabled, true)
  next = apply(next, { groupId: 'MVU', optionId: 'extra', enabled: false })
  assert.ok(!next.front.entries.some(entry => ['p8#1', 'p9#1'].includes(entry.id)))
})
test('variables preserve original scope and remain local to this snapshot including global macros', () => {
  const snapshot = fixture()
  let next = apply(snapshot, { groupId: '变量', optionId: 'role', value: '林然' })
  next = apply(next, { groupId: '变量', optionId: 'global_var_input:wordCount', value: '1800' })
  assert.deepEqual(next.sourceMacroOverrides, { local: { roleName: '林然' }, global: { wordCount: '1800' } })
  assert.equal(snapshot.sourceMacroOverrides, undefined)
  assert.equal(dreamSikeSourceSettings(next).groups[3].variableInputs[1].value, '1800')
})
test('host reasoning action is unavailable and Kimi effect is explicitly partial with selectable prompts', () => {
  const view = dreamSikeSourceSettings(fixture(), 'dream-sike-dsh')
  assert.equal(option(view, '模型', 'check_reasoner_format').available, false)
  assert.equal(option(view, '模型', 'check_reasoner_format').compatibility.status, 'unsupported')
  assert.equal(option(view, '模型', 'kimi').compatibility.status, 'partial')
  assert.match(option(view, '模型', 'kimi').compatibility.reason, /未实现.*kimi_partial_mode/)
  assert.doesNotThrow(() => apply(fixture(), { groupId: '模型', optionId: 'kimi' }))
})
test('missing boundary yields a visible unavailable item and cannot mutate partial configuration', () => {
  const snapshot = fixture()
  snapshot.compatibilityPresetDocument.prompts[3].name = 'missing'
  const view = dreamSikeSourceSettings(snapshot)
  assert.equal(view.groups[0].options.length, 1)
  assert.equal(view.groups[0].options[0].available, false)
  assert.match(view.errors[0], /结束标记/)
  assert.throws(() => apply(snapshot, { groupId: '文风', optionId: view.groups[0].options[0].id }), /不可用/)
})
test('conversation source flags take priority over compiled phases with fallback for older snapshots', () => {
  const snapshot = fixture()
  snapshot.compatibilityPreset.entries[1].enabled = false
  assert.equal(option(dreamSikeSourceSettings(snapshot), '文风', 'style:1').enabled, false)
  delete snapshot.compatibilityPreset.entries[1].enabled
  assert.equal(option(dreamSikeSourceSettings(snapshot), '文风', 'style:1').enabled, true)
  snapshot.front.entries = []
  assert.equal(option(dreamSikeSourceSettings(snapshot), '文风', 'style:1').enabled, false)
})
test('malformed, unknown and non-boolean actions fail atomically', () => {
  const snapshot = fixture(), before = JSON.stringify(snapshot)
  for (const action of [null, { groupId: 'unknown', optionId: 'x' }, { groupId: '文风', optionId: 'style:1', enabled: false },
    { groupId: '文风', optionId: 'style:1', enabled: 1 }, { groupId: '变量', optionId: 'role', value: 1 }]) {
    assert.throws(() => applyDreamSikeSourceAction(snapshot, action))
  }
  assert.equal(JSON.stringify(snapshot), before)
})
test('unrelated or absent preset helper returns empty source settings', () => {
  assert.deepEqual(dreamSikeSourceSettings(null).groups, [])
  assert.deepEqual(dreamSikeSourceSettings({ compatibilityPresetDocument: {} }).groups, [])
})
