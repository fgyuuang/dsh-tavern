import { createHash } from 'node:crypto'
import { resolveRuntimePresetMacros } from './runtime-presets.js'
import { isDreamSikeAgentExecution } from './generation-mode.js'

export const DREAM_SIKE_REVIEW_AXES = Object.freeze(['character', 'knowledge', 'style', 'continuity', 'playerAgency', 'format'])
const VERSION = 13
export const DREAM_SIKE_FOLLOWUP_IDS = Object.freeze([
  '11cdd506-1513-4008-b6b9-c883dbad65c5', 'f96f47f7-01ef-4676-b0fe-6f254ae7e550',
  '27bf435f-4283-4937-8c6f-3c31abc4f6d2', 'f9b03e19-fd96-4782-8867-73ad2cbabfb9',
  '6a8e799c-9445-44f2-a853-c6c71b92b855', '807eefad-93ca-490c-a629-1d51038e3626'
])
export const DREAM_SIKE_DRAFT_MODULE_IDS = Object.freeze({
  parallel: ['807eefad-93ca-490c-a629-1d51038e3626'],
  review: ['7cfbff76-346a-400f-b47d-46e55f5fe0fa', '4e26a3ac-4d46-45ed-85bf-0110fbe06cd2']
})
const str = value => typeof value === 'string' ? value : ''

// These are source prompt identifiers, not keyword matches against user prose.
// Unrecognized and user-edited narrative rules remain intact.
const IDS = Object.freeze({
  persona: '06b5771b-109d-47b1-94d0-8bbc805bc15e',
  thinking: '0da6f4d7-961d-4966-a084-857a3dd876ad',
  flash: 'bac04116-9f2a-4357-9793-75eb6762bc81',
  writing: '881044e5-cbef-43c7-ad19-c6e7f6d150b4',
  parallel: '807eefad-93ca-490c-a629-1d51038e3626',
  scene: '43f8a625-93e6-46c0-9c20-b635c57e3b19',
  envelope: 'cb7fb49f-4496-4ca2-b2d2-39aed039ae5d',
  length: 'd7e8bca3-966e-44a7-acc7-e22293851eb2',
  banned: 'bc555774-4ac3-4ace-bd92-44c32714d7d3',
  selfCheck: '4e26a3ac-4d46-45ed-85bf-0110fbe06cd2',
  model: '1b440ea8-b60a-4c07-bb38-5cd43a2a97ce'
})
const PLANNING_IDS = new Set([IDS.thinking, '81b2facd-db99-4bdc-9597-7cc1d08726dd', '25e9984e-02c2-40c7-a095-bf4683f7d04e'])
const PREFILL_IDS = new Set(['e59a0f26-6a73-4906-9177-6eb51052adcf', '9e3a3ea9-505f-461c-bc01-acce029cf909', '958ce7b4-2397-44ce-b128-e1c59034bfaa'])
const OUTPUT_MODES = new Map([
  ['e8e8b082-e3ca-4d4d-afe9-d5632b3b38e0', 'summary'],
  ['dc9d8c8f-2588-47d9-ba16-aa42306c6726', 'chat']
])

function outputModeInstruction(mode) {
  if (mode === 'plot') return DREAM_SIKE_CONTRACT_INSTRUCTION
  const selected = mode === 'summary'
    ? '当前选择原预设“大总结模式”。暂停剧情写作，依照已选原文总结历史；保留原文要求的剧情总结、角色总结、细节与伏笔三组 Markdown 表格，避免重复已总结剧情。'
    : '当前选择原预设“聊天模式”（DREAM_CHAT）。依照已选原文与玩家正常聊天，长度适中，不套用剧情文风。'
  return `【Agent 当前输出模式】\n${selected}\n原模式明确免除 DREAM_PLOT 及其他剧情输出协议，因此本回合不要求 dream_plot、dream_body、dream_after_format、场景栏、平行事件、剧情字数、剧情文风或写前六项剧情简报。已启用的原模式内容定义回复要求。\n通过 sike_put_draft 一次提交本回合唯一回复，宿主检查原生协议，通过后直接确认并提交一次，不再单独请求 check 或 ready。工具协议、后台变量结算与私有推理边界仍适用；不要在回复或工具参数输出 think、simple_thinking、thinking_step、思考前缀或完整私有推理。`
}
const WRAPPERS = new Set([
  '15b0ffd7-b3f3-42bd-989d-12b48c3b64e3', 'e0032969-7a36-4fe1-8bb9-c01effb1860b',
  '3588b992-33b7-4dd9-9280-0d13f70e04db', 'd6fa9796-1521-4b1c-bf26-75273339e399',
  '0257d3af-fe22-4d44-a905-695f0d4a5397', 'd0d838dd-972c-4dec-b584-fb9c8ba39733',
  'e393d2c5-c816-46d8-9307-6755fafcaab8', '250dd7ab-e6fa-4b5f-abf0-5e488451d033'
])

