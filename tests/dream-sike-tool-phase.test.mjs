import assert from 'node:assert/strict'
import test from 'node:test'
import { dreamSikeToolPhase, applyDreamSikeToolPhase } from '../tavern-plugin/lib/domain/dream-sike-tool-phase.js'
import { dreamSikeTurnIdentity, putDreamSikeDraft, checkDreamSikeDraft, readyDreamSikeDraft, patchDreamSikeDraft } from '../tavern-plugin/lib/domain/dream-sike-draft.js'
import { recordDreamSikeTurnRead, prepareDreamSikeTurn } from '../tavern-plugin/lib/domain/dream-sike-preparation.js'
import { registerDreamSikeTools } from '../tavern-plugin/lib/tools/dream-sike.js'
import { registerRequestHooks } from '../tavern-plugin/lib/hooks/request.js'
import { mergeDreamSikeDraftModule, dreamSikeDraftModulePlan } from '../tavern-plugin/lib/domain/dream-sike-draft-modules.js'
const fixture = () => ({ id:'c', sessionId:'s', mode:'story', playPresetId:'dream-sike-dsh', messages:[],
  timeline:{branchId:'b',revision:1,operations:{op:{id:'op',kind:'body',turn:1,status:'running',basedOn:{branchId:'b',revision:1}}}} })
