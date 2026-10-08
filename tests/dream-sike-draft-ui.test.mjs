import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../tavern-plugin/src/client/features/dream-sike-draft.js', import.meta.url), 'utf8')
const start = source.indexOf('function createDreamSikeDraftFeatureModule()')
const end = source.indexOf('const dreamSikeDraftFeature = createDreamSikeDraftFeatureModule();', start)
assert.ok(start >= 0 && end > start)

function renderDraftWindow(draft, executionTrace) {
  let stateIndex = 0
  const states = [draft, executionTrace, false, '', false]
  const react = {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) { return { type, props: props || {}, children } },
    useState(initial) { const index = stateIndex++; return [index < states.length ? states[index] : initial, () => {}] },
    useEffect() {}
  }
  let tab
  const sandbox = {
    React: react,
    useTavernSessionMode() { return 'play' },
    useLiveTavernView() { return { view: { playPresetId: 'dream-sike-dsh' } } },
    isPlayMode() { return true },
    window: { addEventListener() {}, removeEventListener() {}, localStorage: { getItem() { return null } } },
    console
  }
  vm.runInNewContext(source.slice(start, end) + '\nthis.feature = createDreamSikeDraftFeatureModule();', sandbox)
  sandbox.feature.register({
    ctx: {
      effect(run) { run() },
      betterSidebar: { registerTab(spec) { tab = spec; return () => {} } }
    },
    slots: { inject() {} }
  })
  const element = tab.component({ scope: { sessionId: 'test-session' }, visible: true, tab: { id: 'draft-tab' } })
  return element.type(element.props)
}

function allNodes(node) {
  if (Array.isArray(node)) return node.flatMap(allNodes)
  if (!node || typeof node !== 'object') return []
  return [node, ...node.children.flatMap(allNodes)]
}

function visibleText(node) {
  if (Array.isArray(node)) return node.map(visibleText).join(' ')
  if (typeof node === 'string') return node
  if (!node || typeof node !== 'object') return ''
  return node.children.map(visibleText).join(' ')
}

test('正文工作窗在草稿出现前显示 Agent 工具摘要，不显示原始载荷', () => {
  const tree = renderDraftWindow(null, [{
    tool: 'sike_read_turn', step: 1, status: 'completed', elapsedMs: 37.6,
    summary: '已读取本回合材料', payload: 'PRIVATE TOOL RESULT'
  }])
  const trace = allNodes(tree).find(node => node.type === 'details' && node.props['aria-label'] === 'Agent 工具调用')
  assert.ok(trace)
  assert.match(visibleText(tree), /处理中/)
  assert.match(visibleText(tree), /Agent 正在准备本回合正文/)
  assert.doesNotMatch(visibleText(tree), /尚未开始|开始新回合后/)
  assert.match(visibleText(trace), /Agent 工具调用 · 1 次/)
  assert.match(visibleText(trace), /第 1 步 sike_read_turn 已完成 38 ms/)
  assert.match(visibleText(trace), /已读取本回合材料/)
  assert.doesNotMatch(visibleText(tree), /PRIVATE TOOL RESULT/)
})

test('Agent 工具调用与草稿处理记录分开显示，未知状态可安全降级', () => {
  const tree = renderDraftWindow({ status: 'draft', text: '当前正文', version: 1, trace: [{ label: '草稿检查' }] }, [
    { tool: 'sike_check_draft', status: 'constructor', step: 2, elapsedMs: null, summary: '检查完毕' }
  ])
  const details = allNodes(tree).filter(node => node.type === 'details')
  assert.equal(details.length, 2)
  assert.match(visibleText(details[0]), /sike_check_draft 已记录/)
  assert.doesNotMatch(visibleText(details[0]), /0 ms/)
  assert.match(visibleText(details[1]), /草稿处理记录 · 1 步 草稿检查/)
})