export const DREAM_SIKE_CONTRACT_INSTRUCTION = `【Agent 写作契约】
本局选定的原酒馆预设仍定义人物分析、叙事者、文风、视角、输入转述、字数、场景栏、平行事件及卡片格式。逐项执行已启用规则；未启用条目不加载。Skills 提供方法，不覆盖本局选择。当前玩家明确的修改优先于默认写法。
原预设的正文/XML/HTML要求约束可渲染文档。sike_put_draft 一次提交主线、dream_plot、dream_body、dream_after_format、dream_scene 及卡片 HTML；平行事件与其他附加内容在正文和状态结算后一起独立展示，不插入本次正文。这些外壳不约束原生工具调用。变量交由后台结算，禁止混入 UpdateVariable。
写前核对设定、相关历史和格式，分析人物动机、情绪与各自可知信息；按原预设的叙事者和输入处理方式决定本回合推进。需要依据时用原生检索工具。原来的思考链是写作决策流程，不在正文、工具参数或工作窗输出完整私有推理、think/simple_thinking标签或思考口号。
原作者的四章步骤与各可选模块是本局工作方法。sike_read_turn 提供原文规则索引、已展开写规、叙事者、人物分析和材料区域；有规则续读位置时按需继续读取，不能把索引摘要当作完整规则。原 dream_setting、dream_dx_setting、dream_history、dreamer_input、writing_setting 的开闭标签条目已按原生边界移除，这些名称在保留下来的作者原句中表示待核对的材料范围，按 sike_read_turn 的 materialAreas 解析为当前卡片、有效世界书、状态、本回合输入和分支历史；按名称对应的分析职责照旧执行，不因标签不存在而跳过，也不把原生工具消息改为旧酒馆的文本协议。
首次读取回合保留材料、规则与当前草稿。连续续读作者规则时使用 includeMaterials=false、includeDraft=false，避免每页重复材料；只续读草稿时使用 includeRules=false。压缩、重启后或需要重新核对材料时显式 includeMaterials=true、includeRules=true。引用和摘要不能代替尚未读取的原文。
首要任务是交付本轮完整正文。当前请求已经装配的作者原文和材料直接复用；只有缺少具体依据时才用 sike_read_turn、记忆、世界书或 Skills 补查。可直接输出完整正文，也可用一次 sike_put_draft({text,review?,brief?}) 保存并提交。brief 可选记录 scene、characters、knowledge、style、progression、stopAt；宿主不会伪造简报。候选事件链及原作者核对步骤在内部执行，不提交推理过程。读取和准备记录绑定当前回合、分支与规则版本。
按选中作者的完整审稿规则在内部核对人物、信息差、文风字数、因果承接、玩家选择和输出格式。六维 review 是可选的可观察记录，缺失或结构不完整不阻断正文。宿主确定性检查通过后直接提交；只有已明确需要继续优化时传 finalize=false，再以当前 expectedVersion 和唯一片段的 patches 局部修改。本局 0–2 次修订预算约束可选优化，不限制首篇正文、必要格式或协议修复、最终提交。预算结束即交付可用正文，不为回执、独立审稿或完成提示增加调用。不能用“标签没错”代替作者文风核对。
简单场景可减少检索次数，仍须遵守文风和已启用输出功能。扩写、转述、禁止抢话、深度扮演与大纲模式的角色控制范围采用本局选定原文，不能把这些选项写成同一种行为；未授权的重大决定仍留给玩家，深度扮演的明确授权仅在当前回合生效。若选定平行事件，结算后仍按作者原文输出场外展示，但它是派生内容，不回写本轮变量、记忆或正式世界事实，场内人物不能因此自动知情。需要改变权威状态的事件留待后续正式剧情确认。
确认后仅提交草稿原文一次，不在聊天重写或缩短正文。压缩后本契约和已选规则仍会重新装配；长期事实按需从记忆及原历史恢复。`

