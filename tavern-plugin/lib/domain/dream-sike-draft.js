const MODE = 'dream-sike-dsh'
const MAX_DRAFT_CHARS = 100_000
const MAX_PATCHES = 2
const MAX_FIND_CHARS = 4_000
const MAX_REPLACEMENT_CHARS = 8_000

function str(value) { return typeof value === 'string' ? value : '' }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {} }
function copy(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)) }

function requireVersion(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('请提供当前草稿的正整数版本')
  return value
}

function assertDraftText(text) {
  if (typeof text !== 'string' || text.trim() === '') throw new Error('正文草稿不能为空')
  if (text.length > MAX_DRAFT_CHARS) throw new Error('正文草稿超过 100000 字符上限')
  return text
}

function currentBodyOperation(chat, turn) {
  const timeline = object(chat.timeline)
  const operations = Object.values(object(timeline.operations)).filter(operation =>
    operation?.kind === 'body' && operation.status === 'running' && Number(operation.turn) === turn
      && str(operation.basedOn?.branchId) === str(timeline.branchId)
      && Number(operation.basedOn?.revision) === Number(timeline.revision))
  if (operations.length !== 1) throw new Error('当前回合没有唯一的运行中正文操作')
  return operations[0]
}

/** Resolve the only turn a foreground tool is allowed to affect. */
export function dreamSikeTurnIdentity(chat, sessionId, turn) {
  if (!chat || chat.playPresetId !== MODE || !['story', 'script'].includes(chat.mode || 'story')) throw new Error('梦境思客DSH工具仅用于已启用的游玩对话')
  if (!str(sessionId) || !Number.isSafeInteger(turn) || turn < 1) throw new Error('梦境思客DSH工具需要正在运行的前台回合')
  const foregroundSession = str(chat.timeline?.participants?.foreground?.sessionId)
  if (str(chat.sessionId) !== sessionId && foregroundSession !== sessionId) throw new Error('草稿会话与当前对话不一致')
  const operation = currentBodyOperation(chat, turn)
  return {
    chatId: str(chat.id), sessionId, turn,
    operationId: str(operation.id), branchId: str(chat.timeline.branchId),
    storyRevision: Number(chat.timeline.revision)
  }
}

function sameIdentity(draft, identity) {
  return draft && draft.chatId === identity.chatId && draft.sessionId === identity.sessionId
    && draft.turn === identity.turn && draft.operationId === identity.operationId
    && draft.branchId === identity.branchId && draft.storyRevision === identity.storyRevision
}

function requireCurrentDraft(chat, identity) {
  const draft = object(chat.dreamSikeDraft)
  if (!sameIdentity(draft, identity)) throw new Error('当前回合尚未建立草稿，或草稿已随分支变化失效')
  if (draft.status === 'committed') throw new Error('该草稿已提交')
  return draft
}

export function readDreamSikeDraft(chat) {
  const draft = chat?.dreamSikeDraft
  return draft && typeof draft === 'object' && !Array.isArray(draft) ? copy(draft) : null
}

/** Small status projection for the main chat; never includes draft text. */
export function dreamSikeDraftStatus(chat) {
  const draft = chat?.dreamSikeDraft
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return null
  const timeline = object(chat.timeline)
  const current = draft.branchId === str(timeline.branchId)
    && (draft.status === 'committed' || draft.storyRevision === Number(timeline.revision))
  return {
    turn: draft.turn,
    status: current ? str(draft.status) : 'stale',
    phase: current ? str(draft.phase) : 'stale',
    version: Number(draft.version) || 0,
    revisionCount: Number(draft.revisionCount) || 0
  }
}

/** Bind a failed turn's durable draft to the one replay that follows it. */
export function planDreamSikeDraftResume(chat, { failedTurn, expectedOperationId, expectedVersion }) {
  const draft = readDreamSikeDraft(chat)
  const timeline = object(chat?.timeline)
  if (chat?.playPresetId !== MODE || !['story', 'script'].includes(chat?.mode || 'story')) throw new Error('当前游戏未启用梦境思客DSH')
  if (!draft || !['draft', 'ready'].includes(draft.status)) throw new Error('没有可继续处理的正文草稿')
  if (!Number.isSafeInteger(failedTurn) || failedTurn < 1 || draft.turn !== failedTurn
    || draft.operationId !== expectedOperationId || draft.version !== expectedVersion) throw new Error('草稿版本或失败回合已变化，请重新读取工作窗')
  if (draft.sessionId !== chat.sessionId || draft.branchId !== timeline.branchId
    || draft.storyRevision !== timeline.revision || chat.nativeCommits?.[String(failedTurn)]) {
    throw new Error('剧情分支已变化，此草稿不能继续提交')
  }
  return {
    failedTurn, nextTurn: failedTurn + 1, sourceOperationId: draft.operationId,
    sourceVersion: draft.version, sessionId: draft.sessionId,
    branchId: draft.branchId, storyRevision: draft.storyRevision
  }
}

