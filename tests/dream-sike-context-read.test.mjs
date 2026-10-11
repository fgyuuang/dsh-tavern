import assert from 'node:assert/strict'
import test from 'node:test'
import { registerDreamSikeTools } from '../tavern-plugin/lib/tools/dream-sike.js'

test('规则续页不重发材料与草稿，草稿续读不重发规则，完整补读仍恢复原文', async () => {
  const chat = { id: 'c', sessionId: 's', mode: 'story', playPresetId: 'dream-sike-dsh', cardName: '测试卡', variables: { hp: 10 },
    preparedWorldBookContext: '本局世界书材料'.repeat(350), posture: '人物站在门口。',
    messages: [{ role: 'assistant', turn: 1, text: '历史材料。'.repeat(180) }],
    runtimePresetSnapshot: { front: { entries: [{ id: 'rule1', name: '作者规则1', content: '作者规则甲。'.repeat(1600) }, { id: 'rule2', name: '作者规则2', content: '作者规则乙。'.repeat(1600) }] } },
    timeline: { branchId: 'b', revision: 4, operations: { op: { id: 'op', kind: 'body', status: 'running', turn: 2, basedOn: { branchId: 'b', revision: 4 }, userText: '玩家行动。'.repeat(250) } } } }
  chat.dreamSikeDraft = { chatId: 'c', sessionId: 's', branchId: 'b', operationId: 'op', turn: 2, storyRevision: 4, text: '草稿。'.repeat(2200), version: 1, status: 'draft', revisionCount: 0 }
  const tools = new Map(), exec = { agent: { session: { id: 's' }, phase: { turn: 2 } } }
  registerDreamSikeTools({ tools: { register(tool) { tools.set(tool.name, tool) } }, chatForSession: async () => chat, updateChat: async () => { throw Error('只读材料不应改写') }, activeTurnOf: () => 2 })
  const read = async args => JSON.parse((await tools.get('sike_read_turn').execute(args, exec)).report)
  const before = JSON.stringify(chat)
  const full = await read({ ruleOffset: 1 }), compact = await read({ ruleOffset: 1, includeMaterials: false, includeDraft: false })
  assert.deepEqual(compact.presetRules.rules, full.presetRules.rules)
  assert.equal(compact.playerAction, undefined); assert.equal(compact.worldBook, undefined); assert.equal(compact.state, undefined)
  assert.equal(compact.draft, null); assert.equal(compact.materialsOmitted, true)
  assert.ok(JSON.stringify(compact).length < JSON.stringify(full).length * .65)
  const draftOnly = await read({ includeMaterials: false, includeRules: false })
  assert.equal(draftOnly.draft.text, full.draft.text)
  assert.deepEqual(draftOnly.presetRules.rules, [])
  const restored = await read({ ruleOffset: 1, includeMaterials: true, includeRules: true, includeDraft: true })
  assert.deepEqual(restored, full)
  assert.equal(JSON.stringify(chat), before)
})
