import assert from 'node:assert/strict'
import test from 'node:test'

import { createMvuBackgroundTaskFrame, createMvuSettlementModule, projectMvuBackgroundRequest } from '../tavern-plugin/lib/domain/mvu-background-settlement.js'

test('聚合姿势先于变量副作用校验；无效提交停止，手动修复后一次提交且不重复 delta', async () => {
  const feedback = []
  let writes = 0, runs = 0, persisted = 0
  const base = { operationId: 'batch', chatId: 'chat', branchId: 'branch', basedOnRevision: 1, turn: 2,
    swipeId: 0, sessionId: 's', messageId: 1, storyText: '她站在门边。', currentVariables: { stat_data: { hp: 10 } },
    backgroundTasks: { posture: true, characterDesign: false }, onSubmission() { persisted++ } }
  const operations = [{ op: 'delta', path: '/hp', valueJson: '-1' }]
  const module = createMvuSettlementModule({
    model: { async run(input) {
      runs++
      feedback.push(JSON.parse(await input.onToolCall({ name: 'settlement_submit', arguments: { operations, posture: '' } })))
      assert.equal(input.stopToolsWhen(), true)
      assert.equal(input.acceptWithoutText(), true)
      feedback.push(JSON.parse(await input.onToolCall({ name: 'settlement_submit', arguments: { operations, posture: '坐下' } })))
      return {}
    } },
    runtime: { async settleMvuUpdate() { writes++; throw Error('无效姿势不得进入 MVU') } }
  })
  await assert.rejects(module.settleVariables(base), /缺少非空 posture/)
  assert.equal(runs, 1)
  assert.equal(writes, 0)
  assert.equal(persisted, 0)
  assert.equal(feedback[0].ok, false)
  assert.equal(feedback[0].retryable, false)
  assert.equal(feedback[1].ok, false)
  assert.match(feedback[1].error, /终止或提交完成/)
  const corrected = createMvuSettlementModule({
    model: { async run(input) {
      runs++
      assert.equal(JSON.parse(await input.onToolCall({ name: 'settlement_submit', arguments: { operations, posture: '坐下' } })).ok, true)
      assert.equal(input.stopToolsWhen(), true)
      assert.equal(input.acceptWithoutText(), true)
      assert.equal(JSON.parse(await input.onToolCall({ name: 'settlement_submit', arguments: { operations, posture: '坐下' } })).ok, false)
      return {}
    } },
    runtime: { async settleMvuUpdate(input) {
      writes++
      assert.deepEqual(input.baselineVariables, { stat_data: { hp: 10 } })
      assert.match(input.command, /"op": "delta"/)
      return { variables: { stat_data: { hp: 9 } } }
    } }
  })
  const result = await corrected.settleVariables({ ...base, operationId: 'manual-correction' })
  assert.equal(result.posture, '坐下')
  assert.equal(writes, 1)
  assert.equal(persisted, 1)
  assert.equal(runs, 2)
  assert.equal(result.variables.stat_data.hp, 9)
  assert.equal(result.receipt.status, 'updated')
  assert.equal(base.currentVariables.stat_data.hp, 10)
})

test('静默拒绝返回提交值与观察值，停止自动重试并保留人工修复所需回执', async () => {
  let feedback, result, runs = 0, writes = 0
  const module=createMvuSettlementModule({maxAttempts:1,
    model:{async run(input){
      runs++
      const call={name:'settlement_submit',arguments:{posture:'站在路旁',operations:[{op:'replace',path:'/当前活动',valueJson:'["步行通勤"]'}]}}
      feedback=JSON.parse(await input.onToolCall(call))
      assert.equal(input.stopToolsWhen(),true)
      assert.equal(input.acceptWithoutText(),true)
      assert.equal(JSON.parse(await input.onToolCall(call)).ok,false)
      return {text:''}
    }},
    runtime:{async settleMvuUpdate(){writes++;return {updated:true,context:{messages:[{variables:{stat_data:{当前活动:[]}}}]}}}}
  })
  result=await module.settleVariables({operationId:'rejected-activity',chatId:'c',branchId:'b',basedOnRevision:1,sessionId:'s',messageId:0,swipeId:0,storyText:'走到路旁。',currentVariables:{stat_data:{当前活动:[]}},backgroundTasks:{posture:true,characterDesign:false}})
  assert.equal(feedback.ok,false)
  assert.equal(feedback.retryable,false)
  assert.deepEqual(feedback.rejectedOperations,[{operation:'replace',path:'/当前活动',submittedJson:'["步行通勤"]',observedJson:'[]'}])
  assert.match(feedback.error,/自动修订已停止/)
  assert.equal(result.receipt.status,'error')
  assert.equal(runs,1)
  assert.equal(writes,1)
})

test('本局 Guide 进入变量结算上下文，空 Guide 不占位', function () {
  const base = { operationId: 'guide-1', chatId: 'chat', branchId: 'main', basedOnRevision: 1, messageId: 1, swipeId: 0, storyText: '正文' }
  const request = projectMvuBackgroundRequest(createMvuBackgroundTaskFrame({ ...base, guides: [{ id: 'a', text: ' 好感度涨得慢一点 ' }, { id: 'b', text: '' }] }))
  assert.match(request.turnContext, /【玩家 Guide · 持续生效】/)
  assert.match(request.turnContext, /1\. 好感度涨得慢一点(\n|$)/)
  assert.doesNotMatch(request.turnContext, /2\. /)
  assert.match(request.system, /只根据【正文】中已经确认发生的事实结算变量/)
  assert.doesNotMatch(projectMvuBackgroundRequest(createMvuBackgroundTaskFrame(base)).turnContext, /Guide/)
})

