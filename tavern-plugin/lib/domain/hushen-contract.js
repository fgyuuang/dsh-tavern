import { createHash } from 'node:crypto'
import { HUSHEN_IDS, HUSHEN_CHAIN_IDS, HUSHEN_PREFILL_IDS, HUSHEN_BOUNDARY_IDS, HUSHEN_ARCHIVE_IDS, HUSHEN_DYNAMIC_IDS,
  HUSHEN_PHASES, HUSHEN_REVIEW_AXES, hushenIdentifier, hushenOwnedMacroKeys,
  isHushenSource, isHushenAgentExecution, resolveHushenPresetMacros } from './hushen-source.js'

const VERSION = 1
const str = value => typeof value === 'string' ? value : ''
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')

export const HUSHEN_CONTRACT_INSTRUCTION = `【狐神抚 DSH · 原作者写作契约】
本局使用狐神抚原作者规则，保持初始化宏、选项写入、第一阶段基础要求和第二阶段输出前检查的顺序。人物、感知边界、叙事方法、文风、人称、玩家输入转述、抢话授权、篇幅、正文标签、狐策和其他启用功能由已选原文决定。不得替换成其他预设的写法或添加其他预设的文档外壳。
当前请求已装配的作者原文和材料直接复用；缺少具体依据时才用 sike_read_turn 补查。原文确有缺页时按需完整读取，摘要不是规则原文。连续续读用 includeMaterials=false、includeDraft=false，避免重复材料。卡片、世界书、分支历史、最新输入和本局记忆按原生工具读取；源文件导出的旧会话记忆不成为当前局事实。
按所选作者方法在内部完成感知边界、人物动机、情绪承接、情节节拍、潜文本、技法、反套路和硬规则核对。原文中的思考输出模板表示作者的工作步骤，不要求输出或存储完整私有推理，不伪造供应商 reasoning 或 assistant 预填充。可以保留可观察的角色内心描写；它与 Agent 的私有推理不同。
正文可直接输出，或通过 sike_put_draft 一次保存 text，review 可选。scene、characters、knowledge、style、progression、stopAt 可在同次 brief 中记录简短事实和约束；不要求额外模型调用。review 的 character、knowledge、style、continuity、playerAgency、format 各为 pass/revise 与简短正文依据。发现具体问题时合并为唯一定位的 sike_patch_draft patches，并提交当前 expectedVersion 和修改后 review。本局预算约束可选查询和文风优化；只有已明确需要继续优化时传 finalize=false。预算结束即提交可用正文，必要格式、协议修复和最终提交不占可选额度；不为审阅回执或凑次数发起调用。
作者狐稿规则定义检查范围与修正标准，原来的草稿/分析标签仅作工作方法参考。正式正文仅保留完成的可见文档，不夹带 <draft>、<think_fox~> 或完整核对过程。宿主同次检查并确认；通过后只提交草稿一次，不在主聊天重新写一遍。
正文使用所选原正文标签及原卡片 HTML。狐策四个选项和短评、狐神留言、狐构大纲、狐映信息载体和总结在启用时仍按原协议随本次文档完成；当前实现尚未把这些功能迁往额外调用，不得遗漏。信息载体是可见剧情表现，不能擅自把载体内容升级为角色已知事实。
MVU、JSONPatch 和状态变量由正文确认后的原生后台结算，同一回合只结算一次；草稿禁止输出 UpdateVariable 或可执行变量补丁。角色卡已要求的可见状态栏保留其标签、字段和顺序，后台采用作者所选状态模式及卡片规则；不另开旧助手模型任务。压缩/重启后恢复规则、当前分支材料和唯一草稿。原脚本高级狐忆、狐裁、数据库、图像和额外模型功能只有标记为已接入的能力可调用，partial 状态不表示原脚本已运行。`

function adaptPlanning(content) {
  // Changes are restricted to known planning entries and their output envelope.
  // The author's task ordering, examples and individual checks remain in place.
  return content
    .replace('在正文之前用<think_fox~>标签包裹以下内容做输出自检:', '正文前在内部依照以下作者步骤核对：')
    .replace('在正文之前用<think_fox~>标签包裹以下内容做输出一次思考，禁止跳过！:', '正文前在内部依照以下作者步骤核对一次，保留全部任务：')
    .replace(/<\/?think_fox~>/g, '')
    .replace(/^\s*在18步后输出：\s*$/gm, '在18步后完成内部核对，通过原生草稿工具提交正文：')
    .replace(/^\s*<content>\s*$/gm, '')
}

