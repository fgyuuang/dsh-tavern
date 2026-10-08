import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  checkDreamSikeDraft, dreamSikeDraftView, dreamSikeTurnIdentity,
  patchDreamSikeDraft, putDreamSikeDraft, readyDreamSikeDraft
} from '../domain/dream-sike-draft.js'

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

function turnReport(chat, identity, draftOffset = 0) {
  const operation = chat.timeline.operations[identity.operationId]
  const recent = (Array.isArray(chat.messages) ? chat.messages : []).slice(-6).map(message => ({
    role: str(message.role), text: clip(message.sourceText || message.text, 1000)
  }))
  const draft = dreamSikeDraftView(chat)
  const currentDraft = draft?.operationId === identity.operationId && draft.branchId === identity.branchId
    && draft.turn === identity.turn && draft.status !== 'stale' ? draft : null
  if (!Number.isSafeInteger(draftOffset) || draftOffset < 0 || draftOffset > (currentDraft?.text.length || 0)) {
    throw new Error('草稿读取位置已超出当前正文，请从 0 重新读取')
  }
  const draftEnd = Math.min((currentDraft?.text.length || 0), draftOffset + DRAFT_READ_CHARS)
  return JSON.stringify({
    turn: identity.turn, card: str(chat.cardName), playerAction: clip(operation.userText, 3000),
    posture: clip(chat.posture, 1000), recent,
    worldBook: clip(chat.preparedWorldBookContext, 4000),
    state: clip(JSON.stringify(chat.variables || {}), 2500),
    draft: currentDraft ? {
      status: currentDraft.status, phase: currentDraft.phase, version: currentDraft.version,
      revisionCount: currentDraft.revisionCount, checks: currentDraft.checks,
      textLength: currentDraft.text.length, textOffset: draftOffset,
      text: currentDraft.text.slice(draftOffset, draftEnd),
      nextOffset: draftEnd < currentDraft.text.length ? draftEnd : null
    } : null,
    next: '需要更多细节时调用世界书搜索和历史召回工具；草稿提交前使用检查工具。'
  })
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
    description: '读取当前回合的玩家行动、最近正文、场景和已保存草稿。长草稿按 nextOffset 继续读取；需要深入资料时再使用世界书和历史召回工具。',
    parameters: { draftOffset: { type: 'integer', description: '长草稿续读位置；首次读取省略或填 0' } }, output, isConcurrencySafe: () => false,
    async execute(args, exec) {
      const { chat, identity } = await resolve(exec)
      return { report: turnReport(chat, identity, args.draftOffset || 0), draft: dreamSikeDraftView(chat) }
    }
  }))

  tools.register(defineTool({
    name: 'sike_put_draft',
    description: '建立本回合唯一的正文草稿。草稿不会成为正式消息，也不会触发变量结算；后续修改请用 sike_patch_draft。',
    parameters: { text: { type: 'string', required: true, description: '供玩家阅读的完整剧情正文；不要包含内部推理或变量协议' } },
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
    description: '检查当前草稿的正文格式和内部协议残留。输出可核实的问题；文风与剧情判断由 Agent 根据上下文进行。',
    parameters: { expectedVersion: { type: 'integer', required: true, description: '要检查的草稿版本' } },
    output, isConcurrencySafe: () => false,
    async execute(args, exec) {
      const draft = await write(exec, (chat, identity) => checkDreamSikeDraft(chat, identity, args.expectedVersion), 'draft.check')
      const issues = draft.checks.issues
      const report = issues.length ? '发现 ' + issues.length + ' 项问题：' + issues.map(item => item.message).join('；') : '检查通过；允许零修订。'
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
