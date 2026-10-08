import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../tavern-plugin/src/client/features/card-list.js', import.meta.url), 'utf8')
const { groupTavernBranches, tavernBranchLabel } = new Function(source + '\nreturn { groupTavernBranches, tavernBranchLabel };')()
const row = (chatId, createdAt, parent, turn = 2) => ({ chatId, sessionId: 'session-' + chatId, cardPath: 'card', createdAt,
  ...(parent ? { forkedFrom: { chatId: parent, turn } } : {}) })

function flatten(roots) {
  const pending = roots.slice()
  const seen = new Set()
  while (pending.length) {
    const item = pending.shift()
    assert.equal(seen.has(item.sessionId), false, 'each session must be reachable exactly once')
    seen.add(item.sessionId)
    pending.push(...item.branches)
  }
  return [...seen]
}

test('分支嵌套保留独立局及兄弟分支的原列表顺序，不修改输入', () => {
  const items = [row('new-independent', 10), row('new-branch', 9, 'parent'), row('old-branch', 8, 'parent'), row('parent', 7), row('old-independent', 1)]
  const saved = structuredClone(items)
  const roots = groupTavernBranches(items)
  assert.deepEqual(roots.map(item => item.chatId), ['new-independent', 'parent', 'old-independent'])
  assert.deepEqual(roots[1].branches.map(item => item.chatId), ['new-branch', 'old-branch'])
  assert.equal(flatten(roots).length, items.length)
  assert.deepEqual(items, saved)
})

test('同时间的两节点及多节点循环保留所有可打开对话且不会产生循环树', () => {
  for (const items of [[row('a', 1, 'b'), row('b', 1, 'a')], [row('a', 1, 'b'), row('b', 1, 'c'), row('c', 1, 'a')]]) {
    const roots = groupTavernBranches(items)
    assert.equal(roots.length, 1)
    assert.equal(flatten(roots).length, items.length)
    assert.match(tavernBranchLabel(roots[0]), /来源对话不可用/)
  }
})

test('删除来源后分支成为独立可打开节点，未知回合、初始回合标签清晰', () => {
  const child = row('child', 10, 'deleted-parent')
  delete child.forkedFrom.turn
  const roots = groupTavernBranches([child])
  assert.equal(roots[0].sessionId, 'session-child')
  assert.deepEqual(roots[0].branches, [])
  assert.equal(tavernBranchLabel(roots[0]), '分支 · 分叉回合未记录 · 来源对话不可用')
  assert.equal(tavernBranchLabel(row('initial', 10, 'parent', 0)), '分支 · 从初始状态')
  assert.equal(tavernBranchLabel(row('turn', 10, 'parent', 12)), '分支 · 从第 12 回合')
})

test('自身引用、错误卡片或晚于分支的来源均不会隐藏对话', () => {
  const parent = row('parent', 20)
  const otherCard = { ...row('other', 2), cardPath: 'other-card' }
  const items = [parent, otherCard, row('self', 5, 'self'), row('future-source', 10, 'parent'), row('cross-card', 10, 'other')]
  const roots = groupTavernBranches(items)
  assert.equal(roots.length, items.length)
  assert.equal(flatten(roots).length, items.length)
})