function adaptDraft(content, paragraph) {
  if (paragraph && content.includes('# 文本自检') && content.includes('格式参考：')) {
    let criteria = content.slice(content.indexOf('# 文本自检'), content.indexOf('格式参考：'))
    criteria = criteria
      .replace('按以下三组顺序检查，全部通过后输出“自检通过”，闭合 `</draft>` 并输出正文。', '按以下作者分组顺序内部检查，正式正文只保存检查后的内容。')
      .replace('→ [通过/未通过，逐项指出违规处]', '→ 内部逐项核对；原生 review 仅保存可观察问题与结论。')
      .replace('- 若全部通过 → 输出"自检通过"，然后闭合 </draft>，接着输出下一段正文', '- 若全部通过 → 保存修正后的正文；需要修改时合并为当前版本的局部补丁。')
    return '{{setvar::draft::\n【狐稿·分段原生检查】\n每个自然段按以下作者标准检查；首次通过 sike_put_draft 提交唯一完整正文，后续按本局预算使用 sike_patch_draft。草稿、吐槽、自检过程及通过口号不进入正式正文，不要求逐段独立模型请求。\n'
      + criteria + '\n段落划分以自然场景或节奏断点为界，每段不超过500字。\n}}'
  }
  if (!paragraph && content.includes('# 模块一：文本句式自检') && content.includes('第三步：输出自检结论')) {
    const criteria = content.slice(content.indexOf('# 模块一：文本句式自检'), content.indexOf('第三步：输出自检结论'))
    return '{{setvar::draft::\n【狐稿·全量原生检查】\n一次建立完整正文草稿，按以下完整作者标准内部检查。首次通过 sike_put_draft 同次提交正文与 review；修订通过 sike_patch_draft 保存唯一定位补丁和修改后结果。review 只含简短可观察正文依据，不展开私有推理、不输出草稿标签或自检过程，不因源格式模板要求无限循环模型调用。\n'
      + criteria + '\n检查完成后仅保存正式可见正文。\n}}'
  }
  // User-edited rules retain their wording; only the known private envelope changes.
  return content.replace(/<\/?draft>/g, '')
}

function adapt(entry, snapshot) {
  const id = hushenIdentifier(entry), content = str(entry.content)
  if (HUSHEN_ARCHIVE_IDS.includes(id)) return { content: '', action: 'archive-only-not-in-source-order' }
  if (HUSHEN_PREFILL_IDS.includes(id)) return { content: '', action: 'native-model-adapter' }
  if (HUSHEN_BOUNDARY_IDS.includes(id)) return { content: '', action: 'native-material-boundary' }
  if (id === HUSHEN_IDS.latestRequest) return {
    content: content.replace(/<\/?User_latest_request>/g, '').replace("Here is the user's latest request :", '')
      .replace('{{lastUserMessage}}', ''), action: 'native-current-input'
  }
  if (HUSHEN_DYNAMIC_IDS.includes(id) && id !== HUSHEN_IDS.nativePlanningSlot
    && !(snapshot.hushenCurrentGameMaterialIds || []).includes(id)) return { content: '', action: 'native-current-game-material' }
  if (HUSHEN_CHAIN_IDS.includes(id) || id === HUSHEN_IDS.nativePlanningSlot) return {
    content: adaptPlanning(content), action: 'native-private-planning'
  }
  if ([HUSHEN_IDS.draftParagraph, HUSHEN_IDS.draftFull].includes(id)) return {
    content: adaptDraft(content, id === HUSHEN_IDS.draftParagraph), action: 'native-draft-review'
  }
  if ([HUSHEN_IDS.mvuExternal, HUSHEN_IDS.mvuInline, HUSHEN_IDS.mvuCustom].includes(id)) return {
    content: '{{setvar::mvu::本局变量更新由原生后台依据角色卡协议及当前所选作者变量模式处理，正文不包含 UpdateVariable、JSONPatch 或可执行变量块。状态结算只依据正式提交正文执行一次；卡片要求的可见状态栏不变。}}',
    action: 'native-state-settlement'
  }
  return { content, action: 'preserved' }
}

