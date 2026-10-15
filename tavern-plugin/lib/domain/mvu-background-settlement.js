import { createBackgroundTaskFrame } from './agent-input-frame.js'
import {
  CHARACTER_DESIGN_READ_TOOL,
  CHARACTER_DESIGN_READ_TOOL_NAME,
  CHARACTER_DESIGN_SAVE_TOOL,
  CHARACTER_DESIGN_SAVE_TOOL_NAME
} from './character-design-document.js'
import { variableDiagnosticSummary } from './mvu-diagnostics.js'
import { normalizeBackgroundTasks } from './tavern-settings.js'
import { POSTURE_SUBMIT_TOOL_NAME, normalizePostureSubmission } from './posture-submission.js'
import { resolveRuntimeMacroText } from './runtime-content-projection.js'

export const MVU_SUBMIT_UPDATE_TOOL_NAME = 'mvu_submit_update'
export const SETTLEMENT_SUBMIT_TOOL_NAME = 'settlement_submit'

// Keep the provider-facing schema flat: some OpenAI-compatible gateways narrow
// arbitrary JSON unions to a single primitive type. Decode values at our boundary.
const operationSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    op: { type: 'string', enum: ['replace', 'insert', 'add', 'delta', 'remove', 'move'] },
    path: { type: 'string' },
    valueJson: { type: 'string', description: 'replace/insert/add/delta 必填：实际值的 JSON 编码字符串。例如数字编码为 999995，布尔编码为 false，对象编码为 {"名称":"长剑"}；字符串值须包含 JSON 双引号。delta 必须编码有限数字。remove/move 不需要此字段。' },
    from: { type: 'string', description: '仅 move 必填：来源绝对路径。' }
  },
  required: ['op', 'path']
}

export const MVU_SUBMIT_UPDATE_TOOL = Object.freeze({
  name: MVU_SUBMIT_UPDATE_TOOL_NAME,
  description: [
    '提交本轮正文确认的变量变化，以返回的实际执行校验结果为准。变量通过本工具提交，不在回复中输出 XML 变量协议；人物卡中的变量含义、更新条件和校验规则仍须遵守。',
    '所有写入值使用 valueJson 提交 JSON 编码字符串，不使用 value；对象必须编码完整对象，数字不能用布尔值代替。',
    '最多提交三次。若 ok=false 且 retryable=true，读取 error、failures 和 runtimeDiagnostics，根据 currentVariables 与变量结构修正完整 operations 后重试，不要原样反复提交。',
    'rolledBack=true 表示整批修改未保存，可以基于原快照重新提交完整更新；不得用空 operations 掩盖尚未修复的失败。',
    '返回 ok=true 或 retryable=false 后停止调用本工具，不能重复执行已成功的变量更新，也不能绕过人物卡校验。'
  ].join('\n'),
  parameters: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: {
      operations: {
        type: 'array',
        description: '官方 MVU JSON Patch 方言。path/from 使用完整变量快照中的绝对路径（例如 /stat_data/角色/好感度）；有变化时提交完整 operations，没有变化时提交空数组。',
        items: operationSchema
      }
    },
    required: ['operations']
  })
})

const memoryWriteSchema = {
  type: 'object', additionalProperties: false,
  properties: { path: { type: 'string' }, text: { type: 'string' } },
  required: ['path', 'text']
}

/** Build the single settlement payload for the enabled state channels. */
export function createSettlementSubmitTool({ variables = true, posture = false, memory = false } = {}) {
  const properties = {}
  const required = []
  if (variables) {
    properties.operations = {
      type: 'array',
      description: '官方 MVU JSON Patch 方言。path/from 使用完整变量快照中的绝对路径（例如 /stat_data/角色/好感度）；有变化时提交完整 operations，没有变化时提交空数组。',
      items: operationSchema
    }
    required.push('operations')
  }
  if (posture) {
    properties.posture = { type: 'string', description: '本轮结束时正文可见的主要人物姿势、站位、衣着与持物状态。' }
    required.push('posture')
  }
  if (memory) {
    properties.memory = {
      type: 'object', additionalProperties: false,
      properties: {
        writes: { type: 'array', items: memoryWriteSchema },
        deletes: { type: 'array', items: { type: 'string' } }
      },
      required: ['writes', 'deletes'],
      description: '本局持久记忆文件变更；无变化时提交空 writes 和 deletes。'
    }
    required.push('memory')
  }
  const channels = [variables && '变量', posture && '姿势', memory && '记忆'].filter(Boolean).join('、') || '结算'
  const description = [
    `一次性提交本轮${channels}。只调用 settlement_submit 一次，并在同一参数中填写所有启用字段。`,
    variables ? '变量仍须遵守人物卡结构、更新规则和 MVU 校验；写入值使用 valueJson JSON 编码字符串。' : '',
    posture ? '姿势只记录正文已经确认的本轮结束状态。' : '',
    memory ? '记忆只记录已发生事实和人物各自所知；路径仅限 memory/、characters/、tables/。' : '',
    '校验失败时本轮停止并保留可恢复状态；不要另行调用旧变量、姿势或记忆提交工具，也不要重复提交。'
  ].filter(Boolean).join('\n')
  return Object.freeze({
    name: SETTLEMENT_SUBMIT_TOOL_NAME,
    description,
    parameters: Object.freeze({
      type: 'object', additionalProperties: false, properties, required
    })
  })
}

// Broad compatibility export. Runtime tasks should use the factory so the
// schema requires exactly the channels enabled for the current turn.
export const SETTLEMENT_SUBMIT_TOOL = createSettlementSubmitTool({ variables: true, posture: true, memory: true })

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

