import test from 'node:test'
import assert from 'node:assert/strict'

import { compileSillyTavernRequest, createCleanCompatibilityPreset, postProcessSillyTavernMessages, sillyTavernGenerationOptions } from '../tavern-plugin/lib/domain/sillytavern-compatibility.js'

function resolveMacros(text, context) {
  return { text: String(text).replaceAll('{{char}}', context.charName).replaceAll('{{user}}', context.macroState.userName), diagnostics: [], macroState: context.macroState }
}

test('对话示例只识别与当前玩家和角色名匹配的英文冒号前缀', () => {
  const mismatch = compileSillyTavernRequest({
    card: { name: '角色', mes_example: '玩家：不应进入\n角色：也不应进入' },
    preset: { entries: [
      { entryKey: 'examples#1', identifier: 'dialogueExamples', marker: true, role: 'system', content: '', enabled: true, ordered: true }
    ] },
    presetDocument: { new_example_chat_prompt: '[开始示例]' }, userName: '你', resolveMacros
  })
  assert.deepEqual(mismatch.messages, [])

  const matched = compileSillyTavernRequest({
    card: { name: '角色', mes_example: '你: 问候\n角色: 回答' },
    preset: { entries: [
      { entryKey: 'examples#1', identifier: 'dialogueExamples', marker: true, role: 'system', content: '', enabled: true, ordered: true }
    ] },
    presetDocument: { new_example_chat_prompt: '[开始示例]' }, userName: '你', resolveMacros
  })
  assert.deepEqual(matched.messages.map(function (item) { return [item.role, item.name || '', item.content] }), [
    ['system', '', '[开始示例]'],
    ['system', 'example_user', '问候'],
    ['system', 'example_assistant', '回答']
  ])
})

test('兼容编译保留历史图片和本轮纯图片输入，严格角色合并也不丢附件', async () => {
  const { applySillyTavernStrictTools } = await import('../tavern-plugin/lib/domain/sillytavern-strict-tools.js')
  const oldImage = { type: 'image', attachment: { id: 'old-photo' } }
  const newImage = { type: 'image', attachment: { id: 'new-photo' } }
  const result = compileSillyTavernRequest({
    card: { name: '角色' }, preset: createCleanCompatibilityPreset(), presetDocument: {},
    history: [{ role: 'user', text: '看图', inputAttachments: [oldImage] }, { role: 'assistant', text: '好的' }],
    input: '', inputAttachments: [newImage], resolveMacros
  })
  assert.deepEqual(result.messages.flatMap(message => message.inputAttachments || []), [oldImage, newImage])
  const merged = applySillyTavernStrictTools([
    { role: 'user', content: '第一张', inputAttachments: [oldImage] },
    { role: 'user', content: '', inputAttachments: [newImage] }
  ])
  assert.deepEqual(merged[0].inputAttachments, [oldImage, newImage])
})

const entry = (identifier, content, overrides = {}) => ({ entryKey: identifier + '#1', identifier, content,
  role: 'system', marker: false, enabled: true, ordered: true, ...overrides })

test('人物卡和世界书 marker 继承源预设角色，保留原文顺序及 wi_format', () => {
  const result = compileSillyTavernRequest({ card: { name: '角色', description: '人物资料', personality: '谨慎', scenario: '重逢' },
    preset: { entries: [entry('before', '前置'), entry('charDescription', '', { marker: true, role: 'user' }),
      entry('worldInfoBefore', '', { marker: true, role: 'assistant' }), entry('charPersonality', '', { marker: true, role: 'user' }),
      entry('scenario', '', { marker: true, role: 'user' }), entry('chatHistory', '', { marker: true }), entry('after', '后置', { role: 'assistant' })] },
    presetDocument: { wi_format: '<lore>{0}</lore>', personality_format: '性格：{{personality}}', scenario_format: '场景：{{scenario}}' },
    worldInfoBefore: '世界资料', history: [{ role: 'assistant', text: '旧回复' }], input: '新行动', resolveMacros })
  assert.deepEqual(result.messages.map(message => [message.role, message.content]), [
    ['system', '前置'], ['user', '人物资料'], ['assistant', '<lore>世界资料</lore>'], ['user', '性格：谨慎'],
    ['user', '场景：重逢'], ['assistant', '旧回复'], ['user', '新行动'], ['assistant', '后置']])
})

