import { normalizeBackgroundModel, resolveChatBackgroundModel } from './background-model-selection.js'

const defaults = ['defaultForegroundModel', 'defaultBackgroundModel', 'defaultWorkbenchModel', 'defaultImageModel']
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)

/** Coordinate the native foreground selection with the game's background route. */
export function createConversationModelSettings({ read, update, selection, select, catalog, resolve, isBusy,
  readSettings, updateSettings, publish = () => {} }) {
  const saving = new Set()
  function idle(chat) {
    if (isBusy(chat)) throw new Error('请等待前后台任务完成后再调整模型')
  }
  function present(chat, settings, modelCatalog) {
    const foregroundModel = normalizeBackgroundModel(selection(chat.sessionId))
    const backgroundModel = normalizeBackgroundModel(chat.backgroundModelSelection)
    return { foregroundModel, backgroundModel, imageModel: normalizeBackgroundModel(chat.imageModelSelection),
      effectiveBackgroundModel: resolveChatBackgroundModel(chat, foregroundModel), busy: isBusy(chat),
      defaults: Object.fromEntries(defaults.map(name => [name, settings[name] || null])), modelCatalog }
  }
  async function get(sessionId) {
    const chat = await read(sessionId)
    if (!chat) throw new Error('请先打开游玩会话')
    return present(chat, await readSettings(), await catalog())
  }
  async function apply(sessionId, input = {}) {
    if (saving.has(sessionId)) throw new Error('模型设置正在保存，请稍候')
    saving.add(sessionId)
    try {
      if (input.scope && !['conversation', 'new-games'].includes(input.scope)) throw new Error('模型设置范围无效')
      const patch = input.models || {}, names = input.scope === 'new-games' ? defaults : ['foregroundModel', 'backgroundModel', 'imageModel']
      if (!Object.keys(patch).length || Object.keys(patch).some(name => !names.includes(name))) throw new Error('模型设置项无效')
      const routes = await catalog(), resolved = {}
      for (const name of Object.keys(patch)) {
        const route = normalizeBackgroundModel(patch[name])
        if (patch[name] !== null && !route || name === 'foregroundModel' && !route) throw new Error('前台或后台模型配置无效')
        if (route) {
          if (!routes.some(group => group.provider === route.provider && group.models.some(model => model.id === route.model))) throw new Error('所选模型不可用')
          resolved[name] = normalizeBackgroundModel(await resolve(route))
        } else resolved[name] = null
      }
      const before = await read(sessionId)
      if (!before) throw new Error('请先打开游玩会话')
      if (input.scope === 'new-games') return present(before, await updateSettings(resolved), routes)
      const settings = await readSettings()
      idle(before)
      const oldForeground = normalizeBackgroundModel(selection(sessionId))
      const changeFront = Object.hasOwn(resolved, 'foregroundModel') && !same(oldForeground, resolved.foregroundModel)
      if (changeFront && !oldForeground) throw new Error('无法读取原前台模型，请先在原生模型选择器选择模型')
      let selected = false, saved = before
      try {
        if (changeFront) { selected = true; await select(sessionId, resolved.foregroundModel) }
        if (Object.hasOwn(resolved, 'backgroundModel') || Object.hasOwn(resolved, 'imageModel')) saved = await update(before.id, current => {
          idle(current)
          if (current._storageRevision !== before._storageRevision) throw new Error('本局设置已变化，请刷新后重试')
          return { ...current, backgroundConfigVersion: 1,
            ...(Object.hasOwn(resolved, 'backgroundModel') ? { backgroundModelSelection: resolved.backgroundModel } : {}),
            ...(Object.hasOwn(resolved, 'imageModel') ? { imageModelSelection: resolved.imageModel } : {}) }
        })
      } catch (error) {
        if (selected) {
          try { await select(sessionId, oldForeground) }
          catch (rollback) { throw new Error('模型保存失败，恢复前台配置也失败：' + String(rollback?.message || rollback), { cause: error }) }
        }
        throw error
      }
      publish(sessionId)
      return present(saved, settings, routes)
    } finally { saving.delete(sessionId) }
  }
  return Object.freeze({ get, apply })
}