/** Called only after the replay's new body operation has been opened. */
export function carryDreamSikeDraftIntoTurn(chat, identity, now = Date.now()) {
  const marker = object(chat?.dreamSikeResume)
  if (!marker.sourceOperationId) return false
  const draft = object(chat.dreamSikeDraft)
  if (marker.nextTurn !== identity.turn || marker.sessionId !== identity.sessionId
    || marker.branchId !== identity.branchId || marker.storyRevision !== identity.storyRevision
    || marker.sourceOperationId !== draft.operationId || marker.sourceVersion !== draft.version
    || marker.failedTurn !== draft.turn || !['draft', 'ready'].includes(draft.status)) {
    throw new Error('续写草稿与新回合不一致，已拒绝过期恢复')
  }
  chat.dreamSikeDraft = {
    ...draft, ...identity, resumedFrom: { turn: marker.failedTurn, operationId: marker.sourceOperationId },
    phase: draft.status === 'ready' ? 'ready' : 'reading',
    trace: (Array.isArray(draft.trace) ? draft.trace : []).concat({ phase: 'reading', action: '已从失败回合恢复草稿', at: now }).slice(-40),
    updatedAt: now
  }
  delete chat.dreamSikeResume
  return true
}

export function dreamSikeDraftView(chat) {
  const draft = chat?.dreamSikeDraft
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return null
  const timeline = object(chat.timeline)
  const current = draft.branchId === str(timeline.branchId) && (draft.status === 'committed' || draft.storyRevision === Number(timeline.revision))
  return {
    turn: draft.turn, operationId: draft.operationId, branchId: draft.branchId,
    version: draft.version, status: current ? draft.status : 'stale',
    text: draft.text, revisionCount: draft.revisionCount,
    changes: (Array.isArray(draft.changes) ? draft.changes : []).map(change => ({
      find: change.find, replacement: change.replacement,
      beforeVersion: change.beforeVersion, afterVersion: change.afterVersion, at: change.at
    })),
    checks: copy(draft.checks || null),
    phase: str(draft.phase), trace: copy(draft.trace || []),
    updatedAt: draft.updatedAt
  }
}

export function putDreamSikeDraft(chat, identity, text, now = Date.now()) {
  assertDraftText(text)
  const previous = readDreamSikeDraft(chat)
  if (sameIdentity(previous, identity)) {
    if (previous.status === 'draft' && previous.version === 1 && previous.text === text) return previous
    throw new Error('当前回合已有草稿；请使用局部修订工具')
  }
  const draft = {
    ...identity, version: 1, status: 'draft', phase: 'draft', text, revisionCount: 0,
    changes: [], checks: null, trace: [{ phase: 'draft', action: '草稿已建立', at: now }], updatedAt: now
  }
  chat.dreamSikeDraft = draft
  return copy(draft)
}

export function patchDreamSikeDraft(chat, identity, { expectedVersion, find, replacement }, now = Date.now()) {
  const draft = requireCurrentDraft(chat, identity)
  if (draft.status !== 'draft') throw new Error('已确认的草稿不能继续修改')
  if (requireVersion(expectedVersion) !== draft.version) throw new Error('草稿版本已变化，请重新读取后修订')
  if (typeof find !== 'string' || find === '') throw new Error('FIND 必须是非空的原文片段')
  if (typeof replacement !== 'string') throw new Error('REPLACE 必须是文本')
  if (find.length > MAX_FIND_CHARS || replacement.length > MAX_REPLACEMENT_CHARS) throw new Error('请缩小局部修订范围')
  const first = draft.text.indexOf(find)
  if (first < 0) throw new Error('FIND 在当前草稿中不存在')
  if (draft.text.indexOf(find, first + find.length) >= 0) throw new Error('FIND 在当前草稿中不唯一，请补充上下文')
  if (find === replacement) return copy(draft)
  if (draft.revisionCount >= MAX_PATCHES) throw new Error('本回合最多进行两轮草稿修订')
  const nextText = draft.text.slice(0, first) + replacement + draft.text.slice(first + find.length)
  assertDraftText(nextText)
  draft.changes.push({
    index: first, find, replacement, beforeText: find, afterText: replacement,
    leftContext: draft.text.slice(Math.max(0, first - 40), first),
    rightContext: draft.text.slice(first + find.length, first + find.length + 40),
    beforeVersion: draft.version, afterVersion: draft.version + 1, at: now
  })
  draft.text = nextText
  draft.version++
  draft.revisionCount++
  draft.checks = null
  draft.phase = 'revision'
  draft.trace.push({ phase: 'revision', action: '已局部修订', at: now })
  draft.updatedAt = now
  return copy(draft)
}

