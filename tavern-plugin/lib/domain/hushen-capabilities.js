import { parse } from 'acorn'
import { createHash } from 'node:crypto'

// Parse the author's exported helper as source text. No function, getter, call,
// template expression or module import from that source is ever executed.
const cache = new WeakMap()
const contentCache = new Map()
const hash = text => createHash('sha256').update(text).digest('hex')
const blocked = new Set(['__proto__', 'prototype', 'constructor'])
const names = Object.freeze({
  fox_outline: '狐构', fox_memory: '狐忆', fox_beat_bad: '长期拷打记录',
  fox_beat_good: '长期成功经验记录', fox_search: '狐搜', full_summary: '大总结',
  fox_image_comm: '狐映', fox_judge: '狐裁', fox_hushen: '狐析',
  parallel_world: '平行世界', fox_time: '狐刻'
})

function literal(node, budget = { remaining: 20000 }, depth = 0) {
  if (!node || depth > 40 || --budget.remaining < 0) throw new Error('静态数据超出限制')
  if (node.type === 'Literal' && !node.regex && !node.bigint
    && (node.value === null || ['string', 'number', 'boolean'].includes(typeof node.value))) return node.value
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked
  if (node.type === 'UnaryExpression' && ['-', '+'].includes(node.operator) && node.argument.type === 'Literal'
    && typeof node.argument.value === 'number') return node.operator === '-' ? -node.argument.value : node.argument.value
  if (node.type === 'ArrayExpression') return node.elements.map(item => literal(item, budget, depth + 1))
  if (node.type === 'ObjectExpression') {
    const value = Object.create(null)
    for (const item of node.properties) {
      if (item.type !== 'Property' || item.computed || item.method || item.kind !== 'init') throw new Error('包含可执行属性')
      const key = item.key.type === 'Identifier' ? item.key.name : literal(item.key, budget, depth + 1)
      if (typeof key !== 'string' || blocked.has(key) || Object.hasOwn(value, key)) throw new Error('静态属性名无效或重复')
      value[key] = literal(item.value, budget, depth + 1)
    }
    return value
  }
  throw new Error('不是静态字面量：' + node.type)
}
function property(node, name) {
  return node?.type === 'ObjectExpression' && node.properties.find(item => item.type === 'Property' && !item.computed
    && (item.key.name === name || item.key.value === name))?.value
}
function sourceDocument(snapshot) {
  const document = snapshot?.compatibilityPresetDocument
  return document?.preset || document
}
function helperOf(snapshot) {
  const scripts = sourceDocument(snapshot)?.extensions?.tavern_helper?.scripts
  return (Array.isArray(scripts) ? scripts : []).find(script =>
    script?.type === 'script' && typeof script.content === 'string'
      && script.content.includes('xhRegisterPromptDefault') && script.content.includes('SELECT_GROUPS'))
}
function read(script) {
  if (!script) return { recognized: false, registry: null, promptRegistrations: [], diagnostics: [] }
  const cached = cache.get(script)
  if (cached?.content === script.content) return cached.value
  const value = { recognized: true, scriptId: String(script.id || ''), scriptName: String(script.name || ''),
    scriptEnabled: script.enabled !== false && script.disabled !== true, sourceHash: hash(script.content),
    registry: null, promptRegistrations: [], diagnostics: [] }
  if (script.content.length > 8000000) {
    value.diagnostics.push('玄狐脚本过大，未静态解析；原文保留。')
    return value
  }
  // RPC snapshots are reloaded JSON objects, so a WeakMap alone would parse the
  // same large bundle repeatedly. Keep at most three pure-data parse results.
  const saved = contentCache.get(value.sourceHash)
  if (saved) {
    contentCache.delete(value.sourceHash); contentCache.set(value.sourceHash, saved)
    const result = { ...saved, scriptId: value.scriptId, scriptName: value.scriptName, scriptEnabled: value.scriptEnabled }
    cache.set(script, { content: script.content, value: result })
    return result
  }
  try {
    const tree = parse(script.content, { ecmaVersion: 'latest', sourceType: 'script', locations: true })
    const pending = [tree], registrations = new Map()
    while (pending.length) {
      const node = pending.pop()
      if (!node || typeof node !== 'object') continue
      if (node.type === 'ObjectExpression' && property(node, 'SELECT_GROUPS') && property(node, 'QUICK_TOGGLE_IDS')) {
        try { value.registry = literal(node) } catch (error) { value.diagnostics.push('作者设置注册表：' + error.message) }
      }
      if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'xhRegisterPromptDefault'
        && node.arguments[0]?.type === 'Literal' && typeof node.arguments[0].value === 'string') {
        const id = node.arguments[0].value, record = { id, sourceLine: node.loc.start.line,
          sourceExpression: script.content.slice(node.arguments[1]?.start || node.start, node.arguments[1]?.end || node.end),
          prompt: {}, dynamicSlots: [] }
        const data = node.arguments[1]
        if (data?.type === 'ObjectExpression') for (const item of data.properties) {
          const key = item.key?.name || item.key?.value
          if (!['head', 'middle', 'tail', 'jailbreak'].includes(key)) continue
          try {
            const text = literal(item.value)
            if (typeof text !== 'string') throw new Error('提示词不是字符串')
            record.prompt[key] = text
          } catch {
            record.dynamicSlots.push({ slot: key, sourceLine: item.loc.start.line,
              expression: script.content.slice(item.value.start, item.value.end) })
          }
        }
        else record.dynamicSlots.push({ slot: '*', sourceLine: node.loc.start.line, expression: record.sourceExpression })
        const previous = registrations.get(id)
        // Registration merges only previously absent keys, so the first value
        // for a slot wins. Preserve all occurrences for a reviewable inventory.
        if (!previous) registrations.set(id, { ...record, prompt: { ...record.prompt }, dynamicSlots: record.dynamicSlots.slice(), occurrences: [record] })
        else {
          for (const [key, text] of Object.entries(record.prompt)) if (!Object.hasOwn(previous.prompt, key)) previous.prompt[key] = text
          previous.dynamicSlots.push(...record.dynamicSlots)
          previous.occurrences.push(record)
        }
      }
      for (const child of Object.values(node)) {
        if (Array.isArray(child)) {
          for (let index = child.length - 1; index >= 0; index--) if (child[index]?.type) pending.push(child[index])
        } else if (child?.type) pending.push(child)
      }
    }
    value.promptRegistrations = [...registrations.values()]
    if (!value.registry) value.diagnostics.push('未找到可可靠读取的作者设置注册表；未执行脚本兜底。')
  } catch (error) { value.diagnostics.push('玄狐脚本静态解析失败：' + error.message) }
  cache.set(script, { content: script.content, value })
  contentCache.set(value.sourceHash, value)
  while (contentCache.size > 3) contentCache.delete(contentCache.keys().next().value)
  return value
}