// Prompt-only projection. Never strip the authoritative Frame or the runtime's
// validation/persistence data. MVU's display/delta roots are derived mirrors;
// its schema is sent once in the dedicated structure section instead.
function promptVariables(value) {
  const variables = clone(object(value))
  if (variables.stat_data !== null && typeof variables.stat_data === 'object' && !Array.isArray(variables.stat_data)) {
    delete variables.schema
    delete variables.display_data
    delete variables.delta_data
    withoutMetadataKeys(variables.stat_data)
  }
  return variables
}

// MVU reads `$meta` (strictSet, extensible, templates) into the schema and the
// structure section already states it; left in the snapshot it reads as one more
// state field the model may try to update (#153). Only object keys are hidden:
// dropping an array element would shift every index the model writes back.
function withoutMetadataKeys(value) {
  if (Array.isArray(value)) { value.forEach(withoutMetadataKeys); return }
  if (value === null || typeof value !== 'object') return
  for (const key of Object.keys(value)) {
    if (key === '$meta') delete value[key]
    else withoutMetadataKeys(value[key])
  }
}

function retryPromptState(variables, initialSchema) {
  const schema = object(variables && variables.schema)
  return {
    currentVariables: promptVariables(variables),
    // Initial schema is already in context. If validation produced a new one,
    // retain it for correction rather than silently applying the old contract.
    ...(Object.keys(schema).length > 0 && !sameValue(schema, initialSchema) ? { variableSchema: clone(schema) } : {})
  }
}

// Bounded per-failure evidence avoids forcing another lookup merely to discover
// which submitted value the card discarded. Never infer the card's allowed set.
function rejectedOperations(operations, failures, after) {
  const json = value => {
    const text = JSON.stringify(value)
    return text === undefined ? '(missing)' : text.length > 1024 ? text.slice(0, 1024) + '…(truncated)' : text
  }
  return operations.filter(operation => failures.some(failure => failure.path === operation.path && failure.operation === operation.op)).slice(0, 20).map(operation => ({
    operation: operation.op, path: operation.path,
    ...(Object.hasOwn(operation, 'value') ? {submittedJson:json(operation.value)} : {}),
    observedJson: json(valueAtPointer(after, variablesPointer(operation.path)).value)
  }))
}

function pointerSegment(value) {
  return str(value).replaceAll('~', '~0').replaceAll('/', '~1')
}

function displayValue(value) {
  if (value === undefined) return '（不存在）'
  if (typeof value === 'string') return value
  const text = JSON.stringify(value)
  return text === undefined ? str(value) : text
}

function diffValues(before, after, path = '', result = []) {
  if (sameValue(before, after) || result.length >= 200) return result
  const beforeObject = before !== null && typeof before === 'object'
  const afterObject = after !== null && typeof after === 'object'
  if (beforeObject && afterObject && Array.isArray(before) === Array.isArray(after)) {
    const keys = new Set(Array.isArray(before)
      ? Array.from({ length: Math.max(before.length, after.length) }, function (_value, index) { return String(index) })
      : Object.keys(before).concat(Object.keys(after)))
    for (const key of keys) diffValues(before[key], after[key], path + '/' + pointerSegment(key), result)
    return result
  }
  result.push({
    operation: before === undefined ? 'insert' : (after === undefined ? 'delete' : 'set'),
    path: path || '/',
    before: displayValue(before),
    after: displayValue(after)
  })
  return result
}

function pointerSegments(pointer) {
  return str(pointer).split('/').slice(1).map(function (segment) {
    return segment.replaceAll('~1', '/').replaceAll('~0', '~')
  })
}

function variablesPointer(pointer) {
  const segments = pointerSegments(pointer)
  if (segments[0] === 'stat_data') return '/' + segments.map(pointerSegment).join('/')
  return '/stat_data/' + segments.map(pointerSegment).join('/')
}

function valueAtPointer(value, pointer) {
  let current = value
  for (const segment of pointerSegments(pointer)) {
    if (current === null || current === undefined || !Object.prototype.hasOwnProperty.call(Object(current), segment)) {
      return { exists: false, value: undefined }
    }
    current = current[segment]
  }
  return { exists: true, value: current }
}

function pathsOverlap(left, right) {
  return left === right || left.startsWith(right + '/') || right.startsWith(left + '/')
}

function operationPointers(operation) {
  if (operation.op === 'move') return [variablesPointer(operation.from), variablesPointer(operation.path)]
  const target = variablesPointer(operation.path)
  if ((operation.op === 'insert' || operation.op === 'add') && target.endsWith('/-')) {
    return [target.slice(0, -2)]
  }
  return [target]
}

function operationNeedsMutation(operation, before) {
  const target = valueAtPointer(before, variablesPointer(operation.path))
  if (operation.op === 'remove') return target.exists
  if (operation.op === 'move') return valueAtPointer(before, variablesPointer(operation.from)).exists
  if (operation.op === 'delta') return operation.value !== 0
  return !target.exists || !sameValue(target.value, operation.value)
}

/** Attribute final state changes to submitted operations and expose silent runtime rejection. */
function auditMvuSettlement(before, after, operations) {
  const allChanges = diffValues(before, after)
  const claimed = new Set()
  const failures = []
  for (const operation of operations) {
    const pointers = operationPointers(operation)
    const matches = []
    for (let index = 0; index < allChanges.length; index++) {
      if (pointers.some(function (pointer) { return pathsOverlap(allChanges[index].path, pointer) })) {
        matches.push(index)
        claimed.add(index)
      }
    }
    if (matches.length === 0 && operationNeedsMutation(operation, before)) {
      failures.push({
        operation: operation.op,
        path: operation.path,
        message: '未观察到对应变量变化；请通过“日志”导出执行记录'
      })
    }
  }
  return {
    changes: allChanges.filter(function (_change, index) { return claimed.has(index) }),
    sideEffects: allChanges.filter(function (_change, index) { return !claimed.has(index) }),
    failures
  }
}

