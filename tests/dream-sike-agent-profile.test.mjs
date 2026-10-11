import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDreamSikeAgentProfile, readDreamSikeAgentRules } from '../tavern-plugin/lib/domain/dream-sike-agent-profile.js'

const chain = '0da6f4d7-961d-4966-a084-857a3dd876ad'
const persona = '06b5771b-109d-47b1-94d0-8bbc805bc15e'
const sourceOption = (id, enabled = false) => ({ id, label: id, enabled, compatibility: { status: 'supported', label: '原文启用' }, prompts: [{ key: id + '#1' }] })
function snapshot(content = '作者原句：角色只能知道亲历信息。') {
  return { front: { entries: [{ id: 'style#1', content, name: '文风', source: { identifier: 'style' } },
    { id: chain + '#1', content: '作者检设定、辨视角、遵写规、演叙事。', name: '默认思维链', source: { identifier: chain } }] },
    compatibilityPreset: { entries: [{ entryKey: 'style#1', identifier: 'style' }] } }
}
test('six native stages map source groups and split options by original identifiers with complete coverage', () => {
  const sourceSettings = { errors: [], groups: [
    { id: '角色设定', options: [sourceOption('role')], variableInputs: [{ id: 'customRole' }] },
    { id: '文风设置', options: [sourceOption('style', true)], variableInputs: [] },
    { id: '字数要求', options: [sourceOption('length')], variableInputs: [{ id: 'customLength' }] },
    { id: '其他选开设置', options: [sourceOption('21837143-741e-4cc8-8107-b26acacfdee6'), sourceOption('43f8a625-93e6-46c0-9c20-b635c57e3b19'),
      sourceOption('4e26a3ac-4d46-45ed-85bf-0110fbe06cd2')], variableInputs: [] }
  ] }
  const view = buildDreamSikeAgentProfile(snapshot(), 'dream-sike-dsh', { sourceSettings })
  assert.equal(view.stages.length, 6)
  assert.equal(view.enabled, true)
  assert.equal(view.coverage.complete, true)
  assert.equal(view.coverage.mappedOptionCount, 6)
  assert.equal(view.coverage.mappedVariableCount, 2)
  assert.equal(view.stages.find(stage => stage.id === 'model').optionIds[0].optionId, '21837143-741e-4cc8-8107-b26acacfdee6')
  assert.ok(view.stages.find(stage => stage.id === 'planning').authorRuleIds.some(rule => rule.identifier === chain))
  assert.equal(view.stages.find(stage => stage.id === 'narration').activeOptions[0].optionId, 'style')
  assert.deepEqual(view.stages[0].variableIds, [{ groupId: '角色设定', inputId: 'customRole' }])
})
test('unknown source option is reported without invented semantic classification', () => {
  const view = buildDreamSikeAgentProfile(snapshot(), 'tavern', { sourceSettings: { errors: [], groups: [
    { id: '未知作者分组', options: [sourceOption('unknown')], variableInputs: [] }] } })
  assert.equal(view.enabled, false)
  assert.equal(view.coverage.complete, false)
  assert.equal(view.coverage.unmappedOptions[0].optionId, 'unknown')
  assert.match(view.errors[0], /未归入/)
})
test('duplicate option identities are reported rather than claimed as complete coverage', () => {
  const view = buildDreamSikeAgentProfile(snapshot(), 'dream-sike-dsh', { sourceSettings: { errors: [], groups: [
    { id: '文风设置', options: [sourceOption('style'), sourceOption('style')], variableInputs: [] }] } })
  assert.equal(view.coverage.complete, false)
  assert.equal(view.coverage.duplicateOptions.length, 1)
})
test('rules reader returns resolved author prose, source and resolved hashes, and never actual chat reasoning', () => {
  const raw = snapshot('{{setvar::style::作者原句不改写}}采用：{{getvar::style}}')
  const chat = { runtimePresetSnapshot: raw, privateReasoning: 'secret-hidden-process', messages: [{ content: 'private chat text' }] }
  const before = JSON.stringify(chat)
  const page = readDreamSikeAgentRules(chat)
  assert.match(page.rules[0].content, /采用：作者原句不改写/)
  assert.equal(page.rules[0].sourceHash.length, 64)
  assert.equal(page.rules[0].resolvedHash.length, 64)
  assert.notEqual(page.rules[0].sourceHash, page.rules[0].resolvedHash)
  assert.doesNotMatch(JSON.stringify(page), /secret-hidden-process|private chat text/)
  assert.equal(JSON.stringify(chat), before)
})
test('long rule chunks obey total character budget and reassemble exact authored content', () => {
  const content = '作者原文。'.repeat(4000)
  const chat = { runtimePresetSnapshot: snapshot(content) }
  let offset = 0, contentOffset = 0, rebuilt = '', calls = 0
  do {
    const page = readDreamSikeAgentRules(chat, { offset, contentOffset, limit: 1, maxChars: 3000 })
    assert.ok(page.characters <= 3000)
    assert.ok(page.rules[0].content.length <= 3000)
    if (page.rules[0].key === 'style#1') rebuilt += page.rules[0].content
    offset = page.nextOffset; contentOffset = page.nextContentOffset
    calls++
    if (!page.hasMore) break
  } while (calls < 20)
  assert.equal(rebuilt, content)
  assert.ok(calls > 1)
})
test('original persona priority declarations are excluded from Agent reader while snapshot remains intact', () => {
  const raw = snapshot()
  raw.front.entries.unshift({ id: persona + '#1', source: { identifier: persona }, content: '原文解除限制声明', name: '梦鲸思客' })
  const page = readDreamSikeAgentRules({ runtimePresetSnapshot: raw })
  assert.doesNotMatch(JSON.stringify(page.rules), /原文解除限制声明/)
  assert.equal(page.excluded[0].identifier, persona)
  assert.equal(raw.front.entries[0].content, '原文解除限制声明')
})
test('explicit source macro overrides and contextual user name resolve sequentially', () => {
  const raw = snapshot('采用{{getglobalvar::wordCount}}字；{{getvar::roleName}}。')
  raw.sourceMacroOverrides = { local: { roleName: '林然' }, global: { wordCount: '1800' } }
  const page = readDreamSikeAgentRules({ runtimePresetSnapshot: raw, macroState: { local: { roleName: '旧角色' } } })
  assert.match(page.rules[0].content, /1800字；林然/)
})
test('pagination rejects invalid bounds and reports stable digest changes with selected prose', () => {
  const chat = { runtimePresetSnapshot: snapshot() }
  for (const request of [{ offset: -1 }, { limit: 0 }, { limit: 11 }, { maxChars: 12001 }, { offset: 100 }, { contentOffset: 999999 }]) {
    assert.throws(() => readDreamSikeAgentRules(chat, request), /分页/)
  }
  const first = readDreamSikeAgentRules(chat)
  chat.runtimePresetSnapshot.front.entries[0].content += '新规则。'
  assert.notEqual(readDreamSikeAgentRules(chat).resolvedDigest, first.resolvedDigest)
})