/** Pure metadata extraction. Exported SPresetSettings is dormant extension
 * configuration, while the actual selector registry lives in the helper. */
export function readHushenStaticMetadata(snapshot) {
  const result = read(helperOf(snapshot)), source = sourceDocument(snapshot)
  let extensionConfig = source?.extensions?.SPreset || null
  if (!extensionConfig) {
    const entry = source?.prompts?.find(item => item?.identifier === 'SPresetSettings')
    try { if (typeof entry?.content === 'string') extensionConfig = JSON.parse(entry.content) } catch {}
  }
  return { ...result, extensionConfig }
}

/** These are the author's registered prompt slots, not a claim that the old
 * 83k-line controller or its generated databases have been ported. */
export function readHushenCapabilities(snapshot, options = {}) {
  const metadata = readHushenStaticMetadata(snapshot)
  const capability = (id, name, status, label, reason) => ({ id, name, enabled: null,
    compatibility: { status, label, reason } })
  const nativeCapabilities = metadata.recognized ? [
    capability('author-stages', '作者阶段原文', 'supported', '已接入原生草稿流程',
      '按来源 ID 读取作者原文，保留规划、写作和审阅阶段；实际文风效果仍需实卡验收。'),
    capability('source-settings', '作者预设设置', 'supported', '已接入本局设置',
      '保留静态分组、互斥、关闭和自定义原文；特殊模块联动单独列示，保存不代表全部控制器已启动。'),
    capability('fox-body', '狐狸正文协议', 'adapted', '已接入原生正文草稿',
      '正文通过原生草稿与提交流程处理；不运行原助手整包，不复制多个监听器改写同一条正式消息。'),
    capability('fox-memory', '狐忆与数据库', 'partial', '原生分支文档替代',
      '可使用 DSH 的分支记忆与文档；旧狐忆 IndexedDB、表格和向量缓存尚未导入，原检索参数与分析策略未完整迁移。'),
    capability('fox-judge', '狐裁', 'partial', '原文规划与审阅替代',
      '作者规划和检查原文用于原生草稿流程；原两阶段模型、静态指纹缓存、重试与失败降级策略尚未迁移。'),
    capability('parallel-world', '平行世界', 'unsupported', '原高级控制器待迁移',
      '世界模块、独立推进、骰子、图谱、分支快照与紧急事件注入尚未迁移；原提示词槽提取不代表世界已经更新。'),
    capability('fox-time', '狐刻', 'partial', '时间标记校验；高级控制器待迁移',
      '原时间地点文档可显示，ft_clock 数值有本地检查；KV、阶段、触发节点、自动推进和时间轴界面尚未接入。'),
    capability('fox-image', '狐映、手机与前端', 'partial', '载体文本展示；高级控制器待迁移',
      '狐映需求和狐构大纲有本地折叠文本展示，不额外调用模型；手机、社交日志、素材生成与原动态前端控制器尚未迁移。'),
    capability('original-workbench', '原助手悬浮工作台', 'unsupported', '宿主交互待迁移',
      '原桌宠、悬浮窗、三维图谱、文件夹存储和私有 DOM 拦截没有作为 Agent 控制器启动。'),
    capability('summary-search-outline', '原总结、狐搜与狐构高级策略', 'partial', '原文与原生工具分开接入',
      '原生上下文压缩、检索和文档可用；原压楼、搜索筛选链、大纲候选管理与自动间隔策略尚未完整迁移。')
  ] : []
  const modules = metadata.promptRegistrations.map(registration => ({
      id: registration.id, name: names[registration.id] || registration.id,
      prompt: { ...registration.prompt }, enabled: false, configured: null,
      compatibility: { status: registration.dynamicSlots.length ? 'unsupported' : 'partial',
        label: registration.dynamicSlots.length ? '动态提示词待接入' : '原文槽已提取；模块执行待接入',
        reason: registration.dynamicSlots.length
          ? '包含运行时参数或变量，保留原始表达式并拒绝求值；不能将静态片段作为完整能力启动。'
          : '保留原作者注册的提示词槽；模块主提示词、动态材料、持久数据与事务执行另行接入。默认未启用，不能声称已经运行。' },
      dynamicSlots: registration.dynamicSlots, source: { scriptId: metadata.scriptId,
        scriptHash: metadata.sourceHash, line: registration.sourceLine, expression: registration.sourceExpression,
        occurrences: registration.occurrences.map(item => ({ line: item.sourceLine, expression: item.sourceExpression })) }
    }))
  return { recognized: metadata.recognized, sourceHash: metadata.sourceHash || '', diagnostics: metadata.diagnostics.slice(),
    nativeCapabilities, modules: options.manifestOnly === true ? modules.map(module => ({
      id: module.id, name: module.name, enabled: module.enabled, configured: module.configured,
      compatibility: module.compatibility, promptSlots: Object.keys(module.prompt),
      promptCharacters: Object.values(module.prompt).reduce((count, text) => count + text.length, 0),
      dynamicSlots: module.dynamicSlots.map(slot => ({ slot: slot.slot, sourceLine: slot.sourceLine })),
      source: { scriptId: module.source.scriptId, scriptHash: module.source.scriptHash, line: module.source.line }
    })) : modules }
}