function issue(code, message) { return { code, message } }

/** Deterministic protocol checks; literary judgment remains with the Agent. */
export function inspectDreamSikeDraft(text) {
  const issues = []
  if (typeof text !== 'string' || text.trim() === '') issues.push(issue('empty-body', '正文为空'))
  if (/<\/?(?:think|simple_thinking|dream_self_check)(?:\s[^>]*)?>/i.test(text)) issues.push(issue('private-protocol', '正文含有内部思考或修订协议标签'))
  if (/<\/?UpdateVariable(?:\s[^>]*)?>/i.test(text)) issues.push(issue('state-protocol', '变量更新由提交后的后台 Agent 处理'))
  for (const tag of ['dream_body', 'dream_parallel_event']) {
    const opens = (text.match(new RegExp('<' + tag + '(?:\\s[^>]*)?>', 'gi')) || []).length
    const closes = (text.match(new RegExp('</' + tag + '\\s*>', 'gi')) || []).length
    if (opens !== closes) issues.push(issue('unbalanced-' + tag, tag + ' 标签未配对'))
  }
  if (/```(?:thought|analysis|reasoning)\b/i.test(text)) issues.push(issue('private-protocol', '正文含有内部推理代码块'))
  return issues
}

export function checkDreamSikeDraft(chat, identity, expectedVersion, now = Date.now()) {
  const draft = requireCurrentDraft(chat, identity)
  if (requireVersion(expectedVersion) !== draft.version) throw new Error('草稿版本已变化，请重新读取后检查')
  const issues = inspectDreamSikeDraft(draft.text)
  draft.checks = { version: draft.version, issues, checkedAt: now }
  draft.phase = 'checking'
  draft.trace.push({ phase: 'checking', action: issues.length ? '检查发现 ' + issues.length + ' 项问题' : '检查通过', at: now })
  draft.updatedAt = now
  return copy(draft)
}

export function readyDreamSikeDraft(chat, identity, expectedVersion, now = Date.now()) {
  const draft = requireCurrentDraft(chat, identity)
  if (requireVersion(expectedVersion) !== draft.version) throw new Error('草稿版本已变化，请重新读取后确认')
  if (draft.status === 'ready') return copy(draft)
  if (!draft.checks || draft.checks.version !== draft.version) throw new Error('请先检查当前版本草稿')
  if (draft.checks.issues.length > 0) throw new Error('草稿仍有待处理的格式或协议问题')
  draft.status = 'ready'
  draft.phase = 'ready'
  draft.trace.push({ phase: 'ready', action: '正文可提交', at: now })
  draft.updatedAt = now
  return copy(draft)
}

/** Called as part of the canonical body commit, never by a model tool. */
export function markDreamSikeDraftCommitted(chat, { turn, operationId }, now = Date.now()) {
  const draft = object(chat?.dreamSikeDraft)
  if (draft.status !== 'ready' || draft.turn !== turn || draft.operationId !== operationId || draft.branchId !== str(chat.timeline?.branchId)) return false
  draft.status = 'committed'
  draft.phase = 'committed'
  draft.trace.push({ phase: 'committed', action: '正文已提交', at: now })
  draft.updatedAt = now
  return true
}

/** Host-only progress records for the optional UI; no private reasoning text. */
export function updateDreamSikeDraftProgress(chat, identity, { phase, action }, now = Date.now()) {
  const draft = requireCurrentDraft(chat, identity)
  if (!['reading', 'planning', 'draft', 'checking', 'revision', 'ready', 'committing'].includes(phase)) throw new Error('未知的草稿阶段')
  const summary = str(action).trim().slice(0, 180)
  if (!summary) throw new Error('草稿进度需要简短摘要')
  draft.phase = phase
  draft.trace = (Array.isArray(draft.trace) ? draft.trace : []).concat({ phase, action: summary, at: now }).slice(-40)
  draft.updatedAt = now
  return copy(draft)
}