export function compileHushenContract(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot
  if (snapshot.agentContract?.author === 'hushen' && snapshot.agentContract.version === VERSION) return snapshot
  if (!isHushenSource(snapshot)) throw new Error('狐神抚 Agent 需要匹配的狐神抚原预设，当前来源不匹配；未应用其他作者规则。')
  const evidence = [], phases = {}, stateRules = []
  const raw = snapshot.front || snapshot.middle || snapshot.back ? snapshot
    : { front: { entries: [{ id: 'legacy', role: 'system', content: str(snapshot.text) }] } }
  for (const phase of HUSHEN_PHASES) {
    const entries = []
    for (const entry of raw[phase]?.entries || []) {
      if (!entry || entry.enabled === false || entry.marker === true || !str(entry.content).trim()) continue
      const adapted = adapt(entry, snapshot)
      if ([HUSHEN_IDS.mvuExternal, HUSHEN_IDS.statusPanel, HUSHEN_IDS.mvuInline, HUSHEN_IDS.mvuCustom].includes(hushenIdentifier(entry))) {
        stateRules.push({ identifier: hushenIdentifier(entry), name: str(entry.name || entry.source?.name),
          content: entry.content, sourceHash: hash(entry.content), characters: entry.content.length,
          mode: hushenIdentifier(entry) === HUSHEN_IDS.statusPanel ? 'visible-panel'
            : hushenIdentifier(entry) === HUSHEN_IDS.mvuExternal ? 'external'
              : hushenIdentifier(entry) === HUSHEN_IDS.mvuInline ? 'inline' : 'custom' })
      }
      evidence.push({ id: str(entry.id || entry.entryKey), identifier: hushenIdentifier(entry),
        name: str(entry.name || entry.source?.name), phase, action: adapted.action,
        characters: entry.content.length, sourceHash: hash(entry.content) })
      if (adapted.content.trim()) entries.push({ ...entry, content: adapted.content })
    }
    phases[phase] = { entries, text: entries.map(entry => entry.content).join('\n\n') }
  }
  const reset = hushenOwnedMacroKeys(snapshot)
  const sourceRuleIds = evidence.filter(entry => entry.action !== 'archive-only-not-in-source-order').map(entry => entry.identifier)
  const instruction = HUSHEN_CONTRACT_INSTRUCTION
  const digest = hash({ version: VERSION, author: 'hushen', phases, evidence, instruction,
    overrides: snapshot.sourceMacroOverrides || {}, reset,
    stateRules, currentGameMaterialIds: snapshot.hushenCurrentGameMaterialIds || [],
    regexes: (snapshot.regexScripts || []).map(regex => ({ id: regex.id, enabled: regex.enabled,
      sourceHash: hash([regex.findRegex || '', regex.replaceString || '']) })) })
  const agentContract = { author: 'hushen', version: VERSION, digest, outputMode: 'plot',
    presetPath: str(snapshot.presetPath), presetName: str(snapshot.presetName),
    sourceCharacters: evidence.reduce((count, entry) => count + entry.characters, 0), entries: evidence,
    stateRules,
    reviewAxes: [...HUSHEN_REVIEW_AXES], instruction, sourceRuleIds,
    macroResetKeys: reset.local, macroResetGlobalKeys: reset.global,
    followupModules: [], draftModules: [],
    compatibility: { status: 'partial', nativeAuthorRules: true,
      originalHelperBundleExecuted: false, legacyStaticMemoryImported: false,
      reason: '作者规则及可见协议已适配；旧助手高级模块逐项接入，不以脚本存在推断运行成功。' } }
  return { ...snapshot, ...phases, digest, agentContract,
    deferredFollowup: { entries: [], digest: hash([]) }, deferredDraft: { entries: [], digest: hash([]) },
    text: HUSHEN_PHASES.map(phase => phases[phase].text).filter(Boolean).join('\n\n') }
}

export function needsHushenEditorialReview(chat) {
  if (!isHushenAgentExecution(chat)) return false
  const contract = compileHushenContract(chat.runtimePresetSnapshot)?.agentContract
  return contract?.author === 'hushen' && contract.entries.length > 0
}

