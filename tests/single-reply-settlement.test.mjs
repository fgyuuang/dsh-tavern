import assert from 'node:assert/strict'
import test from 'node:test'
import { createSingleReplySettlement } from '../tavern-plugin/lib/domain/single-reply-settlement.js'
import { createTavernScriptHostAdapter } from '../tavern-plugin/lib/domain/tavern-script-host-adapter.js'
import { applyMvuSettlementEffect } from '../tavern-plugin/lib/domain/mvu-settlement-effect.js'

const base = { operationId: 'op', chatId: 'c', sessionId: 's', branchId: 'b', basedOnRevision: 3,
  messageId: 2, swipeId: 0, expectedLifecycleRevision: 4, currentVariables: { stat_data: { hp: 10 } } }
const command = "<UpdateVariable>\n_.set('hp', 10, 9);\n</UpdateVariable>"
const sourceText = '正文与作者附加内容。\n\n' + command

test('原回复的旧命令原样交给本地运行时，保存命令先于执行，effect 留给 Timeline 提交', async () => {
  const sequence = []
  let request
  const effect = { version: 1, changes: [] }
  const runner = createSingleReplySettlement({ runtime: { async settleMvuUpdate(input) {
    sequence.push('runtime'); request = input
    return { variables: { stat_data: { hp: 9 } }, effect }
  } } })
  const result = await runner.settleVariables({ ...base, storyText: sourceText,
    onSubmission(submission) { sequence.push('saved'); assert.equal(submission.sourceText, sourceText) },
    onPrepared(prepared) { sequence.push('prepared'); assert.deepEqual(prepared.effect, effect) } })
  assert.deepEqual(sequence, ['saved', 'runtime', 'prepared'])
  assert.equal(request.command, command)
  assert.equal(request.storyText, '正文与作者附加内容。')
  assert.equal(request.preserveForeground, true)
  assert.equal(request.durable, true)
  assert.equal(request.compactResult, true)
  assert.deepEqual(request.baselineVariables, base.currentVariables)
  assert.equal(result.receipt.status, 'updated')
  assert.deepEqual(result.receipt.changes, [{ operation: 'set', path: '/stat_data/hp', before: '10', after: '9' }])
  assert.deepEqual(base.currentVariables, { stat_data: { hp: 10 } })
})

test('不含 UpdateVariable 时仍完成唯一的本地消息事件，不合成变量协议', async () => {
  let executions = 0
  const runner = createSingleReplySettlement({ runtime: { settleMvuUpdate(input) {
    executions++
    assert.equal(input.command, '')
    assert.equal(input.storyText, '  只有正文与选项。\n')
    assert.equal(input.allowEmptyCommand, true)
    return { variables: base.currentVariables, effect: { version: 1, changes: [] } }
  } } })
  const input = { ...base, storyText: '  只有正文与选项。\n' }
  const result = await runner.settleVariables(input)
  await runner.settleVariables(input)
  assert.equal(executions, 1)
  assert.equal(result.receipt.status, 'unchanged')
  assert.equal(result.submission.command, '')
  assert.ok(result.effect)
})

test('持久原命令在执行器就绪后可重投，所有尝试保持同一变量基线', async () => {
  const requests = [], submissions = []
  let ready = false
  const runner = createSingleReplySettlement({ runtime: { async settleMvuUpdate(input) {
    requests.push(input)
    return ready ? { variables: { stat_data: { hp: 9 } }, effect: { version: 1 } }
      : { deferred: true, deferredReason: 'runtime-not-ready' }
  } } })
  const pending = await runner.settleVariables({ ...base, storyText: sourceText, onSubmission(value) { submissions.push(value) } })
  assert.equal(pending.receipt.status, 'pending')
  ready = true
  const completed = await runner.settleVariables({ ...base, submission: submissions[0] })
  assert.equal(completed.receipt.status, 'updated')
  assert.equal(requests.length, 2)
  for (const request of requests) assert.deepEqual(request.baselineVariables, base.currentVariables)
  assert.equal(requests[1].command, command)
})

