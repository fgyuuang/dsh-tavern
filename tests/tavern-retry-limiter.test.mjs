import assert from 'node:assert/strict'
import test from 'node:test'

import { createTavernRetryLimiter } from '../tavern-plugin/lib/domain/tavern-retry-limiter.js'

function fixture() {
  const events = []
  const session = {
    events,
    append(type, data) {
      const event = { seq: events.length, type, data }
      events.push(event)
      return event
    }
  }
  return {
    session,
    payload: {
      agent: { session },
      turn: 2,
      step: 1,
      provider: 'test',
      failure: { message: 'closed', code: 'TRANSPORT' },
      retryPolicy: {
        mode: 'normal',
        maxRetries: 5,
        retryableCodes: ['TRANSPORT'],
        initialDelayMs: 500,
        maxDelayMs: 10000,
        jitterRatio: 0.1
      },
      signal: new AbortController().signal
    }
  }
}

test('rc.1 snapshot-only Session still limits requests to one retry', async () => {
  const { session, payload } = fixture()
  const events = session.events
  delete session.events
  session.snapshotEvents = () => Object.freeze(events.slice())
  const limiter = createTavernRetryLimiter({ owns: async () => true, wait: async () => true })
  assert.deepEqual(await limiter.handle(payload, async () => {}), { kind: 'retry' })
  assert.equal(await limiter.handle(payload, async () => {}), undefined)
  assert.equal(events.filter(event => event.type === 'llm/retry').length, 1)
})

test('免费额度耗尽不自动重试，也不交给宿主重试；普通瞬时429仍可重试一次', async () => {
  const {session,payload}=fixture()
  payload.retryPolicy.mode='always'
  payload.failure={code:'UNKNOWN',message:'429: You’ve reached the API rate limit for free users. Upgrade to a Token Plan.'}
  const limiter=createTavernRetryLimiter({owns:async()=>true,wait:async()=>true})
  assert.equal(await limiter.handle(payload,async()=>{throw Error('must not delegate retry')}),undefined)
  assert.equal(session.events.length,0)
  payload.failure={code:'RATE_LIMIT',message:'429: too many requests'}
  assert.deepEqual(await limiter.handle(payload,async()=>{}),{kind:'retry'})
})
