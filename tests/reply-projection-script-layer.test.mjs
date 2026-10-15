import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../tavern-plugin/src/client/ui/message-frame.js', import.meta.url), 'utf8')
const start = source.indexOf('function renderTavernProjection('), end = source.indexOf('function userContentParts(', start)
const frame = function TavernMessageFrame() {}, markdown = function TavernColoredMarkdown() {}
const render = vm.runInNewContext(source.slice(start, end) + '\nrenderTavernAssistantBlocks', {
  React: { Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) },
  projectionPartsOf: value => value.parts, TavernMessageFrame: frame, TavernColoredMarkdown: markdown,
  parseTavernInlineFragment: () => null, window: { document: {} }, DshUi: {},
})
function find(value, match) {
  if (!value || typeof value !== 'object') return null
  if (match(value)) return value
  for (const child of Array.isArray(value) ? value : value.props?.children || []) { const result = find(child, match); if (result) return result }
  return null
}

test('Agent Timeline-only and direct replies mount the same card script layer', () => {
  const layer = { sessionId: 's', messageId: 4 }
  for (const blocks of [[], [{ kind: 'text', text: 'native carrier' }]]) {
    const tree = render({ blocks, projection: { parts: [{ kind: 'markdown', text: '状态占位符' }] }, scriptLayer: layer })
    const mounted = find(tree, node => node.type?.name === 'TavernScriptLayerPart')
    assert.equal(mounted?.props.layer, layer)
    assert.equal(mounted.props.text, '状态占位符')
  }
})

test('Timeline-only HTML retains iframe session, sizing, live helper and ownership', () => {
  const helper = { messages: [] }, owner = {}
  const tree = render({ blocks: [], projection: { parts: [{ kind: 'html', content: '<div>状态</div>' }] },
    sessionId: 's', turn: 5, frameSizing: { mode: 'content' }, frameOwner: owner, helperContext: helper, eagerFrame: true })
  const mounted = find(tree, node => node.type === frame)
  assert.equal(mounted.props.helperContext, helper)
  assert.equal(mounted.props.frameOwner, owner)
  assert.equal(mounted.props.eager, true)
  assert.equal(mounted.props.turn, 5)
})