test('过期、校验拒绝和本地协议错误不发布 effect，不追加后台重试', async () => {
  for (const outcome of [{ stale: true },
    { rejected: true, effect: { shouldNotPublish: true }, validation: { failures: [{ message: '卡片拒绝' }] } },
    { effect: { shouldNotPublish: true }, diagnostics: [{ level: 'error', message: '协议错误' }] }]) {
    let calls = 0, prepared = 0
    const runner = createSingleReplySettlement({ runtime: { async settleMvuUpdate() { calls++; return outcome } } })
    const result = await runner.settleVariables({ ...base, storyText: sourceText, onPrepared() { prepared++ } })
    assert.equal(calls, 1)
    assert.equal(prepared, 0)
    assert.equal(result.effect, undefined)
    assert.equal(result.receipt.status, outcome.stale ? 'stale' : 'error')
  }
})

test('并发和同操作的再次投递复用已准备结果，delta 不重复执行', async () => {
  let calls = 0
  const runner = createSingleReplySettlement({ runtime: { async settleMvuUpdate() {
    calls++
    await Promise.resolve()
    return { variables: { stat_data: { hp: 9 } }, effect: { version: 1 } }
  } } })
  const input = { ...base, storyText: sourceText }
  const [first, second] = await Promise.all([runner.settleVariables(input), runner.settleVariables(input)])
  const third = await runner.settleVariables(input)
  assert.equal(calls, 1)
  assert.deepEqual(first, second)
  assert.deepEqual(first, third)
  await assert.rejects(runner.settleVariables({ ...input, storyText: sourceText + '已修改' }), /同一变量结算操作/)
})

test('保留多段 JSONPatch 原文顺序；不完整标签和被改写投递拒绝执行', async () => {
  const patch = '<UpdateVariable><JSONPatch>[{"op":"delta","path":"/hp","value":-1}]</JSONPatch></UpdateVariable>'
  let request
  const runner = createSingleReplySettlement({ runtime: { async settleMvuUpdate(value) { request = value; return { variables: base.currentVariables } } } })
  const result = await runner.settleVariables({ ...base, storyText: '正文\n' + command + '\n后续\n' + patch })
  assert.equal(request.command, command + '\n\n' + patch)
  await assert.rejects(runner.settleVariables({ ...base, storyText: '<UpdateVariable>未闭合' }), /标签不完整/)
  await assert.rejects(runner.settleVariables({ ...base, submission: { ...result.submission, command: patch } }), /与原回复不一致/)
  await assert.rejects(runner.settleVariables({ ...base, storyText: '新正文', submission: result.submission }), /正文已变化/)
})

test('取消在执行前生效；已经取消的调用不写持久记录', async () => {
  const controller = new AbortController()
  controller.abort()
  let calls = 0
  const runner = createSingleReplySettlement({ runtime: { settleMvuUpdate() { calls++ } } })
  await assert.rejects(runner.settleVariables({ ...base, storyText: sourceText, signal: controller.signal,
    onSubmission() { calls++ } }), { name: 'AbortError' })
  assert.equal(calls, 0)
})

