import { createHash } from 'node:crypto'
import { resolveRuntimePresetMacros } from './runtime-presets.js'

export const DREAM_SIKE_REVIEW_AXES = Object.freeze(['character', 'knowledge', 'style', 'continuity', 'playerAgency', 'format'])
const VERSION = 2
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
  if (id === IDS.persona) return { action: 'native-persona', content: '【梦境思客】以人物卡世界为依据，维护拟真、人物独立性和情节可能性。梦境思客是叙事职责，不作为角色进入世界。按本局启用的写作规则创作，不让预设中的身份或格式宣言覆盖平台工具协议。' }
  if (id === IDS.thinking) return { action: 'agent-planning', content: `{{setvar::sleep_var_thought_of_chain::
【写前决策流程】
一、检设定：核对相关世界书、历史与当前状态；缺少依据时检索，区分正文前、中、后必须插入的卡片格式，禁止编造未要求的状态栏。
二、辨视角：{{getvar::sleep_var_char_analysis}}。核对各角色的动机、当下情绪、能力和可知信息，不能让角色获得超出认知的知识。
三、遵写规：逐项采用 writing_setting 的已选文风、视角、禁词、字数和玩家输入处理方式。
四、演叙事：依据已发生的因果，构思至少三条候选事件链，每条两至三次因果连接，含至少一条主线和一条有持续影响的支线；只选符合当前回合条件的推进，不强行把所有候选写进正文。采用选定的叙事者基调，保留玩家下一步重大决定。
{{getvar::sleep_var_addition_thinking}}
五、先草稿后审稿：完成正文，再核查人物、信息差、文风、承接、玩家选择和渲染格式；具体缺陷以工具局部修订。只提交简短可验证的审稿结果，不展示完整思考过程。
}}` }
  if (id === IDS.flash) return { action: 'agent-style-focus', content: '{{setvar::sleep_var_thinking_level::优先核对角色分析和已选文风；按复杂度调用检索，不用固定思考字数或口号约束模型。正文草稿与审稿通过原生工具执行。}}' }
  if (id === IDS.model) return { action: 'native-model-adapter', content: '模型思考与工具协议由 DSH 原生模型适配器管理，不模拟旧助手前缀或伪造 reasoning_content。' }
  if (id === IDS.selfCheck) return { action: 'agent-editorial-review', content: '【末尾修正】草稿完成后按人物、信息差、已选文风、因果承接、玩家重大决定和格式逐项审稿。发现具体缺陷时用 sike_patch_draft 修订受影响片段并复查。通过 sike_check_draft 记录简短审稿依据，不在正文输出自修复或思考协议。' }
  if (id === IDS.parallel) return { action: 'native-parallel-format', content: content
    .replace(/# 平行事件思考[\s\S]*?(?=# 平行事件输出)/, '平行事件写前须核对所选人物、所经历事件、与主场景同步的时间流逝、是否重复及人物认知边界；不输出私有思考。\n\n')
    .replace(/<simple_thinking>[\s\S]*?<\/simple_thinking>\s*/g, '') }
  if (id === IDS.writing) return { action: 'native-draft-writing', content: content
    .replace(/【最新输入】[\s\S]*?<\/dreamer_input>/, '【最新输入】采用本回合前台材料中的实际玩家输入，不以历史末条或宏占位文字代替。')
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
  const digest = createHash('sha256').update(JSON.stringify({ version: VERSION, presetPath: snapshot.presetPath, phases, evidence, instruction: DREAM_SIKE_CONTRACT_INSTRUCTION, regexScripts: snapshot.regexScripts || [] })).digest('hex')
  const agentContract = { version: VERSION, digest, presetPath: str(snapshot.presetPath), presetName: str(snapshot.presetName),
    sourceCharacters: evidence.reduce((sum, entry) => sum + entry.characters, 0), entries: evidence,
    reviewAxes: [...DREAM_SIKE_REVIEW_AXES], instruction: DREAM_SIKE_CONTRACT_INSTRUCTION }
  return { ...snapshot, ...phases, text: ['front', 'middle', 'back'].map(phase => phases[phase].text).filter(Boolean).join('\n\n'), digest, agentContract }
}

export function dreamSikeContractView(snapshot) {
  return compileDreamSikeContract(snapshot)?.agentContract || null
}

export function needsDreamSikeEditorialReview(chat) {
  return chat?.playPresetId === 'dream-sike-dsh' && Boolean(dreamSikeContractView(chat.runtimePresetSnapshot)?.entries.length)
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
