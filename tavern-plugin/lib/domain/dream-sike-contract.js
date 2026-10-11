import { createHash } from 'node:crypto'
import { resolveRuntimePresetMacros } from './runtime-presets.js'

export const DREAM_SIKE_REVIEW_AXES = Object.freeze(['character', 'knowledge', 'style', 'continuity', 'playerAgency', 'format'])
const VERSION = 6
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
  return `【Agent 当前输出模式】\n${selected}\n原模式明确免除 DREAM_PLOT 及其他剧情输出协议，因此本回合不要求 dream_plot、dream_body、dream_after_format、场景栏、平行事件、剧情字数、剧情文风或写前六项剧情简报。已启用的原模式内容定义回复要求。\n通过 sike_put_draft 建立本回合唯一回复，以 sike_check_draft 检查原生提交协议，sike_ready_draft 确认后仅提交原文一次。工具协议、后台变量结算与私有推理边界仍适用；不要在回复或工具参数输出 think、simple_thinking、thinking_step、思考前缀或完整私有推理。`
}
const WRAPPERS = new Set([
  '15b0ffd7-b3f3-42bd-989d-12b48c3b64e3', 'e0032969-7a36-4fe1-8bb9-c01effb1860b',
  '3588b992-33b7-4dd9-9280-0d13f70e04db', 'd6fa9796-1521-4b1c-bf26-75273339e399',
  '0257d3af-fe22-4d44-a905-695f0d4a5397', 'd0d838dd-972c-4dec-b584-fb9c8ba39733',
  'e393d2c5-c816-46d8-9307-6755fafcaab8', '250dd7ab-e6fa-4b5f-abf0-5e488451d033'
])

export const DREAM_SIKE_CONTRACT_INSTRUCTION = `【Agent 写作契约】
本局选定的原酒馆预设仍定义人物分析、叙事者、文风、视角、输入转述、字数、场景栏、平行事件及卡片格式。逐项执行已启用规则；未启用条目不加载。Skills 提供方法，不覆盖本局选择。当前玩家明确的修改优先于默认写法。
原预设的正文/XML/HTML要求约束 sike_put_draft 的完整可渲染文本，保留 dream_plot、dream_body、dream_after_format、dream_scene、dream_parallel_event 等已要求的外壳及卡片 HTML。这些外壳不约束原生工具调用。变量交由后台结算，禁止混入 UpdateVariable。
写前核对设定、相关历史和格式，分析人物动机、情绪与各自可知信息；按原预设的叙事者和输入处理方式决定本回合推进。需要依据时用原生检索工具。原来的思考链是写作决策流程，不在正文、工具参数或工作窗输出完整私有推理、think/simple_thinking标签或思考口号。
原作者的四章步骤与各可选模块是本局工作方法。sike_read_turn 提供原文规则索引、已展开写规、叙事者、人物分析和材料区域；有规则续读位置时按需继续读取，不能把索引摘要当作完整规则。原 dream_setting、dream_dx_setting、dream_history 等区域按 materialAreas 对应当前卡片、有效世界书、状态和分支历史，不把原生工具消息改为旧酒馆的文本协议。
已启用写前决策流程时，先调用 sike_read_turn，按需加载 dream-sike-planning Skill；再用 sike_prepare_turn 保存 scene、characters、knowledge、style、progression、stopAt 六项简短事实与执行约束，之后才能建立草稿。候选事件链在内部评估，不提交推理过程。这个准备记录与当前回合、分支及规则版本绑定，不能由其他回合沿用。
建立唯一草稿后，以六项可观察标准审稿：人物声音与行动、信息差、已选文风与字数、时间因果与情节承接、玩家重大决定的保留、场景/平行事件/卡片格式。通过 sike_check_draft 的 review 提供各项 pass/revise 和简短正文依据；这是审稿结果，不是推理过程。发现具体缺陷须局部修订并重新审稿，无问题允许零补丁。不能用“标签没错”代替文风检查。
简单场景可减少检索次数，仍须遵守文风和已启用输出功能。扩写玩家已输入的动作与台词由本局转述规则决定；不得替玩家作未选择的重大决定。若选定平行事件，则允许读者看到场外事件，但场内人物不能因此自动知情。
确认后仅提交草稿原文一次，不在聊天重写或缩短正文。压缩后本契约和已选规则仍会重新装配；长期事实按需从记忆及原历史恢复。`

