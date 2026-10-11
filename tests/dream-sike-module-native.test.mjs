import test from 'node:test'
import assert from 'node:assert/strict'
import { createSceneImageNativeRuntime } from './fixtures/scene-image-native-runtime.mjs'
import { DREAM_SIKE_MODULE_TOOL, inspectDraftModuleResult } from '../tavern-plugin/lib/domain/dream-sike-draft-modules.js'
import { MVU_SUBMIT_UPDATE_TOOL } from '../tavern-plugin/lib/domain/mvu-background-settlement.js'

test('真实 DSH 共享后台执行独立草稿模块，变量工具仅在结算阶段可用', { skip: !process.env.DSH_BOOT_MODULE, timeout: 30000 }, async t => {
  let stage = 'parallel', attempted = 0
  const parallel = '<dream_parallel_event>钟楼|角色收好信件。<br>他不了解主线刚发生的对话。</dream_parallel_event>'
  const axes = Object.fromEntries(['character','knowledge','style','continuity','playerAgency','format'].map(key => [key, { status: 'pass', evidence: '正文停在门口交谈，场外收信未泄漏信息，也没有替玩家决定。' }]))
  const runtime = await createSceneImageNativeRuntime(process.env.DSH_BOOT_MODULE, {
    residentOptions: { backgroundTools: [DREAM_SIKE_MODULE_TOOL, MVU_SUBMIT_UPDATE_TOOL] },
    scriptedModelResponse: async input => {
      const position = attempted++
      if (position > 1) return [{ type: 'text', text: '模块已完成。' }]
      const name = position === 0 ? 'mvu_submit_update' : 'sike_submit_module'
      assert.ok(input.tools.some(tool => tool.name === name))
      const args = position === 0 ? { operations: [] } : { text: stage === 'parallel' ? parallel : JSON.stringify(axes) }
      return [{ type: 'tool-call', id: stage + '-' + position, name, arguments: JSON.stringify(args) }]
    }
  })
  t.after(() => runtime.dispose())
  const parent = JSON.stringify(runtime.traceEvents('scene-parent')), calls = []
  let worker = ''
  for (stage of ['parallel', 'review']) {
    attempted = 0
    let submitted
    const result = await runtime.runBackground({ sessionId: 'scene-parent', task: 'dream-draft-module', persistent: true,
      persistentSessionId: worker, selection: { provider: 'scene-fixture', model: 'fixture-text' },
      messages: [{ role: 'user', content: [{ type: 'text', text: '执行 ' + stage + '，不得结算变量或提交正式正文。' }] }],
      tools: [DREAM_SIKE_MODULE_TOOL], maxToolCalls: 3,
      stopToolsWhen: () => Boolean(submitted), acceptWithoutText: () => Boolean(submitted),
      async onToolCall(call) { calls.push(call.name); submitted = inspectDraftModuleResult(stage, call.arguments.text); return JSON.stringify({ ok: true }) }
    })
    worker ||= result.traceSessionId
    assert.equal(result.traceSessionId, worker)
    assert.ok(submitted)
  }
  assert.deepEqual(calls, ['sike_submit_module', 'sike_submit_module'])
  const events = runtime.traceEvents(worker), toolCalls = events.filter(event => event.type === 'tool/call'), toolResults = events.filter(event => event.type === 'tool/result')
  assert.equal(toolCalls.length, 4); assert.equal(toolResults.length, 4)
  for (const call of toolCalls) assert.equal(toolResults.filter(result => result.sourceEventSeqs?.includes(call.seq)).length, 1)
  assert.equal(JSON.stringify(runtime.traceEvents('scene-parent')), parent)
  assert.equal(runtime.imageRequests.length, 0)
})
