import test from 'node:test'
import assert from 'node:assert/strict'
import { createSceneImageNativeRuntime } from './fixtures/scene-image-native-runtime.mjs'
import { DREAM_SIKE_FOLLOWUP_TOOL, inspectDreamSikeFollowup } from '../tavern-plugin/lib/domain/dream-sike-followup.js'
import { CANDIDATE_SUBMIT_TOOL } from '../tavern-plugin/lib/domain/candidate-generation.js'
import { MVU_SUBMIT_UPDATE_TOOL } from '../tavern-plugin/lib/domain/mvu-background-settlement.js'

const config = { skip: !process.env.DSH_BOOT_MODULE, timeout: 30000 }
const followup = '<dream_big_discuss><q content="下一幕方向？"><a>观察</a><a>问路</a><a>等候</a></q></dream_big_discuss>\n<dream_option>问路|等候</dream_option>'
const plan = { tags: ['dream_big_discuss', 'dream_option'], optionCount: 2 }

test('真实 DSH 常驻后台切换阶段后可提交后续互动，其他任务拒绝它且工具记录保持配对', config, async t => {
  let phase = 'settlement', step = 0
  const dispatched = [], allowedDefinitions = {
    settlement: MVU_SUBMIT_UPDATE_TOOL,
    candidate: CANDIDATE_SUBMIT_TOOL,
    'dream-followup': DREAM_SIKE_FOLLOWUP_TOOL
  }
  const argumentsFor = name => name === 'mvu_submit_update' ? { operations: [] }
    : name === 'candidate_submit_choices' ? { actions: ['观察', '问路', '等候', '敲门'], scene: '转到街口' }
      : { text: followup }
  const runtime = await createSceneImageNativeRuntime(process.env.DSH_BOOT_MODULE, {
    residentOptions: { backgroundTools: [MVU_SUBMIT_UPDATE_TOOL, CANDIDATE_SUBMIT_TOOL, DREAM_SIKE_FOLLOWUP_TOOL] },
    scriptedModelResponse: async input => {
      const ordinal = step++
      const name = ordinal === 0 && phase !== 'dream-followup' ? DREAM_SIKE_FOLLOWUP_TOOL.name : allowedDefinitions[phase].name
      assert.ok(input.tools.some(tool => tool.name === name), '工具必须真实进入 DSH 模型请求')
      if (ordinal > 1) return [{ type: 'text', text: '阶段已完成。' }]
      return [{ type: 'tool-call', id: phase + '-call-' + ordinal, name, arguments: JSON.stringify(argumentsFor(name)) }]
    }
  })
  t.after(() => runtime.dispose())
  const parentBefore = JSON.stringify(runtime.traceEvents('scene-parent'))
  let persistentId = '', previousRequests = 0
  for (const task of ['settlement', 'candidate', 'dream-followup', 'candidate']) {
    phase = task; step = 0; let accepted = false
    const result = await runtime.runBackground({
      sessionId: 'scene-parent', task, persistent: true, persistentSessionId: persistentId,
      selection: { provider: 'scene-fixture', model: 'fixture-text' },
      messages: [{ role: 'user', content: [{ type: 'text', text: '隔离验收阶段：' + task }] }],
      tools: [allowedDefinitions[task]], maxToolCalls: 4,
      stopToolsWhen: () => accepted, acceptWithoutText: () => accepted,
      async onToolCall(call) {
        dispatched.push({ task, name: call.name })
        assert.equal(call.name, allowedDefinitions[task].name)
        if (task === 'dream-followup') assert.equal(inspectDreamSikeFollowup(call.arguments.text, plan), followup.replace('\n', '\n\n'))
        accepted = true
        return JSON.stringify({ ok: true })
      }
    })
    assert.ok(accepted)
    if (persistentId) assert.equal(result.traceSessionId, persistentId, '所有阶段必须复用同一后台会话')
    persistentId = result.traceSessionId
    assert.ok(runtime.requests.length > previousRequests)
    previousRequests = runtime.requests.length
  }
  const expectedCatalog = runtime.requests[0].tools
  assert.ok(runtime.requests.every(request => JSON.stringify(request.tools) === JSON.stringify(expectedCatalog)), '阶段切换不得改写稳定工具目录')
  assert.equal(dispatched.filter(call => call.name === DREAM_SIKE_FOLLOWUP_TOOL.name).length, 1)
  const events = runtime.traceEvents(persistentId)
  const calls = events.filter(event => event.type === 'tool/call')
  const results = events.filter(event => event.type === 'tool/result')
  assert.equal(calls.length, 7)
  assert.equal(results.length, calls.length)
  for (const call of calls) {
    const linked = results.filter(result => result.sourceEventSeqs?.includes(call.seq))
    assert.equal(linked.length, 1, '每个工具结果必须关联唯一调用')
    const payload = linked[0].data.message.content.filter(block => block.type === 'tool-result').flatMap(block => block.content || []).filter(block => block.type === 'text').map(block => block.text).join('')
    const value = JSON.parse(payload)
    if (call.data.name === DREAM_SIKE_FOLLOWUP_TOOL.name && !call.data.callId.startsWith('dream-followup')) {
      assert.equal(value.ok, false)
      assert.match(value.error, /当前任务不允许调用 sike_submit_followup/)
    } else assert.equal(value.ok, true)
  }
  assert.equal(JSON.stringify(runtime.traceEvents('scene-parent')), parentBefore, '后续任务不写入前台正式正文')
  assert.equal(runtime.imageRequests.length, 0)
  assert.equal(JSON.stringify(runtime.chat), runtime.before, '原始 fixture 游戏状态不被本测试写入')
})