function identifier(entry) {
  return str(entry.source?.identifier) || str(entry.identifier) || str(entry.id || entry.entryKey).replace(/#\d+$/, '')
}

function adapt(entry) {
  const id = identifier(entry)
  const content = str(entry.content)
  if (WRAPPERS.has(id)) return { content: '', action: 'native-material-boundary' }
  if (id === IDS.persona && content.includes('<meta>') && content.includes('谨记你的首要职责')) {
    const duty = content.match(/谨记你的首要职责[^。\n]*。/)?.[0]
    if (duty) return { action: 'native-persona', content: '【梦鲸思客】\n' + duty }
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
      .replace(/^在你的思考过程（<think>标签内）中，请遵守以下规则：$/m, '以下为写前内部核对步骤；保留作者任务顺序，不向正文或工具参数展开私有推理。')
      .replace(/^- 你在思考前，必须需要严格遵守.*$/m, '')
      .replace(/^- 你的思考输出必须.*$/m, '')
      .replace(/^- 思考内容仅允许输出一次.*$/m, '')
      .replace(/^```(?:thinking_step)?\s*$/gm, '')
      .replace(/^在思考开始时输出：.*$/m, '')
      .replace(/^终、定乾坤：.*$/m, '终、定乾坤：完成内部核对后，通过 sike_put_draft 建立唯一正文草稿。')
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
      .replace(/## 输出格式规范[\s\S]*?(?=## 范例)/, '## 原生执行格式\n通过 sike_check_draft 检查草稿，发现具体问题时调用 sike_patch_draft 并复查。以下为作者原示例，仅作为规则参照；其中的注释、分析和 dream_delete 不是正式输出格式。\n\n') }
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
      .replace(/# 输出格式[\s\S]*$/, '# 原生执行格式\n使用 sike_patch_draft 的 expectedVersion、find、replacement 修改当前草稿；每次依据工具返回的新版本继续核对。使用 sike_check_draft 的 review 记录逐项审稿结果和简短正文依据，不向正文插入 dream_self_check、review 或 patch 标签。\n沿用上述检查范围与唯一定位规则，遵守本回合修订上限。明确缺陷须处理；无问题允许零补丁，不强凑改动数量。') }
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
  const phases = {}
  const rawPhases = snapshot.front || snapshot.middle || snapshot.back
    ? snapshot : { front: { entries: [{ id: 'legacy', content: str(snapshot.text), role: 'system' }] } }
  for (const phase of ['front', 'middle', 'back']) {
    const entries = []
    for (const entry of rawPhases[phase]?.entries || []) {
      if (!entry || entry.enabled === false || entry.marker === true || !str(entry.content).trim()) continue
      const adapted = adapt(entry)
      evidence.push({ id: str(entry.id || entry.entryKey), identifier: identifier(entry), name: str(entry.name || entry.source?.name), phase,
        action: adapted.action, characters: entry.content.length, sourceHash: createHash('sha256').update(entry.content).digest('hex') })
      if (adapted.content.trim()) entries.push({ ...entry, content: adapted.content })
    }
    phases[phase] = { entries, text: entries.map(entry => entry.content).join('\n\n') }
  }
  // The source helper selects a reply mode independently of the shared plot modules.
  // When multiple overrides are enabled, their source order determines the last mode.
  const outputMode = evidence.reduce((mode, entry) => OUTPUT_MODES.get(entry.identifier) || mode, 'plot')
  const instruction = outputModeInstruction(outputMode)
  const digest = createHash('sha256').update(JSON.stringify({ version: VERSION, presetPath: snapshot.presetPath, phases, evidence, instruction, sourceMacroOverrides: snapshot.sourceMacroOverrides || {}, regexScripts: snapshot.regexScripts || [] })).digest('hex')
  const agentContract = { version: VERSION, digest, presetPath: str(snapshot.presetPath), presetName: str(snapshot.presetName),
    sourceCharacters: evidence.reduce((sum, entry) => sum + entry.characters, 0), entries: evidence,
    outputMode, reviewAxes: outputMode === 'plot' ? [...DREAM_SIKE_REVIEW_AXES] : [], instruction }
  return { ...snapshot, ...phases, text: ['front', 'middle', 'back'].map(phase => phases[phase].text).filter(Boolean).join('\n\n'), digest, agentContract }
}

export function dreamSikeContractView(snapshot) {
  return compileDreamSikeContract(snapshot)?.agentContract || null
}

export function needsDreamSikeEditorialReview(chat) {
  if (chat?.playPresetId !== 'dream-sike-dsh') return false
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
  if (enabled.has(IDS.parallel)) {
    const parallels = elements('dream_parallel_event')
    if (parallels.length !== 1) add('preset-parallel', '本局已启用平行事件：文末需一个 dream_parallel_event 区块')
    else {
      const rows = parallels[0][1].trim().split(/\r?\n/).filter(line => line.trim())
      if (rows.length < 1 || rows.length > 3 || rows.some(line => !line.includes('|') || !/<br\s*\/?\s*>/i.test(line))) {
        add('preset-parallel-rows', '平行事件需 1–3 个物理行，每行采用 地点|描述，并含至少一个 <br>')
      }
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
