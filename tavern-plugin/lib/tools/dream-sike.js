import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  dreamSikeDraftView, dreamSikeTurnIdentity,
  submitDreamSikeDraft, reviseDreamSikeDraft, finishDreamSikeDraftSubmission, readyDreamSikeDraft
} from '../domain/dream-sike-draft.js'
import { DREAM_SIKE_REVIEW_AXES, dreamSikeContractView, needsDreamSikeEditorialReview } from '../domain/dream-sike-contract.js'
import { dreamSikePreparationView, needsDreamSikePreparation, prepareDreamSikeTurn, recordDreamSikeTurnRead } from '../domain/dream-sike-preparation.js'
import { readDreamSikeAgentRules } from '../domain/dream-sike-agent-profile.js'
import { isDreamSikeAgentExecution } from '../domain/generation-mode.js'
import { draftModuleReceiptCurrent, dreamSikeDraftModulePlan } from '../domain/dream-sike-draft-modules.js'
import { dreamSikeToolPhase } from '../domain/dream-sike-tool-phase.js'
import { exhaustedModelQuota } from '../domain/model-error-presentation.js'
import { normalizeDreamSikeExecutionPolicy } from '../domain/dream-sike-execution-policy.js'

const output = {
  schema: {
    type: 'object', additionalProperties: false,
    properties: { report: { type: 'string', required: true }, draft: { type: 'json', required: true } }
  },
  render(_args, value) { return [{ type: 'text', text: value.report }] }
}

function str(value) { return typeof value === 'string' ? value : '' }
function clip(value, limit) { return str(value).slice(0, limit) }
// Advertise the actual structure while admitting the equivalent JSON text emitted by some models.
// The native validator runs first; both supported shapes must reach our normalizer.
const integerInput = (description, required = false) => ({
  oneOf: [{ type: 'integer' }, { type: 'string' }], description, ...(required ? { required: true } : {})
})
const jsonInput = (schema, description) => ({ oneOf: [schema, { type: 'string' }], description })
function draftVersion(value) {
  const version = typeof value === 'string' ? Number(value.trim()) : value
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('expectedVersion 必须是整数草稿版本；请先用 sike_read_turn 读取当前版本')
  return version
}
function jsonArgument(value, label) {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch (_) { throw new Error(label + ' 需要 JSON 结构，不能是普通文本') }
}
function offsetArgument(value, fallback) {
  if (value === undefined || value === null) return fallback
  const number = typeof value === 'string' ? Number(value.trim()) : value
  if (!Number.isSafeInteger(number) || number < 0) throw new Error('续读位置必须是非负整数')
  return number
}
// The model tracks the draft version loosely and often names an older one. When it points at a
// different version of the same live, unconfirmed draft, follow the draft rather than spending the
// step on a rejection; the module layer still guards against the draft changing mid-call.
function followedVersion(chat, identity, value) {
  const requested = draftVersion(value)
  const draft = chat?.dreamSikeDraft
  const live = draft && draft.status === 'draft' && draft.operationId === identity.operationId
    && draft.branchId === identity.branchId && draft.turn === identity.turn ? draft.version : null
  return Number.isSafeInteger(live) && live !== requested ? live : requested
}
const PREPARATION_KEYS = ['scene', 'characters', 'knowledge', 'style', 'progression', 'stopAt']
const briefInput = () => jsonInput({ type: 'object', additionalProperties: false,
  properties: Object.fromEntries(PREPARATION_KEYS.map(key => [key, { type: 'string', required: true }]))
}, '可选六项简报 {scene, characters, knowledge, style, progression, stopAt}；每项非空、最多400字符。与正文同次提交，不展开内部推理。')
const reviewInput = () => jsonInput({ type: 'object', additionalProperties: false,
  properties: Object.fromEntries(DREAM_SIKE_REVIEW_AXES.map(axis => [axis, {
    type: 'object', required: true, additionalProperties: false,
    properties: { status: { type: 'string', required: true, enum: ['pass', 'revise'] },
      evidence: { type: 'string', required: true, description: '8–500字符的具体正文依据，不能只写检查通过' } }
  }]))
}, '剧情必填六维审阅：character、knowledge、style、continuity、playerAgency、format，各为 {status:"pass"或"revise",evidence:"当前正文具体依据"}。正文或补丁同次提交；聊天和总结模式省略。对象或其JSON字符串。')
function briefArgument(args) {
  const nested = jsonArgument(args?.brief, 'brief')
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) return nested
  // The model sometimes flattens the six fields onto the top level instead of nesting them.
  const flat = Object.fromEntries(PREPARATION_KEYS.filter(key => args?.[key] !== undefined).map(key => [key, args[key]]))
  return Object.keys(flat).length ? flat : nested
}
function coverageArgument(value) {
  // Coverage is optional read evidence. A free-text or malformed value is dropped rather than
  // failing the step, because the field may be omitted entirely and is never worth the turn.
  if (value === undefined || value === null) return undefined
  let parsed = value
  if (typeof value === 'string') { try { parsed = JSON.parse(value) } catch (_) { return undefined } }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined
}
const DRAFT_READ_CHARS = 8000
const AUTHOR_RULE_READ_CHARS = 20000

