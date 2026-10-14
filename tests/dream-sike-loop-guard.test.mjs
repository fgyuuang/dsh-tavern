import assert from 'node:assert/strict'
import test from 'node:test'
import { createDreamSikeLoopGuard } from '../tavern-plugin/lib/domain/dream-sike-loop-guard.js'
import { createSceneImageNativeRuntime } from './fixtures/scene-image-native-runtime.mjs'
import { registerRequestHooks } from '../tavern-plugin/lib/hooks/request.js'

const chatFixture = () => ({ id:'c',sessionId:'scene-parent',mode:'story',playPresetId:'dream-sike-dsh',messages:[],variables:{gold:3},
  timeline:{branchId:'b',revision:1,operations:{op:{id:'op',kind:'body',turn:1,status:'running',basedOn:{branchId:'b',revision:1}}}} })
function fixture() {
  const chat = chatFixture(), events = [], agent = { session: { id:chat.sessionId, events } }, guard = createDreamSikeLoopGuard()
  function append(step, { name='tavern_read_variables', args={path:''}, content='{"gold":3}', error=false, paired=true } = {}) {
    const callId = 'unique-' + step
    const add = (type, data) => events.push({seq:events.length,type,time:step*100,data:{turn:1,step,...data}})
    add('step/start',{})
    add('tool/call',{name,arguments:JSON.stringify(args),callId})
    if (paired) add('tool/result',{message:{source:{callId},content:[{type:'tool-result',toolCallId:callId,isError:error,content:[{type:'text',text:content}]}]}})
    add('step/end',{})
    return () => guard({agent,turn:1,step:step+1},chat)
  }
  return { chat, agent, events, append }
}
test('三次相同变量读取在没有写作推进时停止，调用ID及时间变化不影响判断', () => {
  const h = fixture(), original = structuredClone(h.chat)
  h.append(1)(); h.append(2)()
  assert.throws(h.append(3), {code:'DREAM_SIKE_NO_PROGRESS'})
  assert.deepEqual(h.chat,original)
})
test('分页参数、查询结果、草稿版本或准备事实变化时重置重复计数', () => {
  for (const change of ['args','result','version','preparation']) {
    const h=fixture(); h.append(1)(); h.append(2)()
    if (change==='version') h.chat.dreamSikeDraft={operationId:'op',branchId:'b',turn:1,version:2,status:'draft',text:'当前草稿'}
    if (change==='preparation') h.chat.dreamSikePreparation={operationId:'op',readAt:1,preparedAt:2,brief:{scene:'场景已更新'}}
    assert.doesNotThrow(h.append(3,change==='args'?{args:{path:'/gold'}}:change==='result'?{content:'{"gold":4}'}:{}))
  }
})
test('Sike时间戳更新不伪装进展，新的审稿检查反馈属于真实进展', () => {
  const h=fixture()
  h.append(1,{name:'sike_read_turn',args:{includeRules:false},content:'{"readAt":1}'})(); h.append(2,{name:'sike_read_turn',args:{includeRules:false},content:'{"readAt":2}'})()
  assert.throws(h.append(3,{name:'sike_read_turn',args:{includeRules:false},content:'{"readAt":3}'}), {code:'DREAM_SIKE_NO_PROGRESS'})
  const updated=fixture(); updated.append(1)(); updated.append(2)()
  updated.chat.dreamSikeDraft={operationId:'op',branchId:'b',turn:1,version:1,status:'draft',text:'正文',checks:{version:1,issues:[{code:'unbalanced-dream_body',message:'需补齐标签'}]}}
  assert.doesNotThrow(updated.append(3))
})
test('只检查完整已结束步骤与当前回合，原生扫描最多128条且不展开全量历史', () => {
  const h=fixture(); h.append(1)(); h.append(2)(); assert.doesNotThrow(h.append(3,{paired:false}))
  let reads=0; h.agent.session={id:'scene-parent',seq:10000,eventAt:()=>{reads++;return null},snapshotEvents:()=>{throw Error('不应读取全量历史')}}
  assert.doesNotThrow(h.append(4)); assert.equal(reads,128)
  const original=fixture(); original.chat.playPresetId='tavern'; original.append(1)();original.append(2)();assert.doesNotThrow(original.append(3))
})
test('真实Harness重复错误在第四次模型请求前停止，资料和变量保持原状', {skip:!process.env.DSH_BOOT_MODULE,timeout:30000}, async t => {
  const chat=chatFixture(); let requests=0
  const runtime=await createSceneImageNativeRuntime(process.env.DSH_BOOT_MODULE,{
    setupHost(ctx){
      ctx.tools.register({name:'loop_probe',description:'本地重复错误探针',parameters:{type:'object',properties:{}},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},execute:()=>{throw Error('相同测试错误')}})
      registerRequestHooks({ctx,requestCoordinates:new Map(),backgroundAgentRunner:{owns:()=>false},chatForSession:async()=>chat,
        tavernRetryLimiter:{handle(){}},requestIdForMessages:()=> 'probe',sessionStore:{flush:async()=>{}},
        foregroundStrategies:{prepareStep:async({decision})=>decision},cardMemory:{appendRecall:async({decision})=>decision}})
    },scriptedModelResponse:async()=>[{type:'tool-call',id:'call-'+(++requests),name:'loop_probe',arguments:'{}'}]
  })
  t.after(()=>runtime.dispose())
  runtime.parent.agent.followup({id:'u',role:'user',content:[{type:'text',text:'本地测试'}],source:{kind:'user'}})
  await runtime.parent.agent.whenIdle()
  const events=runtime.traceEvents('scene-parent')
  assert.equal(requests,3)
  const reason=events.findLast(e=>e.type==='turn/end').data.reason
  assert.equal(reason.kind,'error'); assert.match(reason.error.message,/连续三个步骤重复/)
  assert.equal(events.filter(e=>e.type==='tool/call').length,3)
  assert.equal(events.filter(e=>e.type==='tool/result').length,3)
  assert.deepEqual(chat.variables,{gold:3}); assert.deepEqual(chat.messages,[])
})
