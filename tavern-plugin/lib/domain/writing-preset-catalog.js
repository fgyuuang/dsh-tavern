const ids = new Set(['dream-sike-dsh', 'hushen-dsh'])

/** Plugins own availability and UI identity; the host owns durable story commits. */
export function createWritingPresetCatalog() {
  const providers = new Map()
  return Object.freeze({
    register({ id, name, description, owner }) {
      if (!ids.has(id) || typeof name !== 'string' || !name.trim() || typeof owner !== 'string' || !owner) throw new TypeError('无效的写作预设插件描述')
      if (providers.has(id)) throw new Error('写作预设已有插件注册：' + id)
      const row = Object.freeze({ id, name: name.trim().slice(0, 80), description: String(description || '').slice(0, 500), owner })
      providers.set(id, row)
      return () => { if (providers.get(id) === row) providers.delete(id) }
    },
    list: () => [...providers.values()],
    assertAvailable(id) {
      if (id !== 'tavern' && !providers.has(id)) throw new Error('此写作 Agent 预设插件未启用；请启用对应插件，或选择 DSH 原版。现有局的资料与设置仍保留。')
    },
  })
}