test('replace 改变字段形状时终止聚合提交，后续纠正不会自动重试或进入 MVU', async () => {
  const feedback=[];let dispatched=0,runs=0,persisted=0
  const module=createMvuSettlementModule({maxAttempts:2,
    model:{async run(input){
      runs++
      feedback.push(JSON.parse(await input.onToolCall({name:'settlement_submit',arguments:{posture:'站在路旁',operations:[{op:'replace',path:'/待办',valueJson:'"买猫粮"'},{op:'replace',path:'/好感',valueJson:'"12"'}]}})))
      assert.equal(input.stopToolsWhen(),true)
      feedback.push(JSON.parse(await input.onToolCall({name:'settlement_submit',arguments:{posture:'站在路旁',operations:[{op:'replace',path:'/待办',valueJson:'["买猫粮"]'}]}})))
      return {text:''}
    }},
    runtime:{async settleMvuUpdate(){dispatched++;return {updated:true,context:{messages:[{variables:{stat_data:{待办:['买猫粮'],好感:10}}}]}}}}
  })
  await assert.rejects(module.settleVariables({operationId:'kind',chatId:'c',branchId:'b',basedOnRevision:1,sessionId:'s',messageId:0,swipeId:0,storyText:'走到路旁。',currentVariables:{stat_data:{待办:[],好感:10}},backgroundTasks:{posture:true,characterDesign:false},onSubmission(){persisted++}}),/\/待办 当前是列表，提交的是文本/)
  assert.equal(feedback[0].ok,false);assert.equal(feedback[0].retryable,false)
  assert.match(feedback[0].error,/\/待办 当前是列表，提交的是文本/)
  assert.equal(feedback[1].ok,false)
  assert.equal(dispatched,0)
  assert.equal(persisted,0)
  assert.equal(runs,1)
})

test('列表元素改变形状同样在聚合提交前终止，不调用 MVU 或自动重提', async () => {
  const feedback=[];let dispatched=0,runs=0
  const module=createMvuSettlementModule({maxAttempts:2,
    model:{async run(input){
      runs++
      feedback.push(JSON.parse(await input.onToolCall({name:'settlement_submit',arguments:{posture:'站在路旁',operations:[{op:'replace',path:'/通讯',valueJson:'[["😤","胡伟","别回所里"]]'}]}})))
      assert.equal(input.stopToolsWhen(),true)
      feedback.push(JSON.parse(await input.onToolCall({name:'settlement_submit',arguments:{posture:'站在路旁',operations:[{op:'insert',path:'/通讯/-',valueJson:'"😤|胡伟|别回所里"'}]}})))
      return {text:''}
    }},
    runtime:{async settleMvuUpdate(){dispatched++;return {updated:true,context:{messages:[{variables:{stat_data:{通讯:['📞|宋|你好','😤|胡伟|别回所里']}}}]}}}}
  })
  await assert.rejects(module.settleVariables({operationId:'element',chatId:'c',branchId:'b',basedOnRevision:1,sessionId:'s',messageId:0,swipeId:0,storyText:'看手机。',currentVariables:{stat_data:{通讯:['📞|宋|你好']}},backgroundTasks:{posture:true,characterDesign:false}}),/\/通讯 的列表元素 当前是文本，提交的是列表/)
  assert.match(feedback[0].error,/\/通讯 的列表元素 当前是文本，提交的是列表/)
  assert.equal(feedback[0].retryable,false)
  assert.equal(feedback[1].ok,false)
  assert.equal(dispatched,0)
  assert.equal(runs,1)
})

test('旧变量、姿势和记忆分项工具明确拒绝，聚合任务不请求模型重试', async () => {
  for (const name of ['mvu_submit_update', 'posture_submit', 'tavern_memory_submit']) {
    let runs=0,writes=0,feedback
    const module=createMvuSettlementModule({model:{async run(input){
      runs++
      assert.equal(input.tools.some(tool=>tool.name===name),false)
      assert.equal(input.tools.some(tool=>tool.name==='settlement_submit'),true)
      feedback=JSON.parse(await input.onToolCall({name,arguments:{}}))
      assert.equal(input.stopToolsWhen(),true)
      return {}
    }},runtime:{async settleMvuUpdate(){writes++}}})
    await assert.rejects(module.settleVariables({operationId:'legacy-'+name,chatId:'c',branchId:'b',basedOnRevision:1,sessionId:'s',messageId:0,swipeId:0,storyText:'正文',currentVariables:{stat_data:{}},backgroundTasks:{posture:false,characterDesign:false}}),/旧.*工具已停用|只接受 settlement_submit/)
    assert.equal(feedback.ok,false)
    assert.equal(feedback.retryable,false)
    assert.equal(runs,1)
    assert.equal(writes,0)
  }
})

test('the settlement prompt hides $meta, which MVU already turned into the schema (#153)', async () => {
  let prompt = ''
  const module = createMvuSettlementModule({ maxAttempts: 1,
    model: { async run(input) { prompt = JSON.stringify(input); return { text: '' } } },
    runtime: { async settleMvuUpdate() { return { updated: false, context: { messages: [{ variables: {} }] } } } }
  })
  await module.settleVariables({ operationId: 'meta', chatId: 'c', branchId: 'b', basedOnRevision: 1, sessionId: 's', messageId: 0, swipeId: 0, storyText: '她站在门边。',
    currentVariables: { stat_data: { $meta: { strictSet: true }, 人物: { 体力: 62, $meta: { extensible: true } }, 线索: ['旧烟盒'] }, schema: { strictSet: true } } }).catch(() => {})
  assert.match(prompt, /体力/)
  assert.match(prompt, /旧烟盒/)
  assert.match(prompt, /当前变量快照/)
  assert.doesNotMatch(prompt.slice(prompt.indexOf('当前变量快照'), prompt.indexOf('变量结构')), /\$meta/)
})
