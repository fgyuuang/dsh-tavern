import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  checkDreamSikeDraft, dreamSikeDraftView, dreamSikeTurnIdentity,
  patchDreamSikeDraft, putDreamSikeDraft, readyDreamSikeDraft
} from '../domain/dream-sike-draft.js'
import { dreamSikeContractView, needsDreamSikeEditorialReview } from '../domain/dream-sike-contract.js'
import { dreamSikePreparationView, needsDreamSikePreparation, prepareDreamSikeTurn, recordDreamSikeTurnRead } from '../domain/dream-sike-preparation.js'
import { readDreamSikeAgentRules } from '../domain/dream-sike-agent-profile.js'

const output = {
  schema: {
    type: 'object', additionalProperties: false,
    properties: { report: { type: 'string', required: true }, draft: { type: 'json', required: true } }
  },
  render(_args, value) { return [{ type: 'text', text: value.report }] }
}

function str(value) { return typeof value === 'string' ? value : '' }
function clip(value, limit) { return str(value).slice(0, limit) }
const DRAFT_READ_CHARS = 8000

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
    offset: args.ruleOffset ?? 0, limit: args.ruleLimit ?? 10,
    contentOffset: args.ruleContentOffset ?? 0, maxChars: DRAFT_READ_CHARS,
    context: { charName: chat.cardName, macroState: chat.macroState, lastUserMessage: str(operation.userText) }
  })
  const materialRefs = ['action:' + identity.operationId, 'worldbook:' + identity.branchId + ':' + identity.storyRevision,
    'variables:' + identity.branchId + ':' + identity.storyRevision, ...recent.map(message => message.ref)]
  return {
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
      reviewAxes: contract.reviewAxes, instruction: contract.instruction } : null,
    presetRules,
    editorialRequired: needsDreamSikeEditorialReview(chat),
    preparationRequired: needsDreamSikePreparation(chat),
    preparation: dreamSikePreparationView(chat, identity),
    draft: currentDraft ? {
      status: currentDraft.status, phase: currentDraft.phase, version: currentDraft.version,
      revisionCount: currentDraft.revisionCount, checks: currentDraft.checks,
      textLength: currentDraft.text.length, textOffset: draftOffset,
      text: currentDraft.text.slice(draftOffset, draftEnd),
      nextOffset: draftEnd < currentDraft.text.length ? draftEnd : null
    } : null,
    next: (presetRules.hasMore ? '已选作者规则还有未读取部分：用 presetRules.nextOffset / nextContentOffset 分别作为 ruleOffset / ruleContentOffset 续读；不要把分页视为全部规则。' : '当前页已到所选作者规则末尾。')
      + (needsDreamSikeEditorialReview(chat)
        ? '按已选作者规则依次核对材料、人物、格式、文风和叙事者方法；需要依据时检索。preparationRequired 为 true 时用 sike_prepare_turn 保存六项简短执行约束；可用 coverage 引用实际读取的规则与材料。起草后六维审稿，有缺陷再局部修订；允许零补丁，不展开私有推理。'
        : '当前为 ' + (contract?.outputMode || '普通') + ' 输出模式，按该模式的作者原文执行，不要求剧情六项准备或六维剧情审稿；仍须建立、检查并确认唯一回复。')
  }
}

