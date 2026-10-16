import assert from 'node:assert/strict'
import test from 'node:test'
import { dreamSikeToolPhase, applyDreamSikeToolPhase, dreamSikePhaseInstruction } from '../tavern-plugin/lib/domain/dream-sike-tool-phase.js'
import { dreamSikeTurnIdentity, putDreamSikeDraft, checkDreamSikeDraft, readyDreamSikeDraft, patchDreamSikeDraft } from '../tavern-plugin/lib/domain/dream-sike-draft.js'
import { recordDreamSikeTurnRead, prepareDreamSikeTurn } from '../tavern-plugin/lib/domain/dream-sike-preparation.js'
import { registerDreamSikeTools } from '../tavern-plugin/lib/tools/dream-sike.js'
import { registerRequestHooks } from '../tavern-plugin/lib/hooks/request.js'
const fixture = () => ({ id:'c', sessionId:'s', mode:'story', playPresetId:'dream-sike-dsh', messages:[],
  timeline:{branchId:'b',revision:1,operations:{op:{id:'op',kind:'body',turn:1,status:'running',basedOn:{branchId:'b',revision:1}}}} })
const usage = counts => ({ rootOperationId: 'op', branchId: 'b', counts })

// Parallel/addon work now follows the formal body; it never gates first delivery.
test('selected parallel and review rules do not force foreground module calls before body confirmation', () => {
  const chat=fixture(),identity=dreamSikeTurnIdentity(chat,'s',1)
  chat.runtimePresetSnapshot={back:{entries:[{id:'807eefad-93ca-490c-a629-1d51038e3626',content:'DREAM_PARALLEL_EVENT：场外事件。'},
    {id:'4e26a3ac-4d46-45ed-85bf-0110fbe06cd2',content:'# 检查范围\n检查正文。\n# 修复格式\n局部修订。'}]}}
  putDreamSikeDraft(chat,identity,'<dream_plot><dream_body>他在门口。</dream_body><dream_after_format></dream_after_format></dream_plot>')
  assert.equal(dreamSikeToolPhase(chat,'s',1).name,'checking')
  const checked=checkDreamSikeDraft(chat,identity,1)
  assert.equal(checked.checks.editorial.required,false)
  assert.deepEqual(checked.checks.issues,[])
  assert.equal(readyDreamSikeDraft(chat,identity,1).status,'ready')
  assert.deepEqual(dreamSikeToolPhase(chat,'s',1).tools,[])
})

test('source planning is optional; explicit preparation keeps its evidence without blocking direct drafting', () => {
  const chat=fixture(),identity=dreamSikeTurnIdentity(chat,'s',1)
  chat.runtimePresetSnapshot={front:{entries:[{id:'0da6f4d7-961d-4966-a084-857a3dd876ad',content:'original enabled planning'}]}}
  assert.equal(dreamSikeToolPhase(chat,'s',1).name,'reading')
  recordDreamSikeTurnRead(chat,identity,Date.now(),{finishResearch:true})
  assert.equal(dreamSikeToolPhase(chat,'s',1).name,'draft')
  assert.deepEqual(dreamSikeToolPhase(chat,'s',1).tools,['sike_put_draft'])
  prepareDreamSikeTurn(chat,identity,Object.fromEntries(['scene','characters','knowledge','style','progression','stopAt'].map(key=>[key,'保持当前角色设定及场景事实，留下玩家回应。'])))
  putDreamSikeDraft(chat,identity,'他等在门口。')
  checkDreamSikeDraft(chat,identity,1)
  assert.equal(readyDreamSikeDraft(chat,identity,1).status,'ready')
})

test('research exhaustion removes generic reads, shell and Skills while preserving authored sections and body submission', () => {
  const chat=fixture()
  const reading=dreamSikeToolPhase(chat,'s',1,usage({query:0}))
  assert.ok(reading.tools.includes('worldbook_search'))
  assert.ok(reading.tools.includes('skill'))
  const phase=dreamSikeToolPhase(chat,'s',1,usage({query:1}))
  assert.equal(phase.name,'draft')
  const assembly={tools:['sike_put_draft','sike_read_turn','skill','shell','worldbook_search'].map(name=>({name})),
    sections:[{name:'tool:worldbook_search',text:'search'},{name:'author',text:'原作者文风'}]}
  const projected=applyDreamSikeToolPhase(assembly,phase)
  assert.deepEqual(projected.tools.map(tool=>tool.name),['sike_put_draft'])
  assert.ok(projected.sections.some(section=>section.text==='原作者文风'))
  assert.ok(!projected.sections.some(section=>section.name==='tool:worldbook_search'))
  assert.match(projected.sections.at(-1).text,/当前执行阶段/)
  assert.equal(assembly.tools.length,5)
})

