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
      else if(step===16){name='sike_check_draft';args={expectedVersion:'1',review:JSON.stringify(axes)};assert.ok(!offered.includes('sike_put_draft'));assert.ok(!offered.includes('sike_ready_draft'))}
      else if(step===17){name='sike_ready_draft';args={expectedVersion:'1'};assert.ok(!offered.includes('sike_put_draft'))}
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

test('隐藏的旧工具仍被执行入口拦截，不会重复起草或重复平行模块', async () => {
  let chat={id:'c',sessionId:'s',mode:'story',playPresetId:'dream-sike-dsh',messages:[],variables:{gold:3},
    runtimePresetSnapshot:{back:{entries:[{id:'807eefad-93ca-490c-a629-1d51038e3626',content:'DREAM_PARALLEL_EVENT：场外事件。'},
      {id:'4e26a3ac-4d46-45ed-85bf-0110fbe06cd2',content:'# 检查范围\n检查正文。\n# 修复格式\n局部修订。'}]}},
    timeline:{branchId:'b',revision:1,operations:{op:{id:'op',kind:'body',turn:1,status:'running',basedOn:{branchId:'b',revision:1}}}}}
  const tools=new Map();let moduleCalls=0
  registerDreamSikeTools({tools:{register:tool=>tools.set(tool.name,tool)},chatForSession:async()=>structuredClone(chat),
    updateChat:async(_id,mutate)=>{chat=await mutate(structuredClone(chat));return chat},activeTurnOf:()=>1,
    draftModules:{execute:async()=>{moduleCalls++;throw Error('unexpected module execution')}}})
  const exec={agent:{session:{id:'s'},phase:{turn:1,step:1}}}
  await tools.get('sike_put_draft').execute({text:'他在门口。'},exec)
  exec.agent.phase.step=2
  const duplicate=await tools.get('sike_put_draft').execute({text:'重复正文'},exec)
  assert.match(duplicate.report,/当前阶段不执行/)
  const wrong=await tools.get('sike_run_module').execute({kind:'parallel',expectedVersion:1},exec)
  assert.match(wrong.report,/调用 review/)
  assert.equal(moduleCalls,0)
  assert.equal(chat.dreamSikeDraft.version,1)
  assert.equal(chat.dreamSikeDraft.text,'他在门口。')
  const assembly=applyDreamSikeToolPhase({tools:[tools.get('sike_run_module')],sections:[]},dreamSikeToolPhase(chat,'s',1))
  assert.deepEqual(assembly.tools[0].parameters.properties.kind.enum,['review'])
})
