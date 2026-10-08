export const GAME_MEMORY_READ_TOOL = Object.freeze({
  name: 'tavern_memory',
  description: '按需列出、读取或搜索本局当前分支的持久记忆文档。Markdown 保存场景、人物所知和未完成线索；JSON/CSV 保存辅助表格。文档是剧情记忆，变量仍以变量工具的当前状态为准。长文按 nextOffset 续读。',
  parameters: {
    type: 'object', additionalProperties: false,
    properties: {
      action: { type: 'string', enum: ['list', 'read', 'search'] },
      path: { type: 'string' }, query: { type: 'string' },
      offset: { type: 'integer' }, limit: { type: 'integer' }
    }
  }
})

export const GAME_MEMORY_SUBMIT_TOOL = Object.freeze({
  name: 'tavern_memory_submit',
  description: '根据本轮已提交正文更新本局记忆文件。先读取需要修改的旧文档，再提交完整的新文档内容。可自行组织 memory/、characters/、tables/ 下的 Markdown、JSON、CSV、TXT 文档；保留事件出处和人物信息差。不得修改核心人物设定、世界规则、MVU 派生字段，或记录尚未发生的事件。没有值得记录的变化时提交空 writes/deletes。成功后不重复提交；暂存版本将在本轮后台结算成功时统一生效。',
  parameters: {
    type: 'object', additionalProperties: false,
    properties: {
      writes: { type: 'array', items: { type: 'object', additionalProperties: false,
        properties: { path: { type: 'string' }, text: { type: 'string' } }, required: ['path', 'text'] } },
      deletes: { type: 'array', items: { type: 'string' } }
    }, required: ['writes', 'deletes']
  }
})

export function gameMemoryEnabled(chat) {
  return chat?.playPresetId === 'dream-sike-dsh' && ['story', 'script'].includes(chat.mode || 'story')
}

export async function readGameMemory(workspace, chat, args = {}) {
  if (!chat || !['story', 'script'].includes(chat.mode || 'story')) throw new Error('请先打开游玩会话')
  const { action = 'list', path, query, offset, limit } = args
  if (action === 'list') return workspace.list(chat, { prefix: path, offset, limit })
  if (action === 'read') return workspace.read(chat, path, { offset, limit })
  if (action === 'search') return workspace.search(chat, query, { limit })
  throw new Error('未知的记忆读取操作')
}

/** Stage memory behind the resident settlement Agent; promote it in its existing CAS commit. */
export async function createGameMemoryTask({ workspace, chat, taskRun }) {
  if (!gameMemoryEnabled(chat)) return null
  const operation = chat.timeline?.operations?.[taskRun.operationId]
  const bodyId = operation?.roundOperationId || Object.values(chat.timeline?.operations || {})
    .filter(item => item?.kind === 'body' && item.status === 'completed' && item.committedBranchId === taskRun.basedOn.branchId)
    .sort((a, b) => b.committedRevision - a.committedRevision)[0]?.id
  const body = chat.timeline?.operations?.[bodyId]
  if (!body || body.kind !== 'body' || body.status !== 'completed') return null
  const alreadyApplied = Boolean(body.memoryReceipt && body.memoryReceipt.head === chat.gameMemory?.head
    && body.memoryReceipt.revision === body.committedRevision && body.memoryReceipt.branchId === body.committedBranchId)
  let prepared = body.memoryPrepared || null
  if (prepared && (prepared.receipt?.branchId !== taskRun.basedOn.branchId || prepared.receipt?.revision !== taskRun.basedOn.revision
    || prepared.receipt?.expectedHead !== (chat.gameMemory?.head || null))) prepared = null
  if (prepared) await workspace.validatePrepared(chat, prepared)
  const listing = await workspace.list(chat, { limit: 20 })
  return {
    tools: [GAME_MEMORY_SUBMIT_TOOL],
    system: [
      '【本局持久记忆】',
      '你负责根据本轮已确认正文维护本局文档。按需使用 tavern_memory 读取与搜索，必须在提交变量或姿势之前调用 tavern_memory_submit；没有变化时提交空数组。',
      '优先维护 memory/current-scene.md、memory/open-threads.md 与需要变化的人物记忆；章节记忆保留回合出处。记忆只描述已发生事实，人物所知分别记录。核心设定修改须有玩家明确要求。',
      '后续压缩与新分支会从这些文档恢复；不要复制整段聊天或重复保存 MVU 数值。',
      JSON.stringify(listing),
      alreadyApplied ? '本轮记忆已经保存，可直接完成其余结算，无需重复更新文档。' : prepared ? '本轮记忆已暂存，可直接完成其余结算。' : ''
    ].filter(Boolean).join('\n'),
    complete: () => alreadyApplied || prepared !== null,
    async execute(call) {
      if (call?.name !== GAME_MEMORY_SUBMIT_TOOL.name) return JSON.stringify({ ok: false, error: '未知记忆工具' })
      if (alreadyApplied) return JSON.stringify({ ok: true, alreadyApplied: true, head: chat.gameMemory.head })
      if (prepared) return JSON.stringify({ ok: true, alreadyPrepared: true, head: prepared.head })
      try {
        const writes = call.arguments?.writes, deletes = call.arguments?.deletes
        if (!Array.isArray(writes) || !Array.isArray(deletes)) throw new Error('请提交 writes 和 deletes 数组')
        for (const item of [...writes.map(write => write.path), ...deletes]) {
          if (typeof item !== 'string' || !/^(memory|characters|tables)\//.test(item)) throw new Error('记忆文档须位于 memory/、characters/ 或 tables/ 下')
        }
        const next = await workspace.prepare(chat, { operationId: bodyId, writes, deletes, expectedHead: chat.gameMemory?.head || null })
        await taskRun.checkpoint(latest => {
          const latestBody = latest.timeline?.operations?.[bodyId]
          if (!latestBody || latestBody.status !== 'completed' || latestBody.committedBranchId !== taskRun.basedOn.branchId) throw new Error('记忆目标已过期')
          latestBody.memoryPrepared = next
        }, { headerOnly: true })
        prepared = next
        return JSON.stringify({ ok: true, staged: true, head: next.head })
      } catch (error) { return JSON.stringify({ ok: false, retryable: true, error: error.message }) }
    },
    apply(draft) {
      if (alreadyApplied) {
        if (draft.gameMemory?.head !== chat.gameMemory?.head) throw new Error('记忆版本已变化')
        return
      }
      if (!prepared) throw new Error('后台尚未提交记忆更新')
      workspace.apply(draft, prepared, { operationId: bodyId, branchId: taskRun.basedOn.branchId, revision: taskRun.basedOn.revision })
      delete draft.timeline.operations[bodyId].memoryPrepared
    }
  }
}