test('宿主事务只准备 effect，提交后变量与作者完整输出各保留一次', async () => {
  const chat = { id: 'c', sessionId: 's', mode: 'story',
    mvu: { enabled: true, owner: 'official' }, tavernHelperLifecycleRevision: 4,
    timeline: { branchId: 'b', revision: 3 },
    messages: [{ role: 'user', text: '之前的消息' }, { role: 'user', text: '当前输入' },
      { role: 'assistant', text: '渲染正文', sourceText, projectionText: sourceText,
        displayText: '<article>渲染正文</article>', swipes: [sourceText], swipeId: 0,
        variables: [structuredClone(base.currentVariables)] }] }
  let calls = 0, writes = 0, adapter
  adapter = createTavernScriptHostAdapter({
    resolveChat: async () => chat,
    writeChat: async () => { writes++ },
    readCard: async () => ({}), worldBooks: { bound: async () => null },
    scriptDispatch: {
      status: () => ({ ready: true }),
      async dispatch(sessionId, name, args, context, work) {
        calls++
        assert.equal(name, 'MESSAGE_RECEIVED')
        assert.deepEqual(args, [2])
        assert.equal(context.messages[2].message.split(command).length, 2)
        const variables = structuredClone(context.messages[2].variables)
        variables.stat_data.hp -= 1
        await adapter.updateMessages(sessionId, [{ message_id: 2, data: variables }], 4, work.eventId)
        return { handled: true, diagnostics: [] }
      }
    }
  })
  const runner = createSingleReplySettlement({ runtime: adapter })
  const result = await runner.settleVariables({ ...base, storyText: sourceText })
  assert.equal(result.receipt.status, 'updated')
  assert.equal(calls, 1)
  assert.equal(writes, 0)
  assert.equal(chat.messages[2].variables[0].stat_data.hp, 10)
  applyMvuSettlementEffect(chat, result.effect)
  assert.equal(chat.messages[2].variables[0].stat_data.hp, 9)
  assert.equal(chat.messages[2].sourceText, sourceText)
  assert.equal(chat.messages[2].displayText, '<article>渲染正文</article>')
  assert.equal(chat.messages[2].swipes[0], sourceText)
})

test('空命令只在单次模式且保留原文时允许；事件脚本的写入进入同一 CAS effect', async () => {
  const original = '  没有变量协议的原文。\n'
  const chat = { id: 'c', sessionId: 's', mode: 'story', generationMode: 'sillytavern-once',
    mvu: { enabled: true, owner: 'official' }, tavernHelperLifecycleRevision: 4,
    timeline: { branchId: 'b', revision: 3 },
    messages: [{ role: 'user', text: '前文' }, { role: 'user', text: '输入' },
      { role: 'assistant', text: original, sourceText: original, swipes: [original], swipeId: 0,
        variables: [structuredClone(base.currentVariables)] }] }
  let calls = 0, adapter
  adapter = createTavernScriptHostAdapter({
    resolveChat: async () => chat, writeChat: async () => { throw new Error('事务不得提前写入') },
    readCard: async () => ({}), worldBooks: { bound: async () => null },
    scriptDispatch: { status: () => ({ ready: true }), async dispatch(sessionId, name, args, context, work) {
      calls++
      assert.equal(name, 'MESSAGE_RECEIVED')
      assert.equal(context.messages[2].message, original)
      const variables = structuredClone(context.messages[2].variables)
      variables.stat_data.observedReplies = 1
      await adapter.updateMessages(sessionId, [{ message_id: 2, data: variables }], 4, work.eventId)
      return { handled: true }
    } }
  })
  const runner = createSingleReplySettlement({ runtime: adapter })
  const input = { ...base, storyText: original }
  const [result] = await Promise.all([runner.settleVariables(input), runner.settleVariables(input)])
  await runner.settleVariables(input)
  assert.equal(calls, 1)
  assert.equal(result.receipt.status, 'updated')
  assert.equal(chat.messages[2].variables[0].stat_data.observedReplies, undefined)
  applyMvuSettlementEffect(chat, result.effect)
  assert.equal(chat.messages[2].variables[0].stat_data.observedReplies, 1)
  assert.equal(chat.messages[2].sourceText, original)
  assert.equal(chat.messages[2].swipes[0], original)
  const runtimeInput = { ...base, baselineVariables: base.currentVariables, command: '',
    storyText: original, allowEmptyCommand: true, preserveForeground: true }
  chat.generationMode = 'agent'
  await assert.rejects(adapter.settleMvuUpdate(runtimeInput), /命令为空/)
  chat.generationMode = 'sillytavern-once'
  await assert.rejects(adapter.settleMvuUpdate({ ...runtimeInput, preserveForeground: false }), /命令为空/)
  await assert.rejects(adapter.settleMvuUpdate({ ...runtimeInput, allowEmptyCommand: false }), /命令为空/)
})