function currentDraftView(chat, identity) {
  const draft = dreamSikeDraftView(chat)
  return draft && draft.turn === identity.turn && draft.operationId === identity.operationId
    && draft.branchId === identity.branchId && draft.status !== 'stale' ? draft : null
}

function executionRootFor(chat, identity) {
  return str(chat?.timeline?.operations?.[identity.operationId]?.executionRootOperationId) || identity.operationId
}

function executionPolicyFor(chat, identity, usage) {
  const ledger = normalizeDreamSikeExecutionPolicy(usage?.policy || chat?.dreamSikeExecutionPolicy)
  const configured = normalizeDreamSikeExecutionPolicy(chat?.dreamSikeExecutionPolicy)
  if (executionRootFor(chat, identity) === identity.operationId) return ledger
  return configured
}

function turnReport(chat, identity, args = {}) {
  const draftOffset = args.draftOffset ?? 0
  const operation = chat.timeline.operations[identity.operationId]
  const messages = Array.isArray(chat.messages) ? chat.messages : []
  const recent = messages.slice(-6).map((message, index) => {
    const floor = Math.max(0, messages.length - 6) + index
    const messageId = str(message.id) || null
    const sourceText = str(message.sourceText) || str(message.text)
    return { role: str(message.role), text: clip(sourceText, 1000),
      ref: messageId ? 'message:' + messageId : 'floor:' + identity.branchId + ':' + floor,
      messageId, uid: str(message.uid) || null, floor, branchId: identity.branchId,
      floorUid: 'uid_' + floor, floorUidKind: 'branch-floor-alias',
      turn: Number.isSafeInteger(message.turn) ? message.turn : null,
      textCharacters: sourceText.length, textTruncated: sourceText.length > 1000,
      continuation: sourceText.length > 1000 ? '按 ref、turn 或 floor 使用历史召回读取原记录；不要把本页片段视为全文。' : null }
  })
  const draft = dreamSikeDraftView(chat)
  const currentDraft = draft?.operationId === identity.operationId && draft.branchId === identity.branchId
    && draft.turn === identity.turn && draft.status !== 'stale' ? draft : null
  if (!Number.isSafeInteger(draftOffset) || draftOffset < 0 || draftOffset > (currentDraft?.text.length || 0)) {
    throw new Error('草稿读取位置已超出当前正文，请从 0 重新读取')
  }
  const draftEnd = Math.min((currentDraft?.text.length || 0), draftOffset + DRAFT_READ_CHARS)
  const contract = dreamSikeContractView(chat.runtimePresetSnapshot)
  const presetRules = readDreamSikeAgentRules(chat, {
    offset: args.ruleOffset ?? 0, limit: args.ruleLimit ?? 50,
    contentOffset: args.ruleContentOffset ?? 0, maxChars: AUTHOR_RULE_READ_CHARS,
    context: { charName: chat.cardName, macroState: chat.macroState, lastUserMessage: str(operation.userText) }
  })
  const materialRefs = ['action:' + identity.operationId, 'worldbook:' + identity.branchId + ':' + identity.storyRevision,
    'variables:' + identity.branchId + ':' + identity.storyRevision, ...recent.map(message => message.ref)]
  const report = {
    turn: identity.turn, card: str(chat.cardName), playerAction: clip(operation.userText, 3000),
    posture: clip(chat.posture, 1000), recent,
    materialRefs,
    materialAreas: {
      dream_setting: { card: str(chat.cardName), cardPath: str(chat.cardPath), worldBook: 'worldBook',
        furtherReading: '按人物卡与世界书来源检索完整设定，不将本页摘要当作完整卡片。' },
      dream_dx_setting: { worldBook: 'worldBook', state: 'state',
        references: materialRefs.filter(ref => ref.startsWith('worldbook:') || ref.startsWith('variables:')) },
      dream_history: { records: 'recent', references: recent.map(message => message.ref),
        floorUidScope: 'floorUid 是当前 branchId 下真实消息数组 floor 的 uid_<floor> 别名，不伪造原始消息 ID；优先采用 messageId/原 uid。',
        furtherReading: 'tavern_recall_history 按相关轮次、线索或消息引用补全历史。' },
      dreamer_input: { field: 'playerAction', reference: 'action:' + identity.operationId,
        source: '当前运行正文任务 operation.userText，不是历史末条用户消息。' },
      writing_setting: { rulePage: 'presetRules', selectedValues: 'presetRules.selected',
        furtherReading: '按规则分页索引续读已选原文，style 与字数等宏值只作当前选项索引。' },
      narrator: { rulePage: 'presetRules', selectedValues: 'presetRules.selected',
        furtherReading: '按已选叙事者的作者分析核心执行，不以简短准备替代作者步骤。' }
    },
    truncation: { playerAction: str(operation.userText).length > 3000, posture: str(chat.posture).length > 1000,
      worldBook: str(chat.preparedWorldBookContext).length > 4000, state: JSON.stringify(chat.variables || {}).length > 2500,
      recentHistory: messages.length > recent.length },
    worldBook: clip(chat.preparedWorldBookContext, 4000),
    state: clip(JSON.stringify(chat.variables || {}), 2500),
    presetContract: contract ? { version: contract.version, digest: contract.digest, presetName: contract.presetName,
      sourceCharacters: contract.sourceCharacters, entriesCount: contract.entries.length,
      reviewAxes: contract.reviewAxes, draftModules: contract.draftModules || [], followupModules: contract.followupModules || [], instruction: contract.instruction } : null,
    presetRules,
    editorialRequired: needsDreamSikeEditorialReview(chat),
    preparationRequired: needsDreamSikePreparation(chat),
    preparation: dreamSikePreparationView(chat, identity),
    draft: currentDraft ? {
      status: currentDraft.status, phase: currentDraft.phase, version: currentDraft.version,
      revisionCount: currentDraft.revisionCount, checks: currentDraft.checks,
      modules: Object.fromEntries(['parallel', 'review'].filter(kind => dreamSikeDraftModulePlan(chat, kind)).map(kind => [kind, {
        current: draftModuleReceiptCurrent(chat, kind), version: chat.dreamSikeDraft.modules?.[kind]?.version ?? null,
        review: chat.dreamSikeDraft.modules?.[kind]?.review ?? null
      }])),
      textLength: currentDraft.text.length, textOffset: draftOffset,
      text: currentDraft.text.slice(draftOffset, draftEnd),
      nextOffset: draftEnd < currentDraft.text.length ? draftEnd : null
    } : null,
    next: (presetRules.hasMore ? '已选作者规则还有未读取部分：用 presetRules.nextOffset / nextContentOffset 分别作为 ruleOffset / ruleContentOffset 续读；不要把分页视为全部规则。' : '当前页已到所选作者规则末尾。')
      + (needsDreamSikeEditorialReview(chat)
        ? '按已选作者完整规则核对材料、人物、格式、文风和叙事者方法；需要依据时仅在查询阶段检索。资料完整时 finishResearch=true 结束查询；若已明确缺少剧情关键资料且查询额度尚有剩余，finishResearch=false 保留一次补查。查询结束后一次 sike_put_draft({text,review,brief?}) 提交正文、六维审阅及可选简报，宿主同次检查并确认；有问题才在额度内批量局部修订。平行事件等附加内容留给正文与结算后，不提前输出，不展开私有推理。'
        : '当前为 ' + (contract?.outputMode || '普通') + ' 输出模式，按该模式的作者原文执行，不要求剧情六项准备或六维剧情审稿；仍须建立、检查并确认唯一回复。')
  }
  if (args.includeMaterials === false) {
    for (const field of ['playerAction', 'posture', 'recent', 'worldBook', 'state']) delete report[field]
    report.materialsOmitted = true
    report.materialReadHint = '本次仅返回材料引用；需要原文、压缩或重启后用 includeMaterials=true 重读，不将本页引用视为已读取事实。'
    if (report.presetContract) delete report.presetContract.instruction
    if (report.preparation) {
      const receipt = report.preparation
      report.preparation = { preparedAt: receipt.preparedAt, contractDigest: receipt.contractDigest, brief: receipt.brief,
        readCounts: { rules: receipt.servedRuleIds?.length || 0, ranges: receipt.ruleReadRanges?.length || 0, materials: receipt.materialRefs?.length || 0 } }
    }
  }
  if (args.includeDraft === false) { report.draft = null; report.draftOmitted = true }
  if (args.includeRules === false) {
    report.presetRules = { rules: [], omitted: true, digest: presetRules.digest, contractDigest: presetRules.contractDigest,
      nextOffset: args.ruleOffset || 0, nextContentOffset: args.ruleContentOffset || 0 }
    report.next = '本次未请求作者规则正文；需要时用 includeRules=true 及上一页的续读位置读取。'
  }
  return report
}

