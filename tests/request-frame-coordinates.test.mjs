import test from 'node:test'
import assert from 'node:assert/strict'
import { registerRequestHooks } from '../tavern-plugin/lib/hooks/request.js'

test('请求循环保留本轮明确记录的 Frame，不把上一轮 Frame 带入新回合', async () => {
 const handlers = new Map(), requestCoordinates = new Map()
 registerRequestHooks({ ctx: { on: (name, handler) => handlers.set(name, handler) }, requestCoordinates,
  tavernRetryLimiter: { handle() {} }, backgroundAgentRunner: { owns: () => false }, chatForSession: async () => null })
 const request = async (turn, step) => handlers.get('agent/request')({ agent: { session: { id: 'game' } }, turn, step }, async () => 'continued')
 requestCoordinates.set('game', { turn: 1, framePending: true, frame: { frameId: 'new-frame' } })
 assert.equal(await request(2, 1), 'continued')
 assert.equal(requestCoordinates.get('game').frame.frameId, 'new-frame')
 assert.equal(requestCoordinates.get('game').framePending, undefined)
 await request(2, 2)
 assert.equal(requestCoordinates.get('game').frame.frameId, 'new-frame')
 await request(3, 1)
 assert.equal(requestCoordinates.get('game').frame, undefined)
})
