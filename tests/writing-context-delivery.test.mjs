import test from 'node:test'
import assert from 'node:assert/strict'
import { confirmWritingRuleDelivery } from '../tavern-plugin/lib/domain/writing-context-delivery.js'
import { registerDreamSikeTools } from '../tavern-plugin/lib/tools/dream-sike.js'

const rules = [{ id: 'r1', name: '第一部分', content: '原作者人物与视角规则。'.repeat(1500) }, { id: 'r2', name: '第二部分', content: '原作者文风与格式规则。'.repeat(1500) }]
const base = { id: 'c', sessionId: 's', mode: 'story', playPresetId: 'dream-sike-dsh', cardName: '测试卡', variables: {}, messages: [],
  runtimePresetSnapshot: { front: { entries: rules } },
  timeline: { branchId: 'b', revision: 4, operations: { op: { id: 'op', kind: 'body', status: 'running', turn: 2, basedOn: { branchId: 'b', revision: 4 }, userText: '玩家行动' } } } }

async function read(args, proof, withDraft = false) {
  const chat = structuredClone(base), tools = new Map()
  if (withDraft) chat.dreamSikeDraft = { chatId: 'c', sessionId: 's', branchId: 'b', operationId: 'op', turn: 2, storyRevision: 4, text: '未提交长篇正文。'.repeat(3000), version: 1, status: 'draft', revisionCount: 0 }
  registerDreamSikeTools({ tools: { register: tool => tools.set(tool.name, tool) }, chatForSession: async () => chat,
    updateChat: async (_id, change) => change(chat), activeTurnOf: () => 2,
    requestCoordinates: new Map([['s', { authorRuleDelivery: proof }]]) })
  const output = await tools.get('sike_read_turn').execute(args, { agent: { session: { id: 's' }, phase: { turn: 2, step: 1 } } })
  return { ...output, parsed: JSON.parse(output.report), receipt: chat.dreamSikePreparation }
}
function proof(contents = rules.map(rule => rule.content)) {
  return confirmWritingRuleDelivery({ messages: [{ role: 'system', content: contents.map(text => ({ type: 'text', text })) }] }, base.runtimePresetSnapshot, { turn: 2, step: 1 })
}

test('exact current-request author injection avoids duplicate text and pagination without dropping source coverage', async () => {
  const automatic = await read({}, proof()), explicit = await read({ includeRules: true }, proof())
  assert.equal(automatic.parsed.presetRules.delivery, 'current-model-request')
  assert.equal(automatic.parsed.presetRules.hasMore, false)
  assert.ok(automatic.parsed.presetRules.rules.every(rule => rule.content === undefined))
  assert.equal(automatic.parsed.presetRules.omittedCharacters, rules.reduce((sum, rule) => sum + rule.content.length, 0))
  assert.ok(automatic.report.length < explicit.report.length * 0.45)
  assert.ok(automatic.receipt.queriesCompleteAt)
  assert.deepEqual(automatic.receipt.servedRuleIds, ['r1', 'r2'])
  assert.ok(explicit.parsed.presetRules.rules.some(rule => rule.content.length > 10000))
  assert.equal(explicit.parsed.presetRules.hasMore, true)
})

test('stale, missing, partial or changed request evidence returns author text', async () => {
  for (const evidence of [null, { ...proof(), step: 2 }, { ...proof(), turn: 1 }, proof([rules[0].content]), proof(['改写后的摘要'])]) {
    const result = await read({}, evidence)
    assert.ok(result.parsed.presetRules.rules.some(rule => typeof rule.content === 'string' && rule.content.length > 10000))
    assert.notEqual(result.parsed.presetRules.delivery, 'current-model-request')
  }
})

test('reading or omitting a long draft never returns a second full-body copy', async () => {
  const result = await read({ includeRules: false, includeMaterials: false }, null, true)
  assert.ok(result.parsed.draft.text.length > 1000)
  assert.equal(result.draft.text, undefined)
  const omitted = await read({ includeRules: false, includeMaterials: false, includeDraft: false }, null, true)
  assert.equal(omitted.parsed.draft, null)
  assert.equal(omitted.draft.text, undefined)
})
