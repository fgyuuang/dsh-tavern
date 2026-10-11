import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { inspectDreamSikeFollowup, dreamSikeFollowupPlan } from '../tavern-plugin/lib/domain/dream-sike-followup.js'
import { compileDreamSikeContract } from '../tavern-plugin/lib/domain/dream-sike-contract.js'

const IDS = ['f9b03e19-fd96-4782-8867-73ad2cbabfb9', '27bf435f-4283-4937-8c6f-3c31abc4f6d2',
  '11cdd506-1513-4008-b6b9-c883dbad65c5', '6a8e799c-9445-44f2-a853-c6c71b92b855']
const discuss = '<dream_discuss>门已打开，可以继续探查庭院。下一步由玩家决定。</dream_discuss>'
const questions = '<dream_big_discuss><q content="如何继续？"><a>庭院</a><a>书房</a><a>等候</a></q></dream_big_discuss>'
const options = '<dream_option>探查|询问|等候</dream_option>'
const summary = '<dream_summary>【庭院开门见客来】\n2026年10月11日 09:00 - 庭院\n玩家开门，访客递信。\n- 门铃只响了一次。\n- 访客说：“请收下。”\n</dream_summary>'
const plan = { tags: ['dream_discuss', 'dream_big_discuss', 'dream_option', 'dream_summary'], optionCount: 3 }

test('独立说书和摘要与既有共创、选项按固定顺序显示', () => {
  assert.equal(inspectDreamSikeFollowup([summary, options, questions, discuss].join('\n\n'), plan),
    [discuss, questions, options, summary].join('\n\n'))
  assert.equal(inspectDreamSikeFollowup(discuss, { tags: ['dream_discuss'] }), discuss)
  assert.equal(inspectDreamSikeFollowup(summary, { tags: ['dream_summary'] }), summary)
})

test('仅接受已启用模块；不把场外事件、变量或模块嵌套当成派生记录', () => {
  for (const invalid of [discuss + summary, '<dream_discuss></dream_discuss>',
    '<dream_discuss>计划<dream_summary>嵌套摘要</dream_summary></dream_discuss>',
    discuss + '<dream_parallel_event>庭院|已发生事件<br>后果</dream_parallel_event>',
    discuss + '<dream_scene>场景</dream_scene>', discuss + '<UpdateVariable>状态</UpdateVariable>']) {
    assert.throws(() => inspectDreamSikeFollowup(invalid, { tags: ['dream_discuss'] }))
  }
  assert.throws(() => inspectDreamSikeFollowup(summary.replace('- 访客说：“请收下。”\n', ''), { tags: ['dream_summary'] }), /2–3/)
  assert.throws(() => inspectDreamSikeFollowup(summary.replace('</dream_summary>', '- 三条。\n- 四条。\n</dream_summary>'), { tags: ['dream_summary'] }), /2–3/)
})

test('已编译快照按source ID映射模块，选项数量只来自选项原文', () => {
  // Keep the fixture independent from concurrent contract upgrades.
  const entries = [...IDS].reverse().map((id, index) => ({ id, content: id === IDS[2] ? '选项数量为3个。' : '其他模块中的选项数量为99个。', name: '作者模块' + index }))
  const version = compileDreamSikeContract({ front: { entries: [] } }).agentContract.version
  const snapshot = { agentContract: { version, outputMode: 'plot' }, deferredFollowup: { entries, digest: 'modules' } }
  const chat = { mode: 'story', playPresetId: 'dream-sike-dsh', runtimePresetSnapshot: snapshot,
    messages: [{ role: 'user', text: '开门' }, { role: 'assistant', turn: 1, text: '门已打开。' }], timeline: { branchId: 'branch', revision: 3 } }
  assert.deepEqual(dreamSikeFollowupPlan(chat).tags, plan.tags)
  assert.equal(dreamSikeFollowupPlan(chat).optionCount, 3)
  snapshot.deferredFollowup.entries = [entries.find(entry => entry.id === IDS[3])]
  assert.deepEqual(dreamSikeFollowupPlan(chat).tags, ['dream_summary'])
  assert.equal(dreamSikeFollowupPlan(chat).optionCount, null)
})

test('原作者说书、摘要完整转交后续任务；原开关不自动开启', () => {
  const entries = [IDS[0], IDS[3]].map(id => ({ id, source: { identifier: id }, enabled: true,
    content: id === IDS[0] ? '作者的说书规则原文。' : '作者的摘要规则原文。' }))
  const source = { back: { entries } }, before = structuredClone(source)
  const compiled = compileDreamSikeContract(source)
  assert.deepEqual(source, before)
  assert.deepEqual(compiled.deferredFollowup.entries.map(entry => entry.content), entries.map(entry => entry.content))
  assert.doesNotMatch(compiled.text, /作者的说书规则原文|作者的摘要规则原文/)
  entries.forEach(entry => { entry.enabled = false })
  assert.equal(compileDreamSikeContract(source).deferredFollowup.entries.length, 0)
})

test('面板完成标题只列实际启用的后续模块，摘要单独显示', async () => {
  const source = await readFile(new URL('../tavern-plugin/src/client/features/dream-sike-followup.js', import.meta.url), 'utf8')
  const render = enabledModules => {
    const record = { key: 'k', turn: 1, status: 'done', enabledModules }
    const context = vm.createContext({ React: { createElement: (tag, attrs, ...children) => ({ tag, attrs, children }),
      useState: value => [value, () => {}], useRef: value => ({ current: value }), useEffect: () => {} },
      useLiveTavernView: () => ({ view: { dreamSikeFollowup: record } }) })
    vm.runInContext(source, context)
    const tree = context.DreamSikeFollowup({ sessionId: 's', turn: 1, latest: false })
    return tree.children[0].children[1].children[0]
  }
  assert.equal(render([{ id: IDS[3] }]), '本回合摘要')
  assert.equal(render([{ id: IDS[2] }, { id: IDS[0] }]), '思客说书与行动选项')
  assert.equal(render([{ id: '807eefad-93ca-490c-a629-1d51038e3626' }]), '后续内容已完成')
})