/** Register foreground tools. The host owns canonical story/MVU commits. */
export function registerDreamSikeTools({ tools, chatForSession, updateChat, activeTurnOf, publish }) {
  if (!tools || typeof tools.register !== 'function' || typeof chatForSession !== 'function'
    || typeof updateChat !== 'function' || typeof activeTurnOf !== 'function') throw new Error('缺少梦境思客DSH工具依赖')

  async function resolve(exec) {
    const sessionId = str(exec?.agent?.session?.id)
    const turn = activeTurnOf(exec)
    const chat = await chatForSession(sessionId)
    return { chat, identity: dreamSikeTurnIdentity(chat, sessionId, turn) }
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
    const draft = dreamSikeDraftView(saved)
    if (typeof publish === 'function') {
      try { await publish(saved.sessionId, draft) } catch { /* durable state remains readable */ }
    }
    return draft
  }

  tools.register(defineTool({
    name: 'sike_read_turn',
    description: '读取当前行动、带真实消息或分支楼层引用的近期材料、草稿，以及当前启用作者规则和文风/叙事者索引。规则可完整分页续读，长草稿按 nextOffset 续读；资料截断时使用历史、世界书和变量工具补全。',
    parameters: {
      draftOffset: { type: 'integer', description: '长草稿续读位置；首次省略或填 0' },
      ruleOffset: { type: 'integer', description: '作者规则条目起点；首次 0，续读采用 presetRules.nextOffset' },
      ruleContentOffset: { type: 'integer', description: '超长单条规则的字符续读位置；采用 presetRules.nextContentOffset，开始新条目时填 0' },
      ruleLimit: { type: 'integer', description: '每页最多规则条数；默认及最大 10，内容总额最多 8000 字符' }
    }, output, isConcurrencySafe: () => false,
    async execute(args, exec) {
      let report
      const resolved = await resolve(exec)
      if (!needsDreamSikePreparation(resolved.chat)) {
        return { report: JSON.stringify(turnReport(resolved.chat, resolved.identity, args)), draft: dreamSikeDraftView(resolved.chat) }
      }
      const draft = await write(exec, (chat, identity) => {
        const material = turnReport(chat, identity, args)
        recordDreamSikeTurnRead(chat, identity, Date.now(), {
          materialRefs: material.materialRefs, rules: material.presetRules.rules,
          profileDigest: material.presetRules.profileDigest || material.presetRules.digest
        })
        material.preparation = dreamSikePreparationView(chat, identity)
        report = JSON.stringify(material)
      }, 'turn.read')
      return { report, draft }
    }
  }))

  tools.register(defineTool({
    name: 'sike_prepare_turn',
    description: '读取回合后保存简短写作准备：当前场景、人物约束、认知边界、已选文风、当前推进和玩家停止位置。仅 preparationRequired=true 的剧情回合必须起草前调用，聊天和总结模式免除。这是执行简报，不接收完整思考链，不触发消息或变量结算。',
    parameters: {
      brief: { type: 'json', required: true, description: 'scene、characters、knowledge、style、progression、stopAt 六项各为 8–400 字符的事实或执行约束；不要写内部推理或候选链分析。' },
      coverage: { type: 'json', description: '可选的读取依据索引：contractDigest、profileDigest、ruleIds、materialRefs。仅引用 sike_read_turn 实际提供的摘要与引用，不保存思考过程，也不代表程序已证明完整执行作者步骤。' }
    },
    output, isConcurrencySafe: () => false,
    async execute(args, exec) {
      const draft = await write(exec, (chat, identity) => prepareDreamSikeTurn(chat, identity, args.brief, Date.now(), { coverage: args.coverage }), 'turn.prepare')
      return { report: '本回合写作准备已保存，已绑定当前分支与预设版本。可建立草稿；若更新了现有草稿的准备，请重新审稿。', draft }
    }
  }))

  tools.register(defineTool({
    name: 'sike_put_draft',
    description: '建立本回合唯一的完整可渲染文档，保留已启用预设要求的正文外壳、场景栏、平行事件及人物卡 HTML。草稿不会成为正式消息，也不会触发变量结算；后续修改请用 sike_patch_draft。',
    parameters: { text: { type: 'string', required: true, description: '供玩家阅读的完整可渲染正文，包括本局要求的可见预设外壳与卡片 HTML；不要包含内部推理或变量协议' } },
    output, isConcurrencySafe: () => false,
    async execute(args, exec) {
      const draft = await write(exec, (chat, identity) => putDreamSikeDraft(chat, identity, args.text), 'draft.put')
      return { report: '草稿已保存，版本 ' + draft.version + '，共 ' + draft.text.length + ' 字符。', draft }
    }
  }))

  tools.register(defineTool({
    name: 'sike_patch_draft',
    description: '以当前版本和唯一的原文片段局部修订草稿。最多两轮有效修订；不得用整篇重写绕过版本检查。',
    parameters: {
      expectedVersion: { type: 'integer', required: true, description: '当前草稿版本' },
      find: { type: 'string', required: true, description: '草稿中唯一的原文片段' },
      replacement: { type: 'string', required: true, description: '替换内容；可为空字符串' }
    }, output, isConcurrencySafe: () => false,
    async execute(args, exec) {
      const draft = await write(exec, (chat, identity) => patchDreamSikeDraft(chat, identity, args), 'draft.patch')
      return { report: '草稿现为版本 ' + draft.version + '，已修订 ' + draft.revisionCount + '/2 轮。', draft }
    }
  }))

  tools.register(defineTool({
    name: 'sike_check_draft',
    description: '检查正文协议，并记录 Agent 对预设文风、角色、信息差和剧情的可核实审阅。仅 editorialRequired=true 的剧情回合必须提交六维 review；聊天和总结模式免除。工具验证审阅结构和协议，文风判断由 Agent 对照作者规则进行，不等于程序证明质量。',
    parameters: {
      expectedVersion: { type: 'integer', required: true, description: '要检查的草稿版本' },
      review: { type: 'json', description: 'editorialRequired=true 时必填对象：character、knowledge、style、continuity、playerAgency、format 各为 {status:"pass"或"revise",evidence:"8–500 字符的具体正文缺陷或可观察结果"}。聊天与总结模式省略；不要只说符合要求，不要展开私有推理。' }
    },
    output, isConcurrencySafe: () => false,
    async execute(args, exec) {
      const draft = await write(exec, (chat, identity) => checkDreamSikeDraft(chat, identity, args.expectedVersion, { review: args.review }), 'draft.check')
      const issues = draft.checks.issues
      const report = issues.length
        ? '发现 ' + issues.length + ' 项问题：' + issues.map(item => item.message).join('；') + '。请处理缺陷后，对新版本重新检查。'
        : draft.checks.editorial?.required
          ? '协议检查通过，六维正文审阅已记录；允许零修订。审阅为 Agent 判断，可在工作窗核实。'
          : '检查通过；允许零修订。'
      return { report, draft }
    }
  }))

  tools.register(defineTool({
    name: 'sike_ready_draft',
    description: '确认已检查且无协议问题的当前版本正文，交由 Tavern 正式回合流程提交一次。此工具不会自行写入正式消息。',
    parameters: { expectedVersion: { type: 'integer', required: true, description: '已检查通过的草稿版本' } },
    output, isConcurrencySafe: () => false,
    async execute(args, exec) {
      const draft = await write(exec, (chat, identity) => readyDreamSikeDraft(chat, identity, args.expectedVersion), 'draft.ready')
      return { report: '版本 ' + draft.version + ' 已就绪，等待正式回合提交。', draft }
    }
  }))
}