/** Deterministic checks on selected author protocols; no guesses about prose quality. */
export function inspectHushenContractDraft(chat, text) {
  if (!needsHushenEditorialReview(chat)) return []
  const compiled = compileHushenContract(chat.runtimePresetSnapshot)
  const enabled = new Set(compiled.agentContract.entries.map(entry => entry.identifier))
  const issues = [], add = (code, message) => issues.push({ code, message })
  const visible = str(text).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '').replace(/<!--[\s\S]*?-->/g, '')
  const blocks = tag => [...visible.matchAll(new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + tag + '\\s*>', 'gi'))]
  let body = ''
  if (/<\/?(?:think_fox~|draft)\s*>/i.test(visible)) add('hushen-private-envelope', '正式正文不包含写前推理或工作草稿标签；请保留完成的可见文档。')
  if (/<\/?(?:UpdateVariable|JSONPatch)\b/i.test(visible)) add('hushen-state-protocol', '变量补丁由原生后台结算，不能写入正文草稿。')
  if (enabled.has(HUSHEN_IDS.bodyTag)) {
    const rendered = resolveHushenPresetMacros(compiled, { charName: chat.cardName, macroState: chat.macroState })
    const tag = str(rendered.macroState?.local?.format1).match(/当前格式[：:]\s*<([A-Za-z][\w:-]*)>/)?.[1]
    if (tag && blocks(tag).length !== 1) add('hushen-body-tag', '当前正文标签要求一个完整 ' + tag + ' 区块；不要套入其他预设的文档外壳。')
    if (tag) body = blocks(tag)[0]?.[1] || ''
  }
  if (enabled.has(HUSHEN_IDS.actions)) {
    const selections = blocks('fox_selc'), tips = blocks('fox_tip')
    if (selections.length !== 1 || !selections[0]?.[1].trim()) add('hushen-actions', '已启用狐策：需要一个独立且非空的 fox_selc 行动选项区块。')
    if (tips.length !== 1 || !tips[0]?.[1].trim()) add('hushen-action-tip', '已启用狐策：需要独立且非空的 fox_tip 短评。')
    const source = HUSHEN_PHASES.flatMap(phase => compiled[phase]?.entries || []).find(entry => hushenIdentifier(entry) === HUSHEN_IDS.actions)?.content || ''
    if (source.includes('4 个') && selections.length === 1 && [...selections[0][1].matchAll(/<font\b[^>]*>[\s\S]*?<\/font\s*>/gi)].length !== 4) add('hushen-actions-count', '当前狐策原规则要求四个以颜色标注的行动选项。')
    if (/<\/?(?:fox_selc|fox_tip)\b/i.test(body)) add('hushen-actions-independent', '狐策选项和短评必须位于正文标签外，独立于正文与状态栏。')
  }
  if (enabled.has(HUSHEN_IDS.commentary) && (blocks('fox').length !== 1 || !blocks('fox')[0]?.[1].trim())) add('hushen-commentary', '已启用狐神留言：需要一个独立 fox 留言区块。')
  if (enabled.has(HUSHEN_IDS.commentary) && /<fox(?:\s[^>]*)?>/i.test(body)) add('hushen-commentary-independent', '狐神留言须在正文标签外独立输出。')
  if (enabled.has(HUSHEN_IDS.sceneClock)) {
    const clocks = [...visible.matchAll(/<ft_clock\b([^>]*)\/?\s*>/g)]
    if (!clocks.length) add('hushen-scene-clock', '已启用时间地点：需要 ft_clock 标记，填写正文结束时的剧情天数和当日绝对分钟。')
    for (const clock of clocks) {
      const day = clock[1].match(/\bday\s*=\s*["'](\d+)["']/)?.[1]
      const minute = clock[1].match(/\bminute\s*=\s*["'](\d+)["']/)?.[1]
      if (!day || Number(day) < 1 || minute === undefined || Number(minute) > 1439) add('hushen-scene-clock-value', 'ft_clock 的 day 须至少为 1，minute 须为 0–1439 的整数。')
    }
  }
  if (enabled.has(HUSHEN_IDS.outline)) {
    const outlines = blocks('fox_hugou')
    if (outlines.length !== 1) add('hushen-outline', '已启用狐构：需要一个完整 fox_hugou 大纲区块。')
    else {
      // The source has four required fields and two optional fields, not six required fields.
      for (const field of ['主线进度', '已完成事件', '当前阶段', '下一阶段']) if (!new RegExp('#' + field + '\\s+\\S').test(outlines[0][1])) add('hushen-outline-' + field, '狐构缺少非空字段 #' + field)
      const allowed = new Set(['主线进度', '已完成事件', '当前阶段', '下一阶段', '伏笔状态', '剧情走向'])
      if ([...outlines[0][1].matchAll(/^\s*#([^\s#]+)/gm)].some(match => !allowed.has(match[1]))) add('hushen-outline-field', '狐构仅允许原作者六种字段，不添加其他字段。')
      if (/<[^>]+>|```|\|/.test(outlines[0][1])) add('hushen-outline-format', '狐构字段内不使用 HTML、代码块或表格。')
      if (body && !body.includes(outlines[0][0])) add('hushen-outline-position', '狐构应位于正文标签内的开头。')
    }
  }
  if (enabled.has(HUSHEN_IDS.frontend)) {
    const fronts = blocks('fox_front'), markers = [...visible.matchAll(/<fox-front-view\b[^>]*\bdata-front\s*=\s*["']([a-z0-9]{6})["'][^>]*>\s*<\/fox-front-view>/g)]
    // Triggering the feature depends on scene meaning; validate only emitted protocol blocks.
    if (fronts.length || /<fox-front-view\b/.test(visible)) {
      if (fronts.length !== markers.length || new Set(markers.map(marker => marker[1])).size !== markers.length) add('hushen-frontend-pairing', '狐映需要一一配对的 fox-front-view 与 fox_front，且 data-front 是不重复的六位小写字母数字。')
      for (const front of fronts) if (!front[1].includes('<fox_front_insert>') || !/#意图\s+\S/.test(front[1]) || !/#(?:正文|补充)\s+\S/.test(front[1])) add('hushen-frontend-fields', '狐映需求块需保留 fox_front_insert，占有非空 #意图，且 #正文 或 #补充 至少一项非空。')
    }
  }
  return issues
}
