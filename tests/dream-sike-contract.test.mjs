import assert from 'node:assert/strict'
import test from 'node:test'
import { compileDreamSikeContract, dreamSikeContractView, inspectDreamSikeContractDraft } from '../tavern-plugin/lib/domain/dream-sike-contract.js'
import { resolveRuntimePresetMacros } from '../tavern-plugin/lib/domain/runtime-presets.js'
import { projectPlayPresetSnapshot } from '../tavern-plugin/lib/domain/dream-sike-mode.js'

const entry = (identifier, name, content, extra = {}) => ({ id: identifier + '#1', name, content, role: 'system', source: { identifier }, ...extra })
const fixture = () => ({ presetPath: 'presets/source.json', front: { entries: [entry('initializer', '初始', '{{setvar::style::}}')] },
  back: { entries: [entry('style', '白话', '{{setvar::style::动作呈现情绪，不用散文腔。}}'), entry('writing-custom', '自定义写规', '采用：{{getvar::style}}'),
    entry('off', '禁用', 'disabled-marker', { enabled: false }), entry('marker', '占位', 'marker-content', { marker: true })] }, regexScripts: [{ id: 'render' }] })

test('selected narrative content, ordering and sequential macros survive native projection', () => {
  const raw = fixture()
  const before = JSON.stringify(raw)
  const compiled = projectPlayPresetSnapshot(raw, 'dream-sike-dsh')
  const rendered = resolveRuntimePresetMacros(compiled).snapshot
  assert.match(rendered.back.text, /采用：动作呈现情绪，不用散文腔/)
  assert.equal(compiled.agentContract.entries.length, 3)
  assert.doesNotMatch(compiled.text, /disabled-marker|marker-content/)
  assert.deepEqual(compiled.regexScripts, raw.regexScripts)
  assert.equal(JSON.stringify(raw), before)
  assert.equal(compileDreamSikeContract(compiled), compiled)
  assert.equal(projectPlayPresetSnapshot(raw, 'tavern'), raw)
})

test('contract digest changes with enabled style and preserves user-edited unknown prompts', () => {
  const raw = fixture(), original = dreamSikeContractView(raw)
  raw.back.entries[0].content = '新的精确文风'
  assert.notEqual(dreamSikeContractView(raw).digest, original.digest)
  assert.match(compileDreamSikeContract(raw).back.text, /新的精确文风/)
  assert.equal(dreamSikeContractView({ text: 'legacy rules' }).entries.length, 1)
})

test('known chain is adapted to planning while writing macros and visible parallel envelope survive', () => {
  const raw = { back: { entries: [
    entry('0da6f4d7-961d-4966-a084-857a3dd876ad', '默认思维链', 'legacy-private-chain'),
    entry('881044e5-cbef-43c7-ad19-c6e7f6d150b4', '写作模式', '【最新输入】\n<dreamer_input>{{lastUserMessage}}</dreamer_input>\n<writing_setting>自定义文风</writing_setting>\n梦鲸思客，开始根据旧格式进行思考。\n{{getvar::sleep_var_thought_of_chain}}'),
    entry('807eefad-93ca-490c-a629-1d51038e3626', '平行', '# 平行事件思考\n完整隐式推理\n# 平行事件输出\n<dream_parallel_event>\n<simple_thinking>${thinking}</simple_thinking>\n地点|事件<br>继续\n</dream_parallel_event>')
  ] } }
  const rendered = resolveRuntimePresetMacros(compileDreamSikeContract(raw)).snapshot.text
  assert.match(rendered, /自定义文风/)
  assert.match(rendered, /至少三条候选事件链/)
  assert.match(rendered, /<dream_parallel_event>/)
  assert.doesNotMatch(rendered, /legacy-private-chain|lastUserMessage|<simple_thinking>|完整隐式推理|旧格式进行思考/)
})

function formatChat() {
  return { playPresetId: 'dream-sike-dsh', runtimePresetSnapshot: { back: { entries: [
    entry('cb7fb49f-4496-4ca2-b2d2-39aed039ae5d', '格式', 'DREAM_PLOT'),
    entry('43f8a625-93e6-46c0-9c20-b635c57e3b19', '场景', 'DREAM_SCENE'),
    entry('807eefad-93ca-490c-a629-1d51038e3626', '平行', 'DREAM_PARALLEL'),
    entry('d7e8bca3-966e-44a7-acc7-e22293851eb2', '动态字数长', '1000–2000'),
    entry('bc555774-4ac3-4ace-bd92-44c32714d7d3', '禁词', '禁止破折号')
  ] } }, timeline: { branchId: 'b', operations: { op: { kind: 'body', status: 'running', basedOn: { branchId: 'b' }, userText: '开门' } } } }
}
const body = prose => `<dream_plot><dream_body><dream_scene><date>2026年10月11日</date><time>下午2:00</time><location>庭院</location></dream_scene>${prose}</dream_body><dream_after_format><dream_parallel_event>钟楼|林然收好信件。<br>等待送信时刻。</dream_parallel_event></dream_after_format></dream_plot>`

test('enabled formats and length are enforced without counting HTML or scene data', () => {
  const chat = formatChat()
  assert.deepEqual(inspectDreamSikeContractDraft(chat, body('她推开了木门。'.repeat(160))), [])
  const codes = inspectDreamSikeContractDraft(chat, '很短的正文').map(item => item.code)
  assert.ok(codes.includes('preset-dream_body'))
  assert.ok(codes.includes('preset-scene'))
  assert.ok(codes.includes('preset-parallel'))
  assert.ok(codes.includes('preset-body-length'))
  assert.ok(inspectDreamSikeContractDraft(chat, body('<div data-value="' + 'x'.repeat(1200) + '">很短</div>')).some(item => item.code === 'preset-body-length'))
})

test('player explicit length wins, prose bans ignore protected script and HTML attributes', () => {
  const chat = formatChat()
  chat.timeline.operations.op.userText = '正文约150字'
  assert.deepEqual(inspectDreamSikeContractDraft(chat, body('门开了。<script>const x="—"</script><div title="—"></div>')), [])
  assert.ok(inspectDreamSikeContractDraft(chat, body('门开了——风吹进来。')).some(item => item.code === 'preset-banned-dash'))
})

test('disabled and unknown formats do not impose old dream wrappers on cards', () => {
  const chat = formatChat()
  chat.runtimePresetSnapshot.back.entries.forEach(rule => { rule.enabled = false })
  chat.runtimePresetSnapshot.back.entries.push(entry('custom-format', '人物卡自定义', '保留人物卡HTML'))
  assert.deepEqual(inspectDreamSikeContractDraft(chat, '<div>人物卡自己的格式</div>'), [])
})

test('editing the selected length module changes the enforced minimum', () => {
  const chat = formatChat()
  chat.runtimePresetSnapshot.back.entries.find(item => item.source.identifier === 'd7e8bca3-966e-44a7-acc7-e22293851eb2').content = '{{setvar::sleep_var_zishu::输出内容约 100 到 200 字。}}'
  assert.deepEqual(inspectDreamSikeContractDraft(chat, body('她推开了木门。'.repeat(20))), [])
})