function assertPointer(value, label) {
  const pointer = str(value)
  if (pointer === '' || pointer[0] !== '/') throw new Error(label + ' 必须是 JSON Pointer')
  return pointer
}

function stripTaggedBlock(value, name) {
  return value.replace(new RegExp('<' + name + '\\b[^>]*>[\\s\\S]*?<\\/' + name + '\\s*>', 'gi'), '')
}

function stripHtmlFences(value) {
  return value.replace(/^[ \t]{0,3}(`{3,}|~{3,})[ \t]*(?:html?|xhtml)(?:[ \t][^\r\n]*)?\r?\n[\s\S]*?^[ \t]{0,3}\1[ \t]*$/gim, '')
}

/** Extract only confirmed story prose from one final foreground response. */
export function extractMvuStoryText(value) {
  let text = str(value)
  text = stripTaggedBlock(text, 'UpdateVariable')
  text = stripTaggedBlock(text, 'visual_cards')
  text = stripHtmlFences(text)
  text = text.replace(/<StatusPlaceHolderImpl\s*\/?>/gi, '')
  text = text.replace(/<StatusPlaceholder\s*\/?>/gi, '')
  text = text.replace(/(?:[ \t]*\r?\n){3,}/g, '\n\n').trim()
  if (text === '') throw new Error('本轮最终回复剔除控制协议后没有可用于变量结算的剧情正文')
  return text
}

function normalizeOperation(raw, index) {
  const operation = object(raw)
  const op = str(operation.op).trim().toLowerCase()
  const label = '变量操作 #' + (index + 1)
  if (!['replace', 'insert', 'add', 'delta', 'remove', 'move'].includes(op)) throw new Error(label + ' 的 op 不受支持')
  const normalized = { op, path: assertPointer(operation.path, label + ' path') }
  if (op === 'move') {
    normalized.from = assertPointer(operation.from, label + ' from')
    return normalized
  }
  if (op === 'remove') return normalized
  let value
  if (Object.hasOwn(operation, 'valueJson')) {
    if (Object.hasOwn(operation, 'value')) throw new Error(label + ' 不得同时提交 valueJson 和 value')
    if (typeof operation.valueJson !== 'string') throw new Error(label + ' 的 valueJson 必须是 JSON 编码字符串')
    try {
      value = JSON.parse(operation.valueJson, (_key, item) => {
        if (typeof item === 'number' && !Number.isFinite(item)) throw new Error('非有限数字')
        return item
      })
    } catch {
      throw new Error(label + ' 的 valueJson 不是有效 JSON（数字必须有限）')
    }
  } else {
    // Pending deliveries and older in-flight callers already store decoded values.
    if (!Object.hasOwn(operation, 'value')) throw new Error(label + ' 缺少 valueJson（旧格式 value）')
    value = operation.value
  }
  if (op === 'delta' && (typeof value !== 'number' || !Number.isFinite(value))) {
    throw new Error(label + ' 的 delta value 必须是有限数字')
  }
  normalized.value = clone(value)
  return normalized
}

/** Validate and normalize the single tool submission before any runtime effect. */
export function normalizeMvuToolSubmission(value) {
  const input = object(value)
  if (!Array.isArray(input.operations)) throw new Error('结算提交缺少 operations 数组')
  // Older callers may still include `analysis`; it is intentionally ignored.
  return {
    operations: input.operations.map(normalizeOperation)
  }
}

function normalizeSettlementMemoryPath(value, label) {
  if (typeof value !== 'string' || value.length > 240 || value !== value.normalize('NFC') || /[\\<>:"|?*\p{C}]/u.test(value)) {
    throw new Error(label + ' 无效')
  }
  const parts = value.split('/')
  if (!['memory', 'characters', 'tables'].includes(parts[0])) throw new Error(label + ' 须位于 memory/、characters/ 或 tables/ 下')
  for (const part of parts) {
    if (!part || part.length > 96 || part.startsWith('.') || /^[\s]|[.\s]$/.test(part)
      || /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(part)
      || /^(?:node_modules|objects|snapshots|game-memory|__proto__|prototype|constructor)$/i.test(part)) {
      throw new Error(label + ' 含有保留名称')
    }
  }
  if (!/\.(?:md|json|csv|txt)$/i.test(value)) throw new Error(label + ' 仅支持 md/json/csv/txt 文件')
  return value
}

/** Normalize the shared settlement_submit payload before any persistence or runtime effect. */
export function normalizeSettlementSubmission(value, options = {}) {
  const input = object(value)
  const variablesEnabled = options.variables !== false
  const postureEnabled = options.posture === true
  const memoryEnabled = options.memory === true
  const result = {}
  if (variablesEnabled) {
    const submission = resolveMvuSubmissionMacros(normalizeMvuToolSubmission(input), options)
    if (options.currentVariables !== undefined) assertMvuValueKinds(submission.operations, options.currentVariables)
    result.submission = submission
  } else if (input.operations !== undefined) {
    throw new Error('本轮未启用变量结算，不能提交 operations')
  }
  if (postureEnabled) {
    result.posture = normalizePostureSubmission({ posture: input.posture }, options).posture
  } else if (input.posture !== undefined) {
    throw new Error('本轮姿势结算已关闭，不能提交 posture')
  }
  if (memoryEnabled) {
    const memory = object(input.memory)
    if (!Array.isArray(memory.writes) || !Array.isArray(memory.deletes)) {
      throw new Error('settlement_submit 必须提供 memory.writes 和 memory.deletes；无变化时提交空数组')
    }
    if (memory.writes.length > 32 || memory.deletes.length > 32) throw new Error('单次记忆文件修改数量超限')
    let memoryBytes = 0
    const paths = new Set()
    for (const item of memory.writes) {
      const path = normalizeSettlementMemoryPath(item?.path, '记忆写入路径')
      if (typeof item.text !== 'string' || item.text.includes('\u0000') || Buffer.byteLength(item.text, 'utf8') > 256 * 1024) {
        throw new Error('记忆写入文本无效或超过单文件大小限制')
      }
      memoryBytes += Buffer.byteLength(item.text, 'utf8')
      if (memoryBytes > 4 * 1024 * 1024) throw new Error('记忆文件总量超过限制')
      const key = path.toLowerCase()
      if (paths.has(key)) throw new Error('记忆文件修改存在重复路径：' + path)
      paths.add(key)
    }
    for (const path of memory.deletes) {
      const normalized = normalizeSettlementMemoryPath(path, '记忆删除路径')
      const key = normalized.toLowerCase()
      if (paths.has(key)) throw new Error('记忆文件修改存在重复路径：' + normalized)
      paths.add(key)
    }
    result.memory = clone(memory)
  } else if (input.memory !== undefined) {
    throw new Error('本轮未启用持久记忆，不能提交 memory')
  }
  return result
}

function valueKind(value) {
  return Array.isArray(value) ? '列表' : value !== null && typeof value === 'object' ? '对象' : typeof value === 'number' ? '数字' : typeof value === 'boolean' ? '布尔值' : value === null ? '空值' : '文本'
}
// A replace that changes a field's shape (list <-> text <-> object) makes MVU's
// schema diverge and the card's view mis-render. Let the agent fix it and retry.
function assertMvuValueKinds(operations, variables) {
  const root = object(variables)
  const compatible = (before, after) => before === after || (before === '数字' && after === '文本') || (before === '文本' && after === '数字')
  const elementKind = list => {
    const kinds = [...new Set(list.map(valueKind))]
    return kinds.length === 1 ? kinds[0] : null
  }
  function lookup(keys) {
    let target = keys[0] === 'stat_data' ? root : object(root.stat_data)
    for (const key of keys) {
      if (target === null || typeof target !== 'object' || !Object.hasOwn(target, key)) return { found: false }
      target = target[key]
    }
    return { found: true, target }
  }
  const fail = (index, path, before, after, element) => {
    throw new Error('变量操作 #' + (index + 1) + ' 类型不一致：' + path + (element ? ' 的列表元素' : '') + ' 当前是' + before + '，提交的是' + after + '；请按原类型提交（列表用 JSON 数组，元素与已有元素同形）')
  }
  for (const [index, operation] of operations.entries()) {
    if (!['replace', 'insert', 'add'].includes(operation.op)) continue
    const keys = operation.path.split('/').slice(1).map(key => key.replace(/~1/g, '/').replace(/~0/g, '~'))
    const self = lookup(keys)
    if (operation.op === 'replace' && self.found && self.target !== null) {
      const before = valueKind(self.target), after = valueKind(operation.value)
      if (!compatible(before, after)) fail(index, operation.path, before, after, false)
      // Elements of a list keep the shape of the existing ones (MVU infers the element schema).
      if (Array.isArray(self.target) && Array.isArray(operation.value) && self.target.length) {
        const kind = elementKind(self.target)
        const bad = kind && operation.value.find(item => !compatible(kind, valueKind(item)))
        if (bad !== undefined && kind) fail(index, operation.path, kind, valueKind(bad), true)
      }
      continue
    }
    // Inserting into a list: the new element matches its siblings.
    const parent = lookup(keys.slice(0, -1))
    if (parent.found && Array.isArray(parent.target) && parent.target.length && (keys.at(-1) === '-' || /^\d+$/.test(keys.at(-1)))) {
      const kind = elementKind(parent.target)
      if (kind && !compatible(kind, valueKind(operation.value))) fail(index, operation.path, kind, valueKind(operation.value), true)
    }
  }
}

function resolveMvuValueMacros(value, input) {
  if (typeof value === 'string') {
    return resolveRuntimeMacroText(value, {
      charName: input.charName,
      macroState: input.macroState
    }).text
  }
  if (Array.isArray(value)) return value.map(item => resolveMvuValueMacros(item, input))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveMvuValueMacros(item, input)]))
  }
  return value
}

function resolveMvuSubmissionMacros(submission, input) {
  return {
    operations: submission.operations.map(operation => Object.hasOwn(operation, 'value')
      ? { ...operation, value: resolveMvuValueMacros(operation.value, input) }
      : operation)
  }
}

// DSH exposes paths against the complete variable snapshot so Agent input,
// diagnostics, and receipts share one unambiguous namespace. Official MVU
// already applies JSON Patch commands to `variables.stat_data`, so its wire
// protocol must not receive that root a second time. Keep accepting legacy
// relative paths because persisted pending submissions may still contain them.
function officialMvuPointer(pointer) {
  if (pointer === '/stat_data') return ''
  return pointer.startsWith('/stat_data/') ? pointer.slice('/stat_data'.length) : pointer
}

function officialMvuOperations(operations) {
  return operations.map(function (operation) {
    const wire = { ...operation, path: officialMvuPointer(operation.path) }
    if (operation.op === 'move') wire.from = officialMvuPointer(operation.from)
    return wire
  })
}

/** Convert a validated tool call into the canonical protocol understood by official MVU. */
export function formatMvuUpdateCommand(value) {
  const submission = normalizeMvuToolSubmission(value)
  return [
    '<UpdateVariable>',
    '<JSONPatch>',
    JSON.stringify(officialMvuOperations(submission.operations), null, 2),
    '</JSONPatch>',
    '</UpdateVariable>'
  ].join('\n')
}

// Helper-created messages belong to the next foreground reply. Bound the handoff
// by that reply, so retries are stable and later turns cannot replay setup rules.
export function collectMvuHelperContext(messages, messageId) {
  if (!Array.isArray(messages) || !Number.isInteger(messageId) || messageId < 0 || messageId >= messages.length) return []
  let start = messageId - 1
  while (start >= 0 && messages[start]?.role !== 'assistant') start--
  return messages.slice(start + 1, messageId)
    .filter(message => message?.role === 'tavern-helper')
    .map(message => str(message.text).trim()).filter(Boolean)
}

export function createMvuBackgroundTaskFrame(input = {}) {
  const currentVariables = clone(object(input.currentVariables))
  const variableSchema = clone(object(input.variableSchema || currentVariables.schema))
  const storyText = extractMvuStoryText(input.storyText)
  const messageId = Number(input.messageId)
  const swipeId = Number(input.swipeId)
  if (!Number.isInteger(messageId) || messageId < 0) throw new Error('变量结算 messageId 无效')
  if (!Number.isInteger(swipeId) || swipeId < 0) throw new Error('变量结算 swipeId 无效')
  return createBackgroundTaskFrame({
    frameId: str(input.operationId),
    chatId: input.chatId,
    branchId: input.branchId,
    basedOnRevision: input.basedOnRevision,
    taskType: 'mvu-variable-settlement',
    trigger: {
      operationId: str(input.operationId),
      messageId,
      swipeId,
      storyDigest: str(input.storyDigest)
    },
    foregroundOutput: { storyText },
    authoritativeState: { currentVariables, variableSchema },
    taskRules: {
      updateRules: Array.isArray(input.updateRules) ? input.updateRules.map(str).filter(Boolean) : [],
      backgroundTasks: normalizeBackgroundTasks(input.backgroundTasks),
      helperContext: Array.isArray(input.helperContext) ? input.helperContext.map(str).filter(Boolean) : [],
      guides: Array.isArray(input.guides) ? input.guides.map(item => str(item?.text ?? item).trim()).filter(Boolean) : [],
      guidance: str(input.guidance).trim(),
      updateOnlyFromStory: true
    },
    outputContract: { tool: SETTLEMENT_SUBMIT_TOOL_NAME, required: true, singleCommit: true, maxToolCalls: 1 }
  })
}

/** Stable, isolated input for one background provider request. */
export function projectMvuBackgroundRequest(frame, { memory = false } = {}) {
  if (!frame || frame.taskType !== 'mvu-variable-settlement') throw new Error('不是 MVU 变量结算 Frame')
  const state = object(frame.authoritativeState)
  const output = object(frame.foregroundOutput)
  const rules = object(frame.taskRules)
  const tasks = normalizeBackgroundTasks(rules.backgroundTasks)
  const updateRules = Array.isArray(rules.updateRules) ? rules.updateRules : []
  return {
    messages: [{
      id: frame.frameId + ':story',
      role: 'assistant',
      regexPlacement: 2,
      content: [{ type: 'text', text: str(output.storyText) }],
      source: { kind: 'plugin', plugin: 'dsh-tavern', form: 'mvu-final-story' }
    }],
    // Stable schema and rules precede the per-turn snapshot so the shared background prefix stays cacheable.
    turnContext: [
      '【变量结构】',
      JSON.stringify(state.variableSchema || {}),
      ...(updateRules.length === 0 ? [] : ['【人物卡变量更新规则】', updateRules.join('\n\n')]),
      '【当前变量快照】',
      JSON.stringify(promptVariables(state.currentVariables)),
      ...(rules.helperContext?.length ? ['【本轮人物卡 Helper 交接】',
        '以下是本轮正文之前人物卡脚本提供的数据与要求。已确认的建角设定和明确的变量初始化要求可用于本轮初始化；其余剧情意图、候选行动仍须以正文已经发生的事实为准。遵守变量只读规则，不重算脚本负责的派生字段。',
        ...rules.helperContext] : []),
      ...(rules.guides?.length ? ['【玩家 Guide · 持续生效】',
        '玩家对本局的持续要求。结算时遵循其中关于变量取向、数值尺度和状态变化的要求；不得据此制造正文未发生的事件。',
        ...rules.guides.map((text, index) => (index + 1) + '. ' + text)] : []),
      ...(rules.guidance ? ['【本次重新结算的指导意见（仅本次有效）】', str(rules.guidance)] : []),
      ...(tasks.characterDesign ? ['【人物设计（按需）】',
      '若本轮出现值得长期保留的重要人物，可先调用 skill 加载 character-design，再按 Skill 读取或保存人物档案。人物设计独立保存，不属于 MVU operations。'] : [])
    ].join('\n'),
    system: [
      '只根据【正文】中已经确认发生的事实结算变量，不得读取或推断玩家意图。',
      '不得根据旧轮剧情、隐藏思考、候选项或未发生事件更新变量。',
      ...(tasks.characterDesign ? ['若确实需要人物设计，在当前后台 Agent 内先加载 character-design 并调用人物档案工具；无需也不得创建另一个 Agent。完成后继续本轮结算。'] : []),
      tasks.posture ? '将变量与本轮结束时可见的人物姿势放在同一个 settlement_submit 调用中；不得拆成多个工具调用，也不得在回复正文输出 JSON。' : '本轮姿势结算已关闭，不要生成姿势。',
      memory ? '若启用持久记忆，把记忆 writes/deletes 放在同一次 settlement_submit 的 memory 字段中；不得单独调用记忆提交工具。' : '',
      '本轮只允许一次 settlement_submit。宿主会校验完整提交；失败时停止本轮，不再发起自动修正请求。',
      '数值不确定时，合理即可，不要求必须精确。'
    ].filter(Boolean).join('\n'),
    tools: [createSettlementSubmitTool({ variables: true, posture: tasks.posture, memory }),
      ...(tasks.characterDesign ? [CHARACTER_DESIGN_READ_TOOL, CHARACTER_DESIGN_SAVE_TOOL] : [])]
  }
}

/** Own model/tool/runtime details behind one variable-settlement action. */
export function createMvuSettlementModule(options = {}) {
  if (!options.model || typeof options.model.run !== 'function') throw new Error('MVU Settlement 缺少后台模型 adapter')
  if (!options.runtime || typeof options.runtime.settleMvuUpdate !== 'function') throw new Error('MVU Settlement 缺少官方 Runtime adapter')
  const characterDesign = options.characterDesign
  // This remains a broad task-tool guard for optional maintenance tools. The
  // settlement payload itself has an independent hard limit of one attempt.
  const maxToolCalls = Math.max(1, Math.min(3, Math.floor(Number(options.maxAttempts) || 3))) + 12
  function taskFrame(input) {
    return createMvuBackgroundTaskFrame(input)
  }

  async function applySubmission(input, frame, submission, diagnosticId, prepared) {
    if (input.onSubmission) await input.onSubmission(clone(submission), prepared ? clone(prepared) : undefined)
    const applied = await options.runtime.settleMvuUpdate({
      compactResult: true,
      durable: Boolean(input.onSubmission), signal: input.signal,
      operationId: input.operationId,
      chatId: input.chatId, branchId: input.branchId, basedOnRevision: input.basedOnRevision,
      sessionId: input.sessionId, messageId: input.messageId, swipeId: input.swipeId,
      expectedLifecycleRevision: input.expectedLifecycleRevision, diagnosticId,
      baselineVariables: input.currentVariables,
      preserveForeground: input.preserveForeground === true,
      storyText: frame.foregroundOutput.storyText,
      command: formatMvuUpdateCommand(submission),
      validate: ({ before, after }) => auditMvuSettlement(before, after, submission.operations)
    })
    if (applied.deferred === true || applied.stale === true) return { applied }
    const projected = applied.context?.messages?.[input.messageId]
    const after = clone(applied.variables || projected?.variables || {})
    const audit = applied.validation || auditMvuSettlement(input.currentVariables, after, submission.operations)
    const rolledBack = applied.rejected === true
    const changes = rolledBack ? [] : audit.changes
    const sideEffects = rolledBack ? [] : audit.sideEffects
    const status = audit.failures.length > 0
      ? (changes.length > 0 ? 'partial' : 'error')
      : (changes.length > 0 ? 'updated' : 'unchanged')
    return { applied, after, audit, rolledBack, changes, sideEffects, status, effect: applied.effect }
  }

  function pendingReceipt(applied, diagnosticId) {
    const reasons = {
      'claim-timeout': '任务领取超时，变量操作已保存，等待重新投递；无需反复重载 MVU。',
      'runtime-busy': '执行器正在处理其他任务，变量操作已保存，等待空闲后继续。',
      'runtime-not-ready': 'MVU 执行器尚未就绪，变量操作已保存，就绪后自动继续。',
      'delivery-interrupted': '任务投递中断，变量操作已保存，等待重新投递。'
    }
    const deferredReason = Object.hasOwn(reasons, applied.deferredReason) ? applied.deferredReason : 'runtime-not-ready'
    return { version: 1, status: 'pending', deferredReason, summary: reasons[deferredReason], diagnosticId, changes: [], sideEffects: [], failures: [] }
  }

  async function resumeVariables(input = {}) {
    const frame = taskFrame(input)
    const submission = resolveMvuSubmissionMacros(normalizeMvuToolSubmission(input.submission), input)
    const diagnosticId = frame.frameId + ':resume'
    const outcome = await applySubmission(input, frame, submission, diagnosticId)
    if (outcome.applied.deferred === true) {
      return { frame, submission, variables: clone(input.currentVariables),
        receipt: pendingReceipt(outcome.applied, diagnosticId) }
    }
    if (outcome.applied.stale === true) {
      return { frame, submission, receipt: { version: 1, status: 'stale', summary: '变量结算目标已经变化，迟到结果未写入。', diagnosticId, changes: [], sideEffects: [], failures: [] } }
    }
    const result = {
      frame, submission, variables: outcome.after, effect: outcome.effect,
      receipt: { version: 1, status: outcome.status, summary: '', diagnosticId,
        runtimeDiagnostics: outcome.applied.diagnostics || [], changes: outcome.changes,
        sideEffects: outcome.sideEffects, failures: outcome.audit.failures }
    }
    if (input.onPrepared && outcome.audit.failures.length === 0) await input.onPrepared(clone(result))
    return result
  }

  async function settleVariables(input = {}) {
    const frame = taskFrame(input)
    const extraTask = input.extraTask || null
    const tasks = normalizeBackgroundTasks(input.backgroundTasks)
    const memoryPending = Boolean(extraTask && !extraTask.complete())
    const request = projectMvuBackgroundRequest(frame, { memory: memoryPending })
    let attempt = 0
    let result = null
    let feedback = null
    let posture = null
    let settlementSubmissionSeen = false
    let terminalFailure = false
    let traceSessionId = str(input.persistentSessionId)
    let traceBoundary = null
    let diagnosticId = frame.frameId + ':attempt-1'
    let toolTail = Promise.resolve()
    const executionPolicy = {
      settlementTool: SETTLEMENT_SUBMIT_TOOL_NAME,
      maxSettlementSubmissions: 1,
      retrySettlementValidationInAgent: false,
      maintenanceStage: tasks.characterDesign ? 'maintenance' : null,
      maintenanceMayRequireAdditionalRequests: tasks.characterDesign === true
    }
    async function record(stage, details = {}) {
      try { await options.diagnostics?.record(input.sessionId, { diagnosticId, operationId: input.operationId, chatId: input.chatId, branchId: input.branchId, basedOnRevision: input.basedOnRevision, messageId: input.messageId, swipeId: input.swipeId, attempt, traceSessionId, stage, ...details }) } catch { /* Diagnostics must not change settlement behaviour. */ }
    }
    async function rejectSettlement(error, details = {}) {
      terminalFailure = true
      feedback = { ok: false, retryable: false, error: str(error?.message || error), ...details }
      await record('submission-rejected', { error: feedback.error, ...details })
      return JSON.stringify(feedback)
    }
    function memoryInstruction() {
      if (!extraTask) return ''
      const source = typeof extraTask.singleSubmitSystem === 'string' && extraTask.singleSubmitSystem.trim() !== ''
        ? extraTask.singleSubmitSystem : str(extraTask.system)
      const compatible = source
        .replace(/[^。\n]*必须[^。\n]*tavern_memory_submit[^。\n]*。/g, '')
        .replace(/tavern_memory_submit/g, 'settlement_submit 的 memory 字段')
      return [compatible, memoryPending
        ? '本轮记忆通过唯一的 settlement_submit 调用提交于 memory 字段；没有变化时提交空 writes 和 deletes。不要调用独立记忆提交工具。'
        : '本轮记忆已经暂存或完成；settlement_submit 不包含 memory 字段，也不要再次生成或提交记忆。'].filter(Boolean).join('\n')
    }
    async function prepareMemory(value) {
      if (!extraTask) {
        if (value !== undefined) throw new Error('本轮未启用持久记忆，不能提交 memory 字段')
        return
      }
      if (extraTask.complete()) {
        if (value !== undefined) throw new Error('本轮记忆已暂存或完成，不要重复提交 memory 字段')
        return
      }
      if (!value || !Array.isArray(value.writes) || !Array.isArray(value.deletes)) {
        throw new Error('settlement_submit 必须提供 memory.writes 和 memory.deletes；无变化时提交空数组')
      }
      if (typeof extraTask.execute !== 'function') throw new Error('本局记忆聚合提交工具不可用')
      let response
      try {
        response = JSON.parse(await extraTask.execute({ name: 'tavern_memory_submit', arguments: value }))
      } catch (error) {
        throw new Error('记忆暂存失败：' + str(error?.message || error))
      }
      if (response?.ok !== true || !extraTask.complete()) {
        throw new Error(str(response?.error || '记忆暂存未完成'))
      }
    }
    async function executeTool(call) {
      if (terminalFailure || (feedback?.ok === true && settlementSubmissionSeen)) {
        return JSON.stringify({ ok: false, retryable: false, error: '本轮结算已终止或提交完成，拒绝后续工具调用。' })
      }
      if (call && (call.name === CHARACTER_DESIGN_READ_TOOL_NAME || call.name === CHARACTER_DESIGN_SAVE_TOOL_NAME)) {
        if (!tasks.characterDesign) return JSON.stringify({ ok: false, error: '人物设计已关闭' })
        if (!characterDesign || typeof characterDesign.execute !== 'function') {
          return JSON.stringify({ ok: false, retryable: false, error: '人物设计存储不可用，请继续完成姿势与变量结算' })
        }
        return await characterDesign.execute(input.chatId, call)
      }
      if (!call || call.name !== SETTLEMENT_SUBMIT_TOOL_NAME) {
        const legacy = [MVU_SUBMIT_UPDATE_TOOL_NAME, POSTURE_SUBMIT_TOOL_NAME,
          ...(extraTask?.tools || []).map(tool => tool.name)].includes(call?.name)
        return await rejectSettlement(new Error(legacy
          ? '旧变量、姿势和记忆提交工具已停用；请在一次 settlement_submit 中提交所有启用字段。'
          : '后台结算只接受 settlement_submit 聚合提交。'))
      }
      if (settlementSubmissionSeen) {
        terminalFailure = true
        feedback = { ok: false, retryable: false, error: '本轮只接受一次 settlement_submit，重复提交已拒绝。' }
        return JSON.stringify(feedback)
      }
      settlementSubmissionSeen = true
      attempt++
      diagnosticId = frame.frameId + ':attempt-1'
      await record('start', { variables: variableDiagnosticSummary(input.currentVariables) })
      let submission, preparedPosture
      try {
        const normalized = normalizeSettlementSubmission(call.arguments, {
          variables: true,
          posture: tasks.posture,
          memory: memoryPending,
          currentVariables: input.currentVariables,
          charName: input.charName,
          macroState: input.macroState
        })
        submission = normalized.submission
        preparedPosture = normalized.posture ? { posture: normalized.posture } : null
        await prepareMemory(normalized.memory)
      } catch (error) {
        return await rejectSettlement(error, { argumentKeys: Object.keys(object(call?.arguments)) })
      }
      posture = preparedPosture || null
      await record('submitted', {
        operations: submission.operations,
        postureSubmitted: posture !== null,
        memoryPrepared: memoryPending
      })
      let applied
      try {
        applied = await applySubmission(input, frame, submission, diagnosticId, preparedPosture)
      } catch (error) {
        // A timeout or disk error may have an uncertain outcome; do not replay a delta.
        await record('failed', { error: str(error.message || error) })
        terminalFailure = true
        feedback = { ok: false, retryable: false, error: str(error.message || error), note: '执行或保存结果无法确认，停止自动重试以避免重复更新。' }
        result = { submission, receipt: { version: 1, status: 'error', summary: feedback.error, diagnosticId, changes: [], sideEffects: [], failures: [{ message: feedback.error }] } }
        return JSON.stringify(feedback)
      }
      if (applied.applied.deferred === true) {
        await record('deferred')
        const receipt = pendingReceipt(applied.applied, diagnosticId)
        terminalFailure = true
        feedback = { ok: false, retryable: false, deferred: true, deferredReason: receipt.deferredReason, error: receipt.summary }
        result = { variables: clone(input.currentVariables), submission,
          receipt }
        return JSON.stringify(feedback)
      }
      if (applied.applied.stale === true) {
        await record('stale')
        terminalFailure = true
        feedback = { ok: false, retryable: false, error: '变量结算目标已经变化，迟到结果未写入。' }
        result = { receipt: { version: 1, status: 'stale', summary: feedback.error, changes: [], sideEffects: [], failures: [] } }
        return JSON.stringify(feedback)
      }
      const after = applied.after
      const audit = applied.audit
      const rolledBack = applied.rolledBack
      const changes = applied.changes
      const sideEffects = applied.sideEffects
      const status = applied.status
      result = {
        variables: after, submission, effect: applied.effect,
        receipt: { version: 1, status, summary: '', diagnosticId,
          runtimeDiagnostics: applied.applied.diagnostics || [], changes, sideEffects, failures: audit.failures }
      }
      if (input.onPrepared && audit.failures.length === 0) await input.onPrepared(clone({ ...result, posture: posture?.posture }))
      feedback = {
        ok: audit.failures.length === 0,
        retryable: false,
        rolledBack, status, changes, failures: audit.failures,
        runtimeDiagnostics: applied.applied.diagnostics || [],
        ...(audit.failures.length === 0 ? {} : { error: '变量更新未通过校验；本轮自动修订已停止。请检查执行回执后使用手动重试，不能绕过人物卡约束。', rejectedOperations: rejectedOperations(submission.operations, audit.failures, after), ...retryPromptState(after, frame.authoritativeState.variableSchema) })
      }
      terminalFailure = audit.failures.length > 0
      await record('result', { status, rolledBack, retryable: false, variables: variableDiagnosticSummary(after), changes, sideEffects, failures: audit.failures, runtimeDiagnostics: applied.applied.diagnostics || [] })
      return JSON.stringify(feedback)
    }
    let run = {}
    try {
      run = await options.model.run({
        task: 'settlement', backgroundTasks: tasks, persistent: true, persistentSessionId: traceSessionId, rewindTo: -1,
        rootOperationId: str(input.rootOperationId), rootTurn: Math.max(0, Number(input.rootTurn ?? input.turn) || 0),
        branchId: str(input.branchId), stage: 'settlement',
        onPersistentSessionReady: input.onPersistentSessionReady,
        selection: input.selection, messages: request.messages, turnContext: request.turnContext,
        system: [str(input.system).trim(), request.system, memoryInstruction()].filter(Boolean).join('\n\n'),
        // The aggregate tool is the only state-submission schema exposed here.
        tools: [...request.tools],
        strictToolSet: true,
        rejectToolNames: [MVU_SUBMIT_UPDATE_TOOL_NAME, POSTURE_SUBMIT_TOOL_NAME,
          ...(extraTask?.tools || []).map(tool => tool.name)],
        maxToolCalls,
        toolLimitMessage: '本轮后台工具调用过多，请停止额外查询；变量更新仍不得跳过校验。',
        stopToolsWhen: () => terminalFailure || feedback?.ok === true && settlementSubmissionSeen
          && (!tasks.posture || posture !== null) && (!extraTask || extraTask.complete()),
        acceptWithoutText: () => terminalFailure || result !== null && (!tasks.posture || posture !== null) && (!extraTask || extraTask.complete()),
        temperature: 0.1, sessionId: input.sessionId, turn: Math.max(0, Number(input.turn) || 0), signal: input.signal,
        webSearchEnabled: input.webSearchEnabled === true,
        onToolCall(call) {
          const pending = toolTail.then(() => executeTool(call))
          toolTail = pending.catch(() => {})
          return pending
        }
      })
      traceSessionId = str(run.traceSessionId) || traceSessionId
      traceBoundary = Number.isSafeInteger(run.traceBoundary) ? run.traceBoundary : null
    } catch (error) {
      traceSessionId = str(error.traceSessionId) || traceSessionId
      await record('model-failed', { error: str(error.message || error) })
      // Never re-run the entire model task after a possible commit.
      if (!result || (error.cause?.code === 'BACKGROUND_MODEL_IDLE_TIMEOUT' && !['updated', 'unchanged'].includes(result.receipt?.status))) {
        error.traceSessionId = traceSessionId
        error.executionPolicy = executionPolicy
        throw error
      }
    }
    await toolTail
    if (!result) {
      const error = new Error(feedback?.error || '后台 Agent 未调用 settlement_submit')
      error.traceSessionId = traceSessionId
      error.traceBoundary = traceBoundary
      error.executionPolicy = executionPolicy
      error.mvuReceipt = {
        version: 1, status: 'error', summary: error.message, diagnosticId, changes: [],
        failures: Array.isArray(feedback?.failures) && feedback.failures.length ? feedback.failures : [{ message: error.message }],
        ...(feedback?.rejectedOperations ? { rejectedOperations: feedback.rejectedOperations } : {})
      }
      throw error
    }
    if (tasks.posture && posture === null) {
      const error = new Error('后台 Agent 未提交有效姿势')
      error.traceSessionId = traceSessionId
      error.traceBoundary = traceBoundary
      error.executionPolicy = executionPolicy
      throw error
    }
    if (extraTask && !extraTask.complete()) {
      const error = new Error('后台 Agent 尚未完成本局记忆更新')
      error.traceSessionId = traceSessionId
      error.traceBoundary = traceBoundary
      error.executionPolicy = executionPolicy
      throw error
    }
    await record('finished', { status: result.receipt.status })
    return {
      frame,
      text: str(run.text),
      posture: posture?.posture,
      traceSessionId,
      traceBoundary,
      ...result,
      executionPolicy
    }
  }

  return Object.freeze({ settleVariables, resumeVariables })
}