test('绝对注入与 marker 按原始楼层深度分组，相同深度遵循原版优先级及角色顺序', () => {
  const result = compileSillyTavernRequest({ card: { description: '卡面资料' }, preset: { entries: [
    entry('chatHistory', '', { marker: true }), entry('low', '低优先级', { injectionPosition: 1, injectionDepth: 0, injectionOrder: 20, role: 'user' }),
    entry('high-system', '系统高优先级', { injectionPosition: 1, injectionDepth: 0, injectionOrder: 100 }),
    entry('high-user', '玩家高优先级', { injectionPosition: 1, injectionDepth: 0, injectionOrder: 100, role: 'user' }),
    entry('charDescription', '', { marker: true, injectionPosition: 1, injectionDepth: 1, injectionOrder: 100, role: 'assistant' }),
    entry('deep', '更早的注入', { injectionPosition: 1, injectionDepth: 2, injectionOrder: 0 })] },
    history: [{ role: 'user', text: '第一层' }, { role: 'assistant', text: '第二层' }], input: '第三层', resolveMacros })
  assert.deepEqual(result.messages.map(message => message.content), ['第一层', '更早的注入', '第二层', '卡面资料', '第三层', '低优先级', '玩家高优先级', '系统高优先级'])
  assert.equal(result.messages.find(message => message.content === '卡面资料').role, 'assistant')
})

test('新聊天标记、空输入替换和 assistant prefill 只在各自接点插入', () => {
  const preset = createCleanCompatibilityPreset()
  const result = compileSillyTavernRequest({ card: { name: '角色' }, preset,
    presetDocument: { new_chat_prompt: '新局 {{char}}', send_if_empty: '请继续', assistant_prefill: '开始：' },
    history: [{ role: 'assistant', text: '开场' }], input: '', resolveMacros })
  assert.deepEqual(result.messages.map(message => [message.role, message.content]), [
    ['system', '新局 角色'], ['assistant', '开场'], ['user', '请继续'], ['assistant', '开始：']])
  const withInput = compileSillyTavernRequest({ preset, presetDocument: { send_if_empty: '不应插入' },
    history: [{ role: 'assistant', text: '开场' }], input: '玩家行动', resolveMacros })
  assert.ok(!withInput.messages.some(message => message.content === '不应插入'))
})

test('尊重源预设后处理，system squash 不跨新聊天边界或示例名', () => {
  const messages = [{ role: 'system', content: '一' }, { role: 'system', content: '二' },
    { role: 'system', content: '新局', source: { identifier: 'newMainChat' } }, { role: 'system', content: '示例', name: 'example_user' },
    { role: 'assistant', content: '正文' }, { role: 'system', content: '末尾系统' }]
  assert.deepEqual(postProcessSillyTavernMessages(messages).map(message => message.role), messages.map(message => message.role))
  const squashed = postProcessSillyTavernMessages(messages, { squash_system_messages: true })
  assert.deepEqual(squashed.map(message => message.content), ['一\n二', '新局', '示例', '正文', '末尾系统'])
  const strict = postProcessSillyTavernMessages(messages, { custom_prompt_post_processing: 'strict_tools' }, { userName: '玩家', charName: '角色' })
  assert.ok(strict.slice(1).every(message => message.role !== 'system'))
  const semi = postProcessSillyTavernMessages([{ role: 'system', content: '一' }, { role: 'system', content: '二' },
    { role: 'assistant', content: '正文' }, { role: 'system', content: '末尾' }, { role: 'user', content: '继续' }], { custom_prompt_post_processing: 'semi' })
  assert.deepEqual(semi.map(message => [message.role, message.content]), [['system', '一\n\n二'], ['assistant', '正文'], ['user', '末尾\n\n继续']])
  assert.ok(postProcessSillyTavernMessages(messages, { custom_prompt_post_processing: 'single' }, { userName: '玩家', charName: '角色' }).every(message => message.role === 'user'))
  assert.throws(() => postProcessSillyTavernMessages(messages, { custom_prompt_post_processing: 'unknown' }), /尚不支持/)
  assert.equal(messages[0].content, '一')
})

test('只映射当前宿主支持的源采样参数，保留不支持字段供诊断', () => {
  const result = sillyTavernGenerationOptions({ temperature: 0, openai_max_tokens: 30000, reasoning_effort: 'high', top_p: 0.95, frequency_penalty: 0.2, seed: 42 })
  assert.deepEqual(result.generationOptions, { temperature: 0, maxTokens: 30000, reasoningEffort: 'high' })
  assert.equal(result.sourceGenerationOptions.top_p, 0.95)
  assert.deepEqual(result.diagnostics[0].fields, ['top_p', 'frequency_penalty', 'seed'])
  assert.deepEqual(sillyTavernGenerationOptions({ temperature: Infinity, openai_max_tokens: -2 }).generationOptions, {})
})
