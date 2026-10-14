import test from 'node:test'
import assert from 'node:assert/strict'
import { createSceneImageNativeRuntime } from './fixtures/scene-image-native-runtime.mjs'
import { registerDreamSikeTools } from '../tavern-plugin/lib/tools/dream-sike.js'
import { dreamSikeToolPhase, applyDreamSikeToolPhase } from '../tavern-plugin/lib/domain/dream-sike-tool-phase.js'
import { registerRequestHooks } from '../tavern-plugin/lib/hooks/request.js'
import { registerTurnLifecycleHooks } from '../tavern-plugin/lib/hooks/turn-lifecycle.js'
import { projectAssistantReply } from '../tavern-plugin/lib/domain/session-reply-projection.js'
test('真实 Harness 第17步确认直接提交正文，无额外模型请求且工具结果仍配对', {skip:!process.env.DSH_BOOT_MODULE,timeout:30000}, async t => {
  let chat={id:'c',sessionId:'scene-parent',mode:'story',playPresetId:'dream-sike-dsh',messages:[],variables:{gold:3},
    runtimePresetSnapshot:{front:{entries:Array.from({length:14},(_,i)=>({id:'author-'+i,content:'人物只知道亲历事实；门口招呼留给玩家回应。'}))}},
    timeline:{branchId:'b',revision:1,operations:{op:{id:'op',kind:'body',turn:1,status:'running',basedOn:{branchId:'b',revision:1},userText:'打招呼'}}}}
  const axes=Object.fromEntries(['character','knowledge','style','continuity','playerAgency','format'].map(key=>[key,{status:'pass',evidence:'正文只写门口招呼，人物未获额外信息，玩家回应留空。'}]))
  let requests=0, commits=0, stoppingHook;const offeredSteps=[]
  const runtime=await createSceneImageNativeRuntime(process.env.DSH_BOOT_MODULE,{
    setupHost(ctx){
      registerDreamSikeTools({tools:ctx.tools,chatForSession:async()=>structuredClone(chat),
        updateChat:async(_id,mutate)=>{chat=await mutate(structuredClone(chat));return chat},activeTurnOf:exec=>exec.agent.phase.turn})
      registerRequestHooks({ctx,requestCoordinates:new Map(),backgroundAgentRunner:{owns:()=>false},
        chatForSession:async()=>structuredClone(chat),tavernRetryLimiter:{handle(){}},
        requestIdForMessages:()=> 'probe',sessionStore:{flush:async()=>{}},
        foregroundStrategies:{prepareStep:async({decision})=>decision},cardMemory:{appendRecall:async({decision})=>decision}})
      registerTurnLifecycleHooks({ctx:{on:(name,handler)=>{if(name==='agent/turn-stopping')stoppingHook=handler;return ctx.on(name,handler)}},
        backgroundAgentRunner:{owns:()=>false,requestContext:()=>null},fullTemplateRuntime:{cancel(){}},clearRuntimePresetRequestState(){},
        chatForSession:async()=>structuredClone(chat),hookChatForSession:async()=>structuredClone(chat),
        userMessageForTurn:()=>({content:[{type:'text',text:'打招呼'}]}),contentText:()=> '打招呼',requestIdForTurn:()=> 'probe',
        publishResourceWorkspace:async()=>null,runtimePrompt:()=>'',ensureNativeSystemPrefix:async()=>{},
        nativeWorldBookTemplateContext:async()=>({}),readChatCard:async()=>null,sessionStore:{flush:async()=>{}},
        foregroundStrategies:{assembleSystemPrompt:async assembly=>assembly,endTurn(){}},turnOrchestrator:{modeFor:async()=> 'story',recordFailure:async()=>{}},
        replaceAssistantReply:projectAssistantReply,foregroundHandoff:{end(){},async finalize(input){
          commits++;assert.equal(input.assistantText,chat.dreamSikeDraft.text)
          chat.messages.push({role:'assistant',text:input.assistantText});chat.nativeCommits={'1':{turn:1}}
          chat.dreamSikeDraft.status='committed';chat.timeline.operations.op.status='completed'
          return {reply:{sessionText:input.assistantText}}
        }}})
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
      else {assert.fail('确认后不能再次请求模型')}
      assert.ok(offered.includes(name),'only a currently available writing tool is called')
      return [{type:'tool-call',id:'call-'+step,name,arguments:JSON.stringify(args)}]
    }
  })
  t.after(()=>runtime.dispose())
  runtime.parent.agent.followup({id:'test-user',role:'user',content:[{type:'text',text:'打招呼'}],source:{kind:'user'}})
  await runtime.parent.agent.whenIdle()
  const events=runtime.traceEvents('scene-parent')
  assert.equal(requests,17,JSON.stringify({end:events.findLast(e=>e.type==='turn/end')?.data.reason,offeredSteps}))
  assert.equal(events.filter(e=>e.type==='tool/call').length,17)
  assert.equal(events.filter(e=>e.type==='tool/result').length,17)
  assert.equal(events.findLast(e=>e.type==='turn/end').data.reason.kind,'completed')
  assert.equal(chat.dreamSikeDraft.status,'committed')
  const official=events.filter(e=>e.type==='assistant/message'&&e.data.message.source.model==='reply-projection')
  assert.equal(official.length,1);assert.equal(official[0].data.message.content[0].text,chat.dreamSikeDraft.text)
  for(const call of events.filter(e=>e.type==='tool/call')) assert.equal(events.filter(e=>e.type==='tool/result'&&e.sourceEventSeqs?.includes(call.seq)).length,1)
  const readyCall=events.find(e=>e.type==='assistant/message'&&e.data.message.content.some(b=>b.type==='tool-call'&&b.name==='sike_ready_draft'))
  assert.ok(runtime.parent.agent.session.surface.nodes.includes(readyCall.seq))
  await stoppingHook({agent:runtime.parent.agent,turn:1});assert.equal(commits,1)
  assert.deepEqual(chat.variables,{gold:3})
  assert.equal(chat.messages.length,1)
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