test('平行模块和独立审稿阶段依次开放，修订后先更新模块再检查确认', () => {
  const chat=fixture(),identity=dreamSikeTurnIdentity(chat,'s',1)
  chat.runtimePresetSnapshot={back:{entries:[{id:'807eefad-93ca-490c-a629-1d51038e3626',content:'DREAM_PARALLEL_EVENT：场外事件。'},
    {id:'4e26a3ac-4d46-45ed-85bf-0110fbe06cd2',content:'# 检查范围\n检查正文。\n# 修复格式\n局部修订。'}]}}
  const review=Object.fromEntries(['character','knowledge','style','continuity','playerAgency','format'].map(key=>[key,{status:'pass',evidence:'人物停在门口，玩家的回应与下一步选择保留。'}]))
  const parallel={text:'<dream_parallel_event>塔楼|有人收信。<br>他尚不知道主线动作。</dream_parallel_event>'}
  putDreamSikeDraft(chat,identity,'<dream_plot><dream_body>他在门口。</dream_body><dream_after_format></dream_after_format></dream_plot>')
  assert.equal(dreamSikeToolPhase(chat,'s',1).name,'modules')
  mergeDreamSikeDraftModule(chat,identity,1,dreamSikeDraftModulePlan(chat,'parallel'),parallel,{})
  assert.equal(dreamSikeToolPhase(chat,'s',1).name,'review')
  mergeDreamSikeDraftModule(chat,identity,2,dreamSikeDraftModulePlan(chat,'review'),{review:{...review,style:{status:'revise',evidence:'补足当前场景动作描写，并保持门口停止位置。'}}},{})
  assert.deepEqual(dreamSikeToolPhase(chat,'s',1).tools,['sike_read_turn','sike_patch_draft'])
  patchDreamSikeDraft(chat,identity,{expectedVersion:2,find:'他在门口。',replacement:'他在门口抬手敲门。'})
  assert.equal(dreamSikeToolPhase(chat,'s',1).name,'modules')
  mergeDreamSikeDraftModule(chat,identity,3,dreamSikeDraftModulePlan(chat,'parallel'),parallel,{})
  mergeDreamSikeDraftModule(chat,identity,4,dreamSikeDraftModulePlan(chat,'review'),{review},{})
  assert.equal(dreamSikeToolPhase(chat,'s',1).name,'checking')
  checkDreamSikeDraft(chat,identity,4)
  assert.equal(dreamSikeToolPhase(chat,'s',1).name,'confirming')
})
test('启用作者写前决策时先读再准备，审阅参数缺失只补参数不强迫正文修订', () => {
  const chat=fixture(),identity=dreamSikeTurnIdentity(chat,'s',1)
  chat.runtimePresetSnapshot={front:{entries:[{id:'0da6f4d7-961d-4966-a084-857a3dd876ad',content:'original enabled planning'}]}}
  assert.equal(dreamSikeToolPhase(chat,'s',1).name,'reading')
  recordDreamSikeTurnRead(chat,identity)
  assert.equal(dreamSikeToolPhase(chat,'s',1).name,'preparation')
  prepareDreamSikeTurn(chat,identity,Object.fromEntries(['scene','characters','knowledge','style','progression','stopAt'].map(key=>[key,'保持当前角色设定及场景事实，留下玩家回应。'])))
  assert.equal(dreamSikeToolPhase(chat,'s',1).name,'draft')
  putDreamSikeDraft(chat,identity,'他等在门口。')
  checkDreamSikeDraft(chat,identity,1)
  assert.deepEqual(dreamSikeToolPhase(chat,'s',1).tools,['sike_read_turn','sike_check_draft'])
})
test('阶段只提供当前可用写作工具，保留资料工具，确认前不可再次起草或提前确认', () => {
  const chat=fixture(), identity=dreamSikeTurnIdentity(chat,'s',1)
  assert.deepEqual(dreamSikeToolPhase(chat,'s',1).tools,['sike_read_turn','sike_put_draft'])
  recordDreamSikeTurnRead(chat,identity)
  assert.equal(dreamSikeToolPhase(chat,'s',1).name,'draft')
  putDreamSikeDraft(chat,identity,'门开了一道缝。')
  const phase=dreamSikeToolPhase(chat,'s',1)
  assert.equal(phase.name,'checking')
  const assembly={tools:['sike_put_draft','sike_ready_draft','sike_check_draft','worldbook_search'].map(name=>({name})),sections:[{name:'tool:sike_put_draft',text:'put'},{name:'author',text:'原作者文风'}]}
  const projected=applyDreamSikeToolPhase(assembly,phase)
  assert.deepEqual(projected.tools.map(tool=>tool.name),['sike_check_draft','worldbook_search'])
  assert.ok(projected.sections.some(section=>section.text==='原作者文风'))
  assert.ok(projected.sections.at(-1).text.includes('当前执行阶段'))
  assert.equal(assembly.tools.length,4)
  checkDreamSikeDraft(chat,identity,1)
  assert.equal(dreamSikeToolPhase(chat,'s',1).name,'confirming')
  readyDreamSikeDraft(chat,identity,1)
  assert.deepEqual(dreamSikeToolPhase(chat,'s',1).tools,['sike_read_turn'])
})
test('同一步的预推测修改或确认不执行，下个模型步骤可继续，无重复写入', async () => {
  let chat=fixture(); const tools=new Map()
  registerDreamSikeTools({tools:{register:t=>tools.set(t.name,t)},chatForSession:async()=>structuredClone(chat),
    updateChat:async(_id,mutate)=>{chat=await mutate(structuredClone(chat));return chat},activeTurnOf:()=>1})
  const exec={agent:{session:{id:'s'},phase:{turn:1,step:1}}}
  await tools.get('sike_read_turn').execute({},exec)
  await tools.get('sike_put_draft').execute({text:'门向内开了。'},exec)
  const skipped=await tools.get('sike_patch_draft').execute({expectedVersion:1,find:'向内',replacement:'向外'},exec)
  assert.match(skipped.report,/未执行/)
  assert.equal(chat.dreamSikeDraft.text,'门向内开了。')
  exec.agent.phase.step=2
  await tools.get('sike_patch_draft').execute({expectedVersion:1,find:'向内',replacement:'向外'},exec)
  assert.equal(chat.dreamSikeDraft.version,2)
  await tools.get('sike_patch_draft').execute({expectedVersion:3,find:'不存在',replacement:'错误'},exec)
  assert.equal(chat.dreamSikeDraft.version,2)
  exec.agent.phase.step=3
  await tools.get('sike_check_draft').execute({expectedVersion:2},exec)
  await tools.get('sike_ready_draft').execute({expectedVersion:2},exec)
  assert.equal(chat.dreamSikeDraft.status,'draft')
  exec.agent.phase.step=4
  await tools.get('sike_ready_draft').execute({expectedVersion:2},exec)
  assert.equal(chat.dreamSikeDraft.status,'ready')
})
test('规则分页和修订超过12步继续原生请求，不再触发固定总步数失败', async () => {
  const handlers=new Map()
  registerRequestHooks({ctx:{on:(name,handler)=>handlers.set(name,handler)},requestCoordinates:new Map(),
    tavernRetryLimiter:{handle(){}},backgroundAgentRunner:{owns:()=>false},chatForSession:async()=>fixture()})
  for(const step of [12,13,25]) assert.equal(await handlers.get('agent/request')({agent:{session:{id:'s'}},turn:1,step},async()=> 'continued'),'continued')
})
test('前台提前生成平行事件时保存主线并移交独立模块，脚本字面值原样保留', () => {
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
