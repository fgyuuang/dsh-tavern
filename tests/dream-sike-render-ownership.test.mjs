import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const source = readFileSync(new URL('../tavern-plugin/src/client/features/assistant-renderer.js', import.meta.url), 'utf8')
const start = source.indexOf('function tavernAssistantOwnsFinalProjection(')
const end = source.indexOf('function tavernReceiptViewPaths(', start)
assert.ok(start >= 0 && end > start, 'assistant renderer keeps a testable final-step ownership rule')
const policy = runInNewContext(source.slice(start, end) + '\n({ owns: tavernAssistantOwnsFinalProjection, mode: tavernAssistantContentMode })', {})

test('only the turn-closing assistant step owns the Story Timeline body', () => {
  const turn = { status: 'closed' }
  const tail = { closing: { finalNode: { seq: 9 } } }
  assert.equal(policy.owns(turn, { finalNode: { seq: 5 } }, tail), false)
  assert.equal(policy.owns(turn, { finalNode: { seq: 7 } }, tail), false)
  assert.equal(policy.owns(turn, { finalNode: { seq: 9 } }, tail), true)
  assert.equal(policy.owns({ status: 'open' }, { finalNode: { seq: 9 } }, tail), false)
  assert.equal(policy.owns(turn, { finalNode: { seq: 9 } }, null), false)
})

test('dream mode hides model steps and private reasoning from the main body', () => {
  assert.equal(policy.mode(true, 'running', false), 'progress')
  assert.equal(policy.mode(true, 'completed', false), 'hidden')
  assert.equal(policy.mode(true, 'completed', true), 'final')
  assert.equal(policy.mode(false, 'running', false), 'native')
  assert.match(source, /projection = settled && finalAssistantStep \? tavernProjectionForTurn/)
  assert.match(source, /blocks: dreamSikeMode \? \[\] : data\.blocks/)
  assert.match(source, /contentMode === "progress" \? \[React\.createElement\(DreamSikeMainTurnStatus/)
})