/** Register foreground tools. The host owns canonical story/MVU commits. */
export function registerDreamSikeTools({ tools, chatForSession, updateChat, activeTurnOf, publish, draftModules, executionUsageForChat, requestCoordinates }) {
  if (!tools || typeof tools.register !== 'function' || typeof chatForSession !== 'function'
    || typeof updateChat !== 'function' || typeof activeTurnOf !== 'function') throw new Error('缺少梦境思客DSH工具依赖')

  async function resolve(exec) {
    const sessionId = str(exec?.agent?.session?.id)
    const turn = activeTurnOf(exec)
    const chat = await chatForSession(sessionId)
    if (!isDreamSikeAgentExecution(chat)) throw new Error('当前回复方式未启用梦境思客 Agent 工具')
    return { chat, identity: dreamSikeTurnIdentity(chat, sessionId, turn) }
  }

  const mutations = new WeakMap()
  function register(tool) {
    const execute = tool.execute
    return tools.register({ ...tool, async execute(args, exec) {
      const agent = exec?.agent, phase = agent?.phase
      const scoped = agent && Number.isSafeInteger(phase?.turn) && Number.isSafeInteger(phase?.step)
      const key = scoped ? phase.turn + ':' + phase.step : null
      if (scoped) {
        const { chat, identity } = await resolve(exec)
        const rootOperationId = executionRootFor(chat, identity)
        const usage = await executionUsageForChat?.(chat.id, rootOperationId, identity.branchId)
        const coordinates = requestCoordinates?.get(identity.sessionId)
        const coordinatesMatch = coordinates?.rootOperationId === rootOperationId && coordinates?.branchId === identity.branchId
        const inFlightAttemptId = coordinatesMatch && coordinates?.turn === identity.turn && coordinates?.step === phase.step
          ? coordinates.attemptId : undefined
        const current = dreamSikeToolPhase(chat, identity.sessionId, identity.turn, usage, {
          inFlightAttemptId, inFlightRootOperationId: coordinatesMatch ? coordinates.rootOperationId : undefined,
          inFlightBranchId: coordinatesMatch ? coordinates.branchId : undefined
        })
        if (current && (!current.tools.includes(tool.name) || tool.name === 'sike_run_module' && current.moduleKind !== args.kind)) return {
          report: '当前阶段不执行 ' + tool.name + '。' + current.instruction
            + ' 当前草稿版本：' + (currentDraftView(chat, identity)?.version ?? '尚未建立')
            + '；允许工具：' + current.tools.join('、'), draft: currentDraftView(chat, identity)
        }
      }
      if (key && mutations.get(agent)?.key === key) {
        const { chat, identity } = await resolve(exec)
        const draft = currentDraftView(chat, identity)
        return { report: '本模型步骤已有写作状态变更，后续预推测调用未执行。当前草稿版本：' + (draft?.version ?? '尚未建立') + '。请依据实际结果在下一步骤继续；同次局部修改合并到 patches。', draft }
      }
      const marker = { key }
      if (key) mutations.set(agent, marker)
      try { return await execute(args, exec) }
      catch (error) {
        if (key && mutations.get(agent) === marker) mutations.delete(agent)
        if (exhaustedModelQuota(error)) {
          agent?.cancel?.({ kind: 'parent' })
          throw new Error('模型额度或免费调用限制已达到，本回合已暂停，草稿已保留。额度恢复后使用“继续本回合”；不会切换供应商重试。')
        }
        throw error
      }
    } })
  }

  async function write(exec, mutate, source) {
    const { chat, identity } = await resolve(exec)
    const saved = await updateChat(chat.id, current => {
      const latest = dreamSikeTurnIdentity(current, identity.sessionId, identity.turn)
      if (latest.operationId !== identity.operationId || latest.branchId !== identity.branchId
        || latest.storyRevision !== identity.storyRevision) throw new Error('回合状态已变化，拒绝过期草稿调用')
      mutate(current, latest)
      return current
    }, { source: 'dream-sike.' + source, touchUpdatedAt: false })
    if (!saved) throw new Error('草稿保存失败')
    const draft = currentDraftView(saved, identity)
    if (typeof publish === 'function') {
      try { await publish(saved.sessionId, draft) } catch { /* durable state remains readable */ }
    }
    return draft
  }

  function submissionResult(draft, exec, action) {
    if (draft.status === 'ready') {
      exec.concludeTurn?.()
      return { report: action + '，版本 ' + draft.version + ' 已检查确认。宿主直接结束并提交一次，不再请求 check、ready 或完成提示。', draft }
    }
    return { report: action + '，当前版本 ' + draft.version + '；草稿已保留。'
      + (draft.checks?.issues || []).map(issue => issue.message).join('；')
      + '。按当前阶段一次提交批量补丁与修改后 review；无需另起审稿 Agent。', draft }
  }

  register(defineTool({
    name: 'sike_read_turn',
    description: '读取当前行动、带真实消息或分支楼层引用的近期材料、草稿，以及当前启用作者规则和文风/叙事者索引。规则可完整分页续读，长草稿按 nextOffset 续读；资料截断时使用历史、世界书和变量工具补全。',
    parameters: {
      draftOffset: integerInput('长草稿续读位置，整数；首次省略或填 0'),
      ruleOffset: integerInput('作者规则条目起点，整数；首次 0，续读采用 presetRules.nextOffset'),
      ruleContentOffset: integerInput('超长单条规则的字符续读位置，整数；采用 presetRules.nextContentOffset，开始新条目时填 0'),
      ruleLimit: integerInput('每页最多规则条数，整数；默认及最大 50，内容总额最多 20000 字符；首次读取优先一次取得全部已选作者规则'),
      includeMaterials: { type: 'boolean', description: '默认 true；连续读取规则续页时可 false，避免重复整套材料与准备回执。压缩、重启或需要补查事实时使用 true。' },
      includeDraft: { type: 'boolean', description: '默认 true；只续读规则时设 false。读取草稿时设 true，并用 draftOffset 续读。' },
      includeRules: { type: 'boolean', description: '默认 true；仅读取草稿时设 false，避免再次注入规则第一页。' },
      finishResearch: { type: 'boolean', description: '默认 true；已明确需要第二次补查时传 false，最多保留本局设置所允许的剩余查询请求。' }
    }, output, isConcurrencySafe: () => false,
    async execute(args, exec) {
      const input = { ...args, draftOffset: offsetArgument(args.draftOffset, 0), ruleOffset: offsetArgument(args.ruleOffset, 0),
        ruleContentOffset: offsetArgument(args.ruleContentOffset, 0), ruleLimit: offsetArgument(args.ruleLimit, 50) }
      let report
      const resolved = await resolve(exec)
      const usage = await executionUsageForChat?.(resolved.chat.id, executionRootFor(resolved.chat, resolved.identity), resolved.identity.branchId)
      const queryPolicy = executionPolicyFor(resolved.chat, resolved.identity, usage)
      const draft = await write(exec, (chat, identity) => {
        const material = turnReport(chat, identity, input)
        recordDreamSikeTurnRead(chat, identity, Date.now(), {
          materialRefs: material.materialRefs, rules: material.presetRules.rules,
          profileDigest: material.presetRules.profileDigest || material.presetRules.digest,
          // Do not mark research complete while selected author rules still have
          // another page; the next query request must read that page first.
          finishResearch: args.finishResearch !== false && material.presetRules.hasMore !== true
        })
        if (material.presetRules.hasMore === true) material.next += ' 作者规则尚有续页，系统会保持写前查询阶段；仅在额度内读取下一页。当前写前查询上限为 ' + queryPolicy.queryRequests + ' 次模型请求。'
        if (input.includeMaterials !== false) material.preparation = dreamSikePreparationView(chat, identity)
        report = JSON.stringify(material)
      }, 'turn.read')
      return { report, draft }
    }
  }))

  register(defineTool({
    name: 'sike_prepare_turn',
    description: '旧草稿恢复时补存六项简短写作准备。新正文直接用 sike_put_draft 的可选 brief 同次提交，不需要单独调用本工具。不是思考链，不触发消息或变量结算。',
    parameters: {
      brief: jsonInput({ type: 'object', additionalProperties: false,
        properties: Object.fromEntries(PREPARATION_KEYS.map(key => [key, { type: 'string', required: true }]))
      }, '六项写作准备 {scene, characters, knowledge, style, progression, stopAt}，每项为非空简短事实或执行约束（最多400字符）。可用对象或其JSON字符串；也兼容六项顶层参数，不写内部推理。'),
      ...Object.fromEntries(PREPARATION_KEYS.map(key => [key, { type: 'string', description: '兼容顶层写作准备；优先放入 brief 对象' }])),
      coverage: jsonInput({ type: 'object', additionalProperties: false, properties: {
        contractDigest: { type: 'string' }, profileDigest: { type: 'string' },
        ruleIds: { type: 'array', items: { type: 'string' } }, materialRefs: { type: 'array', items: { type: 'string' } }
      } }, '可选读取依据对象。仅复制本回合读取结果，省略比猜测更好；不写推理文本。')
    },
    output, isConcurrencySafe: () => false,
    async execute(args, exec) {
      const draft = await write(exec, (chat, identity) => prepareDreamSikeTurn(chat, identity, briefArgument(args), Date.now(), { coverage: coverageArgument(args.coverage) }), 'turn.prepare')
      return { report: '本回合写作准备已保存，已绑定当前分支与预设版本。可建立草稿；若更新了现有草稿的准备，请重新审稿。', draft }
    }
  }))

  register(defineTool({
    name: 'sike_put_draft',
    description: '一次提交本回合唯一正文、剧情六维 review 与可选六项 brief。保留作者正文外壳、场景栏及人物卡HTML；宿主同次保存并检查，通过后直接确认和结束，无需额外prepare/check/ready。平行事件、选项、共创和摘要留给结算后的同一附加调用。已有草稿使用批量局部修订，不能重建；未确认草稿不触发正式消息或变量结算。',
    parameters: { text: { type: 'string', required: true, description: '完整可渲染主线正文和已选卡片HTML，不含私有推理、变量协议或结算后的附加模块' },
      brief: briefInput(), review: reviewInput() },
    output, isConcurrencySafe: () => false,
    async execute(args, exec) {
      const draft = await write(exec, (chat, identity) => submitDreamSikeDraft(chat, identity,
        { text: args.text, brief: briefArgument(args), review: jsonArgument(args.review, 'review') }), 'draft.put')
      return submissionResult(draft, exec, '正文已保存')
    }
  }))

  register(defineTool({
    name: 'sike_patch_draft',
    description: '在本局0–2次修订额度内，一次提交批量局部 patches 与修改后六维 review；宿主原子应用、检查并直接确认，通过后结束。1–8个片段依序唯一定位，全部有效才保存一个新版本。也兼容单项find/replacement，不得整篇重写或猜测版本。无问题允许零修订。',
    parameters: {
      expectedVersion: integerInput('当前草稿版本，整数（例如 3）', true),
      find: { type: 'string', description: '单项修订的唯一原文片段；与 patches 二选一' },
      replacement: { type: 'string', description: '单项替换内容；可为空字符串' },
      patches: jsonInput({ type: 'array', items: { type: 'object', additionalProperties: false, properties: {
        find: { type: 'string', required: true }, replacement: { type: 'string', required: true }
      } } }, '同次审稿的1–8个局部修改按顺序一次提交，数组或其JSON字符串'),
      review: reviewInput()
    }, output, isConcurrencySafe: () => false,
    async execute(args, exec) {
      const draft = await write(exec, (chat, identity) => reviseDreamSikeDraft(chat, identity,
        { expectedVersion: draftVersion(args.expectedVersion), find: args.find, replacement: args.replacement,
          patches: jsonArgument(args.patches, 'patches'), review: jsonArgument(args.review, 'review') }), 'draft.patch')
      return submissionResult(draft, exec, '局部修订已保存')
    }
  }))

  register(defineTool({
    name: 'sike_run_module',
    description: '旧版独立草稿模块兼容工具。当前梦境思客流程不调用：审稿规则已并入正文提交，平行事件已移到结算后的附加请求。不得用此工具绕过当前阶段或重复启动审稿。',
    parameters: { kind: { type: 'string', required: true, enum: ['parallel', 'review'], description: 'parallel 或 review' }, expectedVersion: integerInput('当前未确认草稿版本，整数', true) },
    output, isConcurrencySafe: () => false,
    async execute(args, exec) {
      if (!draftModules) throw new Error('当前宿主没有独立草稿模块执行器')
      const { chat, identity } = await resolve(exec)
      const result = await draftModules.execute({ chat, identity, kind: args.kind, expectedVersion: followedVersion(chat, identity, args.expectedVersion), signal: exec.signal })
      return { report: JSON.stringify({ module: result.module, reused: result.reused, version: result.draft.version,
        text: args.kind === 'parallel' ? result.draft.text.match(/<dream_parallel_event>[\s\S]*?<\/dream_parallel_event>/i)?.[0] : undefined,
        review: args.kind === 'review' ? result.draft.modules.review.review : undefined,
        next: '使用返回的当前版本和下一请求的当前阶段。需要修订时一次批量局部修改；文风建议记录为备注后允许进入检查，不为追求全项 pass 反复审稿。协议与审阅结构问题仍须处理。' }), draft: result.draft }
    }
  }))
  register(defineTool({
    name: 'sike_check_draft',
    description: '仅用于恢复旧草稿或纠正遗漏审阅结构；新正文/补丁的同次提交已自动检查和确认。提交当前版本的六维review后，宿主检查通过便直接确认并结束，无需再请求ready。文风判断来自Agent对照作者原文，不等于程序证明质量。',
    parameters: {
      expectedVersion: integerInput('要检查的草稿版本，整数', true),
      review: reviewInput()
    },
    output, isConcurrencySafe: () => false,
    async execute(args, exec) {
      const draft = await write(exec, (chat, identity) => finishDreamSikeDraftSubmission(chat, identity,
        draftVersion(args.expectedVersion), jsonArgument(args.review, 'review')), 'draft.check')
      return submissionResult(draft, exec, '正文审阅已保存')
    }
  }))

  register(defineTool({
    name: 'sike_ready_draft',
    description: '所有检查和修订完成后，最后确认当前版本正文。成功后草稿锁定，宿主立即结束回合并提交正式正文一次，不需要额外模型回复。',
    parameters: { expectedVersion: integerInput('已检查通过的草稿版本，整数', true) },
    output, isConcurrencySafe: () => false,
    async execute(args, exec) {
      const draft = await write(exec, (chat, identity) => readyDreamSikeDraft(chat, identity, followedVersion(chat, identity, args.expectedVersion)), 'draft.ready')
      exec.concludeTurn?.()
      return { report: '版本 ' + draft.version + ' 已确认并锁定。宿主立即结束本回合，从已确认草稿提交正式正文一次。', draft }
    }
  }))
}