test('reading and saving may share a Step; speculative second mutations never write another version', async () => {
  let chat=fixture(); const tools=new Map()
  registerDreamSikeTools({tools:{register:t=>tools.set(t.name,t)},chatForSession:async()=>structuredClone(chat),
    updateChat:async(_id,mutate)=>(chat=await mutate(structuredClone(chat))),activeTurnOf:()=>1})
  const exec={agent:{session:{id:'s'},phase:{turn:1,step:1}}}
  await tools.get('sike_read_turn').execute({},exec)
  await tools.get('sike_put_draft').execute({text:'门向内开了。',finalize:false},exec)
  const skipped=await tools.get('sike_patch_draft').execute({expectedVersion:1,find:'向内',replacement:'向外'},exec)
  assert.match(skipped.report,/未执行/)
  assert.equal(chat.dreamSikeDraft.text,'门向内开了。')
  exec.agent.phase.step=2
  await tools.get('sike_patch_draft').execute({expectedVersion:1,find:'向内',replacement:'向外',finalize:false},exec)
  assert.equal(chat.dreamSikeDraft.version,2)
  exec.agent.phase.step=3
  await tools.get('sike_check_draft').execute({expectedVersion:2},exec)
  assert.equal(chat.dreamSikeDraft.status,'ready')
  assert.equal(chat.dreamSikeDraft.text,'门向外开了。')
})

test('native requests beyond twelve Steps are not rejected by a fixed total limit', async () => {
  const handlers=new Map()
  registerRequestHooks({ctx:{on:(name,handler)=>handlers.set(name,handler)},requestCoordinates:new Map(),
    tavernRetryLimiter:{handle(){}},backgroundAgentRunner:{owns:()=>false,requestContext:()=>null},chatForSession:async()=>fixture()})
  for(const step of [12,13,25]) assert.equal(await handlers.get('agent/request')({agent:{session:{id:'s'}},turn:1,step},async()=> 'continued'),'continued')
})

test('early parallel output is deferred while the main body and script literals survive unchanged', () => {
  const chat=fixture(),identity=dreamSikeTurnIdentity(chat,'s',1)
  chat.runtimePresetSnapshot={back:{entries:[{id:'807eefad-93ca-490c-a629-1d51038e3626',content:'DREAM_PARALLEL_EVENT：场外事件。'}]}}
  const script='<script>const example="<dream_parallel_event>脚本字面值</dream_parallel_event>"</script>'
  const draft=putDreamSikeDraft(chat,identity,script+'<dream_body>主线正文。</dream_body><dream_parallel_event>提前生成的事件</dream_parallel_event>')
  assert.ok(draft.text.startsWith(script))
  assert.match(draft.text,/主线正文/)
  assert.doesNotMatch(draft.text,/提前生成/)
  assert.equal(draft.version,1)
  assert.deepEqual(chat.messages,[])
})

test('zero optional revisions keeps deterministic repair available and exposes the exact live version', () => {
  const chat=fixture(); chat.dreamSikeExecutionPolicy={revisionRequests:0}
  const identity=dreamSikeTurnIdentity(chat,'s',1)
  putDreamSikeDraft(chat,identity,'<dream_body>门开了。')
  checkDreamSikeDraft(chat,identity,1)
  const phase=dreamSikeToolPhase(chat,'s',1,usage({revision:20}))
  const current=JSON.parse(dreamSikePhaseInstruction(phase).split('\n')[0].replace('【当前执行阶段】',''))
  assert.equal(current.phase,'repair')
  assert.equal(current.expectedVersion,1)
  assert.deepEqual(current.allowedTools,['sike_patch_draft','sike_check_draft'])
  assert.equal(current.blockingIssues[0].code,'unbalanced-dream_body')
  patchDreamSikeDraft(chat,identity,{expectedVersion:1,find:'门开了。',replacement:'门开了。</dream_body>'})
  assert.equal(dreamSikeToolPhase(chat,'s',1).context.expectedVersion,2)
  assert.match(dreamSikePhaseInstruction(dreamSikeToolPhase(chat,'s',1)),/"checkVersion":null/)
  checkDreamSikeDraft(chat,identity,2)
  assert.equal(dreamSikeToolPhase(chat,'s',1).name,'confirming')
  assert.equal(readyDreamSikeDraft(chat,identity,2).status,'ready')
})
