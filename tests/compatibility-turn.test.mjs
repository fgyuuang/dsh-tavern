import assert from 'node:assert/strict'
import test from 'node:test'
import { createCompatibilityTurnCompiler } from '../tavern-plugin/lib/domain/compatibility-turn.js'
import { inspectPreset } from '../tavern-plugin/lib/domain/preset-reading.js'
import { updateConversationPresetSettings } from '../tavern-plugin/lib/domain/conversation-preset-settings.js'
import { inspectWorldBookDocument } from '../tavern-plugin/lib/domain/worldbook-resource.js'

function fixture({ document, worldbook = { entries: {} }, chat = {} } = {}) {
  document ||= { prompts: [{ identifier: 'chatHistory', marker: true, role: 'system' }], prompt_order: [{ character_id: 100001, order: [{ identifier: 'chatHistory', enabled: true }] }] }
  const preset = inspectPreset(JSON.stringify(document), 'fixture.json')
  const snapshot = { presetPath: 'presets/fixture.json', presetName: '验证预设', digest: 'initial', compatibilityPreset: preset,
    compatibilityPresetDocument: structuredClone(document), front: { entries: preset.entries.filter(entry => entry.enabled && entry.injectable).map(entry => ({ id: entry.entryKey, ...entry })) },
    middle: { entries: [] }, back: { entries: [] }, regexScripts: [] }
  const state = { id: 'game', sessionId: 'session', cardPath: 'cards/fixture.png', messages: [], macroState: { userName: '玩家', local: {}, global: {} }, ...chat }
  let selected = snapshot
  const compile = createCompatibilityTurnCompiler({ str: value => value == null ? '' : String(value),
    readChatCard: async () => ({ name: '角色', description: '人物原文' }), readCardExtensions: async () => ({}),
    resolveChatRuntimePreset: async () => selected, readPromptTemplateGlobalVariables: async () => ({}),
    worldBooks: { bound: async () => ({ view: inspectWorldBookDocument(worldbook) }) },
    promptTemplateRuntime: async () => ({ initializeVariables: async (_entries, context) => ({ evaluated: 0, diagnostics: [], scopes: context.scopes }),
      renderMessages: async (messages, context) => ({ messages, evaluated: 0, diagnostics: [], scopes: context.scopes }) }) })
  return { compile: input => compile(state, input), state, snapshot, select: value => { selected = value } }
}

test('本局源设置、修改后的提示原文、条目开关和宏覆盖进入单次请求，原库不变', async () => {
  const document = { prompts: [
    { identifier: 'style', name: '文风', role: 'user', content: '原文 {{getvar::tone}} {{lastUserMessage}}' },
    { identifier: 'alternate', name: '备用文风', role: 'user', content: '备用规则' },
    { identifier: 'chatHistory', marker: true, role: 'system' }],
    prompt_order: [{ character_id: 100001, order: ['style', 'alternate', 'chatHistory'].map(identifier => ({ identifier, enabled: true })) }],
    temperature: 0.6, openai_max_tokens: 1200,
    extensions: { tavern_helper: { scripts: [{ type: 'script', data: { groups: [{ id: 'style-options', options: [
      { type: 'var_input', variable_id: 'tone', label: '语调' }] }] } }] } } }
  const f = fixture({ document }), original = structuredClone(f.snapshot)
  let changed = updateConversationPresetSettings(f.snapshot, { sourceAction: { groupId: 'style-options', optionId: 'var_input:tone', value: '温柔' } }, f.snapshot.digest)
  changed = updateConversationPresetSettings(changed, { entries: [{ key: 'style#1', enabled: true, content: '本局原文 {{getvar::tone}} {{lastUserMessage}}' },
    { key: 'alternate#1', enabled: false }], regexScripts: [] }, changed.digest)
  f.select(changed)
  const result = await f.compile('新的行动')
  assert.equal(result.messages[0].role, 'user')
  assert.match(result.messages[0].content, /本局原文 温柔 新的行动/)
  assert.doesNotMatch(result.messages.map(message => message.content).join('\n'), /备用规则|DSH剧情 Agent|sike_put_draft/)
  assert.deepEqual(result.generationOptions, { temperature: 0.6, maxTokens: 1200 })
  assert.equal(result.trace.postProcessing, 'none')
  assert.deepEqual(f.snapshot, original)
  assert.deepEqual(f.state.macroState.local, {})
})

test('单次世界书复用递归、次关键字与位置；MVU 规则不被后台所有权移除', async () => {
  const f = fixture({ document: { prompts: [
    { identifier: 'worldInfoBefore', marker: true, role: 'user' }, { identifier: 'worldInfoAfter', marker: true, role: 'user' },
    { identifier: 'chatHistory', marker: true, role: 'system' }], prompt_order: [{ character_id: 100001,
    order: ['worldInfoBefore', 'chatHistory', 'worldInfoAfter'].map(identifier => ({ identifier, enabled: true })) }] },
    worldbook: { recursive_scanning: true, entries: {
      0: { uid: 0, constant: true, content: 'Alice', position: 0 },
      1: { uid: 1, key: ['Alice'], content: '递归资料', position: 1 },
      2: { uid: 2, key: ['Alice'], keysecondary: ['missing'], selective: true, content: '不应激活', position: 1 },
      3: { uid: 3, constant: true, comment: '[mvu_update] 更新规则', content: '保留变量更新协议', position: 1 },
      4: { uid: 4, constant: true, content: '深度信息', position: 4, depth: 0, role: 2 } } },
    chat: { tavernScriptPrompts: [{ id: 'opening', content: '助手注入', role: 'user', depth: 1, position: 'in_chat', once: true }] } })
  const result = await f.compile('当前行动')
  const all = result.messages.map(message => message.content).join('\n')
  assert.match(all, /递归资料/)
  assert.match(all, /保留变量更新协议/)
  assert.doesNotMatch(all, /不应激活/)
  assert.ok(result.messages.some(message => message.role === 'assistant' && message.content.includes('深度信息')))
  assert.ok(result.messages.findIndex(message => message.content === '助手注入') < result.messages.findIndex(message => message.content === '当前行动'))
  assert.equal(f.state.tavernScriptPrompts.length, 1, '编译投影本身不消费 once 注入')
  assert.ok(result.trace.worldBookActivation.diagnostics.some(entry => entry.reason === 'selected'))
})