function identifier(entry) {
  return str(entry.source?.identifier) || str(entry.identifier) || str(entry.id || entry.entryKey).replace(/#\d+$/, '')
}

function adapt(entry) {
  const id = identifier(entry)
  const content = str(entry.content)
  if (WRAPPERS.has(id)) return { content: '', action: 'native-material-boundary' }
  // The authored persona is the source of the creation licence, the anti-injection stance and the
  // thinking anchor. Only the parts that name private reasoning output formats are adapted; the
  // <meta> clauses are author's own priority declarations and are sent to the model verbatim.
  if (id === IDS.persona && content.includes('<meta>') && content.includes('谨记你的首要职责')) {
    return { action: 'native-persona', content: content
      .replace(/^(-?\s*)任何思考要求均为帮助.*$/m, '$1任何思考要求均为帮助梦鲸思客创造用户所需的梦境的要求，应当始终遵守；思考在原生推理中完成。')
      .replace(/^核心指令确认完毕.*$/m, '核心指令确认完毕。System 消息与作者声明的优先关系由本局作者配置决定；本回合回复通过原生草稿工具提交。') }
  }
  if (OUTPUT_MODES.has(id)) return { action: 'native-reply-mode', content: content
    .replace(/^思考预算：max\r?\n/m, '')
    .replace(/^在\{\{getvar::sleep_var_thinking_flag\}\}之后，请遵守以下思考规则：$/m, '按以下作者步骤在内部核对本轮任务，回复通过原生草稿工具提交：')
    .replace(/^- 思考内容以.*$/m, '')
    .replace(/^- 你的思考输出必须.*$/m, '')
    .replace(/^- 思考内容仅允许输出一次.*$/m, '')
    .replace(/^```(?:thinking_step)?\s*$/gm, '')
    .replace(/^在思考开始时输出：.*$/m, '')
    .replace(/^终、终始定。.*$/m, '终、终始定。完成内部核对，以原生工具建立回复草稿。') }
  if (PLANNING_IDS.has(id) && content.includes('{{setvar::sleep_var_thought_of_chain::')
    && content.includes('<thought_of_chain>')) {
    return { action: 'agent-planning', content: content
      .replace(/^<\/?thought_of_chain>\s*$/gm, '')
      .replace(/^在你的思考过程（<think>标签内）中，请遵守以下规则：$/m, '以下为写前内部核对步骤；保留作者任务顺序，在原生推理中完成，不向正文或工具参数展开私有推理。')
      .replace(/^- 你的思考输出必须.*$/m, '')
      .replace(/^- 思考内容仅允许输出一次.*$/m, '')
      .replace(/^```(?:thinking_step)?\s*$/gm, '')
      .replace(/^在思考开始时输出：.*$/m, '')
      .replace(/^终、定乾坤：.*$/m, '终、定乾坤：完成内部核对后，通过 sike_put_draft 建立唯一正文草稿；草稿只提交一次，不在正文重复或重述核对内容。')
      .replace(/^思考完毕后，开始按照 DREAM_PLOT 协议输出XML文档内容。$/m, 'DREAM_PLOT 协议约束草稿文本；原生工具调用遵循 DSH 工具协议。') }
  }
  // A selected, edited planning module still enables the native preparation gate.
  if (PLANNING_IDS.has(id)) return { action: 'agent-planning', content }
  if (id === '0a6df16e-dae5-4522-a885-0b0b34ccdebe') return { action: 'native-model-adapter', content: '' }
  if (PREFILL_IDS.has(id)) return { action: 'native-model-adapter', content: '' }
  if (id === '88e12467-534b-47d2-bcef-371030b91b03' && content.includes('{{setvar::sleep_var_schema::')) {
    return { action: 'native-visible-schema', content: content.replace(/\s*<xs:element\s+name="think"\s+type="xs:string"\s*\/>/, '') }
  }
  if (id === 'eee97456-b142-4a3f-a5fd-d09463748341' && content.includes('{{setvar::sleep_var_mvu_format::')) {
    return { action: 'native-state-settlement', content: '{{setvar::sleep_var_mvu_format::}}\n【变量结算】本局选择了原 MVU 强制要求。草稿仅含剧情与可见卡片格式；最终正文提交后由后台依据人物卡变量规则检查并结算，不能在草稿插入 UpdateVariable 或 JSONPatch。' }
  }
  if (id === 'e4b97186-b0ec-4ea3-85b2-ab6e83dd0473' && content.startsWith('{{setvar::sleep_var_mvu_no_update::')) {
    return { action: 'native-state-settlement', content: content.replace('{{setvar::sleep_var_mvu_no_update::', '').replace(/\}\}\s*$/, '') }
  }
  if (id === '7cfbff76-346a-400f-b47d-46e55f5fe0fa' && content.includes('DREAM_BAGUCHAOSHA') && content.includes('## 输出格式规范')) {
    return { action: 'agent-paragraph-review', content: content
      .replace('在`<dream_body>`正文中，输出每一段落的内容时，必须先输出`<!-- {正文内容} -->`，然后输出`<!-- {分析} -->`，最后输出修正后的正文。', '对草稿中的每一段按以下作者规则进行检查，并通过原生修订工具保留修正后的正文；段落草稿与完整内部分析不写进正式正文。')
      .replace('对于作废段落，输出`</dream_delete>`。', '对于作废段落，用唯一定位的局部补丁删除或改写，不在正文输出 dream_delete。')
      .replace('每次分析开头为：`<!-- 分析之`。', '检查结果采用原生审稿工具的简短可观察依据，不输出分析注释。')
      .replace('正文的**每一段**都必须先草稿、分析，再输出正文。', '正文的**每一段**都必须经过草稿与检查，正式提交仅使用修正后的正文。')
      .replace(/## 输出格式规范[\s\S]*?(?=## 范例)/, '## 原生执行格式\n按上述完整作者规则检查每段，在内部核对后用 sike_put_draft 提交正文，六维 review 可选；明确需要继续优化时先传 finalize=false，再按当前版本以 sike_patch_draft 批量局部修订。宿主检查并提交，不为审阅回执另起调用。以下为作者原示例，仅作为规则参照；其中的注释、分析和 dream_delete 不是正式输出格式。\n\n') }
  }
  if (id === IDS.flash && content.includes('{{setvar::sleep_var_thinking_level::') && content.includes('思考核心在于角色分析和遵守写规')) {
    return { action: 'agent-style-focus', content: content
      .replace(/- 思考强度：low\r?\n/, '')
      .replace('独立1000token的思考', '独立的思考')
      .replace('按要求完成思考后闭合标签并开始输出正文。', '按要求完成内部核对后通过原生工具建立正文草稿。') }
  }
  if (id === IDS.model && content.includes('{{setvar::sleep_var_thinking_flag::')) return { action: 'native-model-adapter', content: '模型思考与工具协议由 DSH 原生模型适配器管理，不模拟旧助手前缀或伪造 reasoning_content。' }
  if (id === IDS.selfCheck && content.includes('# 检查范围') && content.includes('# 修复格式') && content.includes('# 输出格式')) {
    return { action: 'agent-editorial-review', content: content
      .replace('FIND、REPLACE 成对输出。', 'FIND、REPLACE 成对作为局部修订参数，分别对应 find、replacement。')
      .replace(/# 输出格式[\s\S]*$/, '# 原生执行格式\n在内部执行上述逐项审稿；可选使用 sike_put_draft 的 review 记录简短正文依据。若明确需要继续优化，先传 finalize=false，再使用 sike_patch_draft 的 expectedVersion 和 patches 一次提交。也支持单项 find、replacement。宿主按返回的当前版本校验并直接确认，不向正文插入 dream_self_check、review 或 patch 标签。\n沿用上述检查范围与唯一定位规则；本局 0–2 次额度约束可选文风优化，无问题立即完成，不强凑改动。额度耗尽即提交可用正文，必要格式和协议修复不计入可选预算；审阅结构不阻断正文。') }
  }
  if (id === IDS.parallel && content.includes('# 平行事件思考') && content.includes('# 平行事件输出')) return { action: 'native-parallel-format', content: content
    .replace('在`<simple_thinking>`内进行一次简短的思考。该思考遵循以下步骤：', '在内部进行一次简短的核对，不向正文输出核对过程。该核对遵循以下步骤：')
    .replace(/^思考预算为400字。\r?\n/m, '')
    .replace(/<simple_thinking>[\s\S]*?<\/simple_thinking>\s*/g, '') }
  if (id === IDS.writing) return { action: 'native-draft-writing', content: content
    .replace(/梦鲸思客，开始根据[\s\S]*?(?=\{\{getvar::sleep_var_thought_of_chain\}\})/, '根据上述写规完成草稿；DREAM_PLOT 文档格式应用于草稿文本，通过原生工具审稿、修订和确认。\n\n') }
  return { content, action: 'preserved' }
}

export function compileDreamSikeContract(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot
  if (snapshot.agentContract?.version === VERSION) return snapshot
  const evidence = []
  const followupEntries = []
  const draftEntries = []
  const phases = {}
  const rawPhases = snapshot.front || snapshot.middle || snapshot.back
    ? snapshot : { front: { entries: [{ id: 'legacy', content: str(snapshot.text), role: 'system' }] } }
  for (const phase of ['front', 'middle', 'back']) {
    const entries = []
    const restored = [...(snapshot.deferredFollowup?.entries || []), ...(snapshot.deferredDraft?.entries || [])]
      .filter(entry => (entry.sourcePhase || entry.phase || 'back') === phase)
    const sourceEntries = [...(rawPhases[phase]?.entries || []), ...restored]
      .filter((entry, index, all) => !(entry.id || entry.entryKey) || all.findIndex(other => (other.id || other.entryKey) === (entry.id || entry.entryKey)) === index)
    for (const entry of sourceEntries) {
      if (!entry || entry.enabled === false || entry.marker === true || !str(entry.content).trim()) continue
      const deferred = DREAM_SIKE_FOLLOWUP_IDS.includes(identifier(entry))
      if (deferred) followupEntries.push({ ...structuredClone(entry), sourcePhase: phase,
        ...(identifier(entry) === IDS.parallel ? { moduleKind: 'parallel', derivedOnly: true } : {}) })
      const adapted = deferred ? { content: '', action: 'deferred-followup' }
        : adapt(entry)
      evidence.push({ id: str(entry.id || entry.entryKey), identifier: identifier(entry), name: str(entry.name || entry.source?.name), phase,
        action: adapted.action, characters: entry.content.length, sourceHash: createHash('sha256').update(entry.content).digest('hex') })
      if (adapted.content.trim()) entries.push({ ...entry, content: adapted.content })
    }
    phases[phase] = { entries, text: entries.map(entry => entry.content).join('\n\n') }
  }
  // The source helper selects a reply mode independently of the shared plot modules.
  // When multiple overrides are enabled, their source order determines the last mode.
  const outputMode = evidence.reduce((mode, entry) => OUTPUT_MODES.get(entry.identifier) || mode, 'plot')
  const instruction = outputModeInstruction(outputMode) + (outputMode === 'plot' && followupEntries.length
    ? '\n【后续互动顺序】本局选定的平行事件、行动选项与思客大调查、说书共创及小摘要由正文提交、变量和记忆结算完成后的一次独立后台调用生成。当前草稿不输出 dream_parallel_event、dream_option、dream_big_discuss、dream_discuss 或 dream_summary，不把后续内容塞入 dream_after_format，也不提前生成；后台沿用其完整作者原文与本轮最终状态，另行显示面板。平行事件是派生展示，不回写本轮变量、记忆或权威世界事实；不得倒流触发正式消息或 MVU 结算。' : '')
  const deferredFollowup = { entries: outputMode === 'plot' ? followupEntries : [],
    digest: createHash('sha256').update(JSON.stringify(followupEntries)).digest('hex') }
  const deferredDraft = { entries: outputMode === 'plot' ? draftEntries : [],
    digest: createHash('sha256').update(JSON.stringify(draftEntries)).digest('hex') }
  const digest = createHash('sha256').update(JSON.stringify({ version: VERSION, presetPath: snapshot.presetPath, phases, evidence, instruction, deferredFollowup, deferredDraft, sourceMacroOverrides: snapshot.sourceMacroOverrides || {}, regexScripts: snapshot.regexScripts || [] })).digest('hex')
  const agentContract = { version: VERSION, digest, presetPath: str(snapshot.presetPath), presetName: str(snapshot.presetName),
    sourceCharacters: evidence.reduce((sum, entry) => sum + entry.characters, 0), entries: evidence,
    outputMode, followupModules: deferredFollowup.entries.map(entry => ({ id: identifier(entry), name: entry.name || entry.source?.name || '',
      ...(entry.derivedOnly ? { derivedOnly: true } : {}) })),
    draftModules: deferredDraft.entries.map(entry => ({ id: identifier(entry), kind: entry.moduleKind, name: entry.name || entry.source?.name || '' })),
    reviewAxes: outputMode === 'plot' ? [...DREAM_SIKE_REVIEW_AXES] : [], instruction }
  return { ...snapshot, ...phases, deferredFollowup, deferredDraft, text: ['front', 'middle', 'back'].map(phase => phases[phase].text).filter(Boolean).join('\n\n'), digest, agentContract }
}

export function dreamSikeContractView(snapshot) {
  return compileDreamSikeContract(snapshot)?.agentContract || null
}

export function needsDreamSikeEditorialReview(chat) {
  if (!isDreamSikeAgentExecution(chat)) return false
  const contract = dreamSikeContractView(chat.runtimePresetSnapshot)
  return contract?.outputMode === 'plot' && Boolean(contract.entries.length)
}

/** Known, enabled source protocols only; no guesses from arbitrary card HTML. */
export function inspectDreamSikeContractDraft(chat, text) {
  if (!needsDreamSikeEditorialReview(chat)) return []
  const contract = dreamSikeContractView(chat.runtimePresetSnapshot)
  const enabled = new Set(contract.entries.map(entry => entry.identifier))
  const issues = []
  const add = (code, message) => issues.push({ code, message })
  const elements = tag => [...str(text).matchAll(new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + tag + '\\s*>', 'gi'))]
  const visibleText = str(text).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '').replace(/<!--[\s\S]*?-->/g, '')
  if (contract.followupModules?.length && /<\/?(?:dream_parallel_event|dream_option|dream_big_discuss|dream_discuss|dream_summary)\b/i.test(visibleText)) {
    add('preset-deferred-followup', '平行事件、行动选项、剧情共创与小摘要属于结算后的独立调用，请从正文草稿移除；原作者规则将由后台执行，不要在当前回合提前输出。')
  }
  if (enabled.has(IDS.envelope)) {
    for (const tag of ['dream_plot', 'dream_body', 'dream_after_format']) {
      if (elements(tag).length !== 1) add('preset-' + tag, '本局已启用 DREAM_PLOT：需要且只能有一个完整 ' + tag + ' 区块')
    }
  }
  if (enabled.has(IDS.scene)) {
    const scenes = elements('dream_scene')
    if (scenes.length !== 1) add('preset-scene', '本局已启用场景栏：正文开始前需一个 dream_scene，包含日期、时间和地点')
    else for (const tag of ['date', 'time', 'location']) {
      if (!new RegExp('<' + tag + '>[\\s\\S]*?\\S[\\s\\S]*?<\\/' + tag + '>').test(scenes[0][1])) add('preset-scene-' + tag, '场景栏缺少非空 ' + tag)
    }
  }
  const body = elements('dream_body')[0]?.[1] || str(text)
  const prose = body.replace(/<(script|style|dream_scene)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<[^>]*>/g, '').replace(/&(?:[a-z]+|#\d+|#x[\da-f]+);/gi, ' ').trim()
  if (enabled.has(IDS.length)) {
    const compiled = compileDreamSikeContract(chat.runtimePresetSnapshot)
    const resolved = resolveRuntimePresetMacros(compiled, { charName: chat.cardName, macroState: chat.macroState })
    const selectedLength = str(resolved.macroState.local.sleep_var_zishu)
      || compiled[contract.entries.find(entry => entry.identifier === IDS.length)?.phase]?.entries.find(entry => identifier(entry) === IDS.length)?.content || ''
    const minimum = Number(selectedLength.match(/(\d+)\s*(?:到|至|[-–~～])\s*\d+/)?.[1] || selectedLength.match(/(\d+)\s*字/)?.[1])
    const operation = Object.values(chat.timeline?.operations || {}).find(item => item.kind === 'body' && item.status === 'running' && item.basedOn?.branchId === chat.timeline?.branchId)
    // A player's explicit length overrides the preset; ordinary dialogue numbers do not.
    const explicitLength = /(?:正文|回复|写|输出|篇幅|字数)[^\n]{0,15}(?:\d+|[一二三四五六七八九十百千]+)\s*(?:到|至|[-~～])?\s*\d*\s*字|(?:简短|短一点|长一点|展开写)/.test(str(operation?.userText))
    if (!explicitLength && minimum > 0 && Array.from(prose.replace(/\s/g, '')).length < minimum) add('preset-body-length', '本局已选字数要求正文至少 ' + minimum + ' 字（不计场景栏、HTML标签和后置栏）；请充实实际互动、动作及后果')
  }
  if (enabled.has(IDS.writing) && prose.includes('指节泛白')) add('preset-banned-word', '已选写规禁止正文使用“指节泛白”')
  if (enabled.has(IDS.banned)) {
    if (/[—–]/.test(prose)) add('preset-banned-dash', '已选禁词规则禁止正文使用破折号')
    if (/不急不缓|不轻不重|声音很轻/.test(prose)) add('preset-banned-phrase', '正文出现已选禁词规则明确禁止的质地或双重否定短语')
  }
  return issues
}
