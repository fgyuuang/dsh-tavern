import { dreamSikeContractView, needsDreamSikeEditorialReview } from './dream-sike-contract.js'
import { hasPrivateWritingProtocol } from './writing-private-protocol.js'

const FIELDS = ['scene', 'characters', 'knowledge', 'style', 'progression', 'stopAt']
const str = value => typeof value === 'string' ? value : ''
const clone = value => JSON.parse(JSON.stringify(value))

function same(receipt, identity) {
  return receipt && ['chatId', 'sessionId', 'turn', 'operationId', 'branchId', 'storyRevision']
    .every(key => receipt[key] === identity[key])
}

export function needsDreamSikePreparation(chat) {
  return chat?.playPresetId === 'dream-sike-dsh'
    && needsDreamSikeEditorialReview(chat)
    && dreamSikeContractView(chat.runtimePresetSnapshot)?.entries.some(entry => entry.action === 'agent-planning') === true
}

/** A receipt of materials actually served by the read tool, not inferred reasoning. */
export function recordDreamSikeTurnRead(chat, identity, now = Date.now()) {
  const digest = str(dreamSikeContractView(chat.runtimePresetSnapshot)?.digest)
  const current = chat.dreamSikePreparation
  if (same(current, identity) && current.contractDigest === digest) return clone(current)
  const worldbook = str(chat.preparedWorldBookContext)
  const state = JSON.stringify(chat.variables || {})
  const receipt = {
    ...identity, contractDigest: digest, readAt: now, preparedAt: null, brief: null,
    materials: {
      worldbookCharacters: worldbook.length, worldbookTruncated: worldbook.length > 4000,
      variablesTruncated: state.length > 2500,
      recentMessages: Math.min(Array.isArray(chat.messages) ? chat.messages.length : 0, 6)
    }
  }
  chat.dreamSikePreparation = receipt
  return clone(receipt)
}

export function dreamSikePreparationView(chat, identity) {
  const receipt = chat?.dreamSikePreparation
  return same(receipt, identity) ? clone(receipt) : null
}

/** Save the short writing brief. Never accept a transcript of private thinking. */
export function prepareDreamSikeTurn(chat, identity, brief, now = Date.now()) {
  const receipt = chat.dreamSikePreparation
  const digest = str(dreamSikeContractView(chat.runtimePresetSnapshot)?.digest)
  if (!same(receipt, identity) || receipt.contractDigest !== digest) {
    throw new Error('请先用 sike_read_turn 读取当前回合与最新预设契约')
  }
  if (!brief || typeof brief !== 'object' || Array.isArray(brief)
    || Object.keys(brief).some(key => !FIELDS.includes(key))) throw new Error('写作准备仅接受 scene、characters、knowledge、style、progression、stopAt 六项简短执行约束')
  const normalized = {}
  for (const key of FIELDS) {
    const value = str(brief[key]).trim()
    if (value.length < 8 || value.length > 400 || hasPrivateWritingProtocol(value)) {
      throw new Error(key + ' 需 8–400 字符的事实或执行约束；不要提交完整思考过程')
    }
    normalized[key] = value
  }
  const draft = chat.dreamSikeDraft
  const currentDraft = same(draft, identity) ? draft : null
  if (currentDraft?.status === 'committed') throw new Error('已提交回合不能修改写作准备')
  // Replaying the same brief is harmless, including a ready draft.
  if (receipt.preparedAt && JSON.stringify(receipt.brief) === JSON.stringify(normalized)) return clone(receipt)
  receipt.brief = normalized
  receipt.preparedAt = now
  if (currentDraft) {
    currentDraft.preparation = clone(receipt)
    currentDraft.checks = null
    currentDraft.status = 'draft'
    currentDraft.phase = 'planning'
    currentDraft.updatedAt = now
    currentDraft.trace = (currentDraft.trace || []).concat({ phase: 'planning', action: '写作准备已更新，需重新审稿', at: now }).slice(-40)
  }
  return clone(receipt)
}

export function assertDreamSikePreparation(chat, identity, draft = null) {
  if (!needsDreamSikePreparation(chat)) return
  const receipt = draft?.preparation || chat.dreamSikePreparation
  if (!same(receipt, identity) || !receipt.preparedAt || !receipt.brief) {
    throw new Error('本局已启用写前决策流程：先 sike_read_turn，再 sike_prepare_turn 保存简短写作准备，才能起草或确认')
  }
  if (receipt.contractDigest !== str(dreamSikeContractView(chat.runtimePresetSnapshot)?.digest)) {
    throw new Error('预设规则已变化，请重新读取回合并更新写作准备')
  }
}
