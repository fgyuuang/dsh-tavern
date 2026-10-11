import test from 'node:test'
import assert from 'node:assert/strict'
import { createSceneImageNativeRuntime } from './fixtures/scene-image-native-runtime.mjs'
import { registerDreamSikeTools } from '../tavern-plugin/lib/tools/dream-sike.js'
import { dreamSikeToolPhase, applyDreamSikeToolPhase } from '../tavern-plugin/lib/domain/dream-sike-tool-phase.js'
import { registerRequestHooks } from '../tavern-plugin/lib/hooks/request.js'
test('真实 Harness 按阶段完成18步读取与确认，调用结果配对且没有流程错误', {skip:!process.env.DSH_BOOT_MODULE,timeout:30000}, async t => {
  let chat={id:'c',sessionId:'scene-parent',mode:'story',playPresetId:'dream-sike-dsh',messages:[],variables:{gold:3},
    runtimePresetSnapshot:{front:{entries:Array.from({length:14},(_,i)=>({id:'author-'+i,content:'人物只知道亲历事实；门口招呼留给玩家回应。'}))}},
    timeline:{branchId:'b',revision:1,operations:{op:{id:'op',kind:'body',turn:1,status:'running',basedOn:{branchId:'b',revision:1},userText:'打招呼'}}}}
  const axes=Object.fromEntries(['character','knowledge','style','continuity','playerAgency','format'].map(key=>[key,{status:'pass',evidence:'正文只写门口招呼，人物未获额外信息，玩家回应留空。'}]))
  let requests=0;const offeredSteps=[]
  const runtime=await createSceneImageNativeRuntime(process.env.DSH_BOOT_MODULE,{
    setupHost(ctx){
      registerDreamSikeTools({tools:ctx.tools,chatForSession:async()=>structuredClone(chat),
        updateChat:async(_id,mutate)=>{chat=await mutate(structuredClone(chat));return chat},activeTurnOf:exec=>exec.agent.phase.turn})
      registerRequestHooks({ctx,requestCoordinates:new Map(),backgroundAgentRunner:{owns:()=>false},
        chatForSession:async()=>structuredClone(chat),tavernRetryLimiter:{handle(){}},
        requestIdForMessages:()=> 'probe',sessionStore:{flush:async()=>{}},
        foregroundStrategies:{prepareStep:async({decision})=>decision},cardMemory:{appendRecall:async({decision})=>decision}})
      ctx.on('system-prompt/assemble',async(_assembly,context,next)=>applyDreamSikeToolPhase(await next(),dreamSikeToolPhase(chat,context.agent.session.id,context.agent.phase.turn)))
    },
    scriptedModelResponse:async input=>{
      const step=++requests
      const offered=input.tools.map(tool=>tool.name).filter(name=>name.startsWith('sike_'))
      offeredSteps.push({step,offered})
      let name,args
      if(step<=14){name='sike_read_turn';args={ruleOffset:step-1,ruleLimit:1,includeDraft:false};assert.ok(!offered.includes('sike_ready_draft'))}
      else if(step===15){name='sike_put_draft';args={text:'他在门边点头，等你回应。'};assert.ok(!offered.includes('sike_check_draft'))}
      else if(step===16){name='sike_check_draft';args={expectedVersion:1,review:axes};assert.ok(!offered.includes('sike_put_draft'));assert.ok(!offered.includes('sike_ready_draft'))}
      else if(step===17){name='sike_ready_draft';args={expectedVersion:1};assert.ok(!offered.includes('sike_put_draft'))}
      else {assert.equal(step,18);assert.deepEqual(offered,['sike_read_turn']);return [{type:'text',text:'正文已确认。'}]}
      assert.ok(offered.includes(name),'only a currently available writing tool is called')
      return [{type:'tool-call',id:'call-'+step,name,arguments:JSON.stringify(args)}]
    }
  })
  t.after(()=>runtime.dispose())
  runtime.parent.agent.followup({id:'test-user',role:'user',content:[{type:'text',text:'打招呼'}],source:{kind:'user'}})
  await runtime.parent.agent.whenIdle()
  const events=runtime.traceEvents('scene-parent')
  assert.equal(requests,18,JSON.stringify({end:events.findLast(e=>e.type==='turn/end')?.data.reason,offeredSteps}))
  assert.equal(events.filter(e=>e.type==='tool/call').length,17)
  assert.equal(events.filter(e=>e.type==='tool/result').length,17)
  assert.equal(events.findLast(e=>e.type==='turn/end').data.reason.kind,'completed')
  assert.equal(chat.dreamSikeDraft.status,'ready')
  assert.deepEqual(chat.variables,{gold:3})
  assert.deepEqual(chat.messages,[])
})
