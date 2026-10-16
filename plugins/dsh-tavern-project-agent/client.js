window.__ModuleLoader__.load({ id: 'dsh-tavern-project-agent', factory: require => {
  const React = require('react'), h = React.createElement
  return { name: 'dsh-tavern-project-agent', inject: ['tavernUi', 'sessions', 'workspaces', 'remote.agentPresets'], apply(ctx) {
    if (typeof ctx.tavernUi.registerSidebarWorkspace !== 'function') return
    const rpc = (method, args = {}) => ctx.tavernUi.callHost('dsh-tavern-project-agent/request', { method, args })
    let records = [], ids = [], info = null
    const listeners = new Set()
    const store = { getSnapshot: () => ids, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) } }
    async function refresh() {
      const result = await rpc('list'); records = result.sessions || []; ids = records.map(row => row.sessionId)
      listeners.forEach(listener => listener())
    }
    function ProjectAgentPanel(props) {
      React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
      const native = React.useSyncExternalStore(listener => ctx.sessions.list.subscribe(listener), () => ctx.sessions.list.getSnapshot(), () => ctx.sessions.list.getSnapshot())
      const [mode, setMode] = React.useState('standard'), [root, setRoot] = React.useState(info?.root || '')
      const [details, setDetails] = React.useState(info), [busy, setBusy] = React.useState(false), [error, setError] = React.useState(''), [query, setQuery] = React.useState('')
      const pending = React.useRef(null), guard = React.useRef(false)
      React.useEffect(() => {
        let active = true
        Promise.all([rpc('info'), refresh()]).then(([value]) => { info = value; if (active) { setDetails(value); setRoot(current => current || value.root) } }).catch(failure => { if (active) setError(String(failure.message || failure)) })
        return () => { active = false }
      }, [])
      async function open(sessionId) { await ctx.sessions.refresh?.(); await ctx.sessions.open(sessionId); props.onOpen?.() }
      async function create() {
        if (guard.current || !root.trim()) return
        guard.current = true; setBusy(true); setError('')
        try {
          const signature = JSON.stringify([root.trim(), mode])
          if (pending.current?.signature !== signature) {
            const workspace = await ctx.workspaces.create({ path: root.trim() })
            pending.current = { signature, sessionId: await ctx.sessions.create({ workspaceId: workspace.workspaceId }) }
          }
          const sessionId = pending.current.sessionId
          const selected = await ctx.remote.agentPresets.select(sessionId, mode)
          if (!selected.ok) throw Error(selected.error?.message || '原生模式选择失败')
          await rpc('register', { sessionId, presetId: mode })
          await refresh(); await props.onSessionsChanged?.(); await open(sessionId); pending.current = null
        } catch (failure) { setError(String(failure.message || failure)) }
        finally { guard.current = false; setBusy(false) }
      }
      const selectedMode = details?.modes?.find(row => row.id === mode)
      const visibleRecords = records.slice().reverse().filter(row => [native.byId?.[row.sessionId]?.title, row.title, row.path].some(value => String(value || '').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())))
      return h('section', { className: 'tavern-project-agent', 'aria-label': '项目 Agent' },
        h('button', { type: 'button', className: 'tavern-project-create', disabled: busy || !details || !root.trim(), onClick: create }, busy ? '正在建立…' : '新建 Agent 对话'),
        h('div', { className: 'tavern-project-context' },
          h('label', { className: 'tavern-project-mode', title: selectedMode?.description },
            h('span', null, '模式'),
            h('select', { value: mode, disabled: busy || !details, 'aria-label': '新对话的原生模式', onChange: event => setMode(event.target.value) }, ...(details?.modes || []).map(row => h('option', { key: row.id, value: row.id }, row.name))))),
        h('details', { className: 'tavern-project-directory' },
          h('summary', { title: root }, '工作目录', h('span', null, root.split(/[\\/]/).filter(Boolean).at(-1) || '加载中…')),
          h('label', null, '项目目录', h('input', { value: root, disabled: busy, 'aria-label': 'Agent 项目目录', onChange: event => setRoot(event.target.value) })),
          h('p', null, '默认目录提供项目说明、持久记忆和 Skills。也可以填写已有项目的目录。'),
          h('p', null, selectedMode?.description)),
        error ? h('p', { className: 'tavern-project-error', role: 'alert' }, error) : null,
        h('div', { className: 'tavern-project-list-heading' }, h('h3', null, '项目对话'), h('span', null, records.length || '')),
        records.length > 0 ? h('input', { type: 'search', className: 'tavern-project-search', placeholder: '搜索对话', 'aria-label': '搜索 Agent 对话', value: query, onChange: event => setQuery(event.target.value) }) : null,
        h('div', { className: 'tavern-project-sessions' },
          ...visibleRecords.map(row => h('button', { key: row.sessionId, className: 'tavern-project-session', title: (details?.modes?.find(mode => mode.id === row.nativePresetId)?.name || row.nativePresetId) + ' · ' + row.path, type: 'button', 'aria-current': props.currentSessionId === row.sessionId ? 'page' : undefined, disabled: busy, onClick: () => { void open(row.sessionId).catch(failure => setError(String(failure.message || failure))) } }, h('span', null, native.byId?.[row.sessionId]?.title || row.title))),
          !records.length ? h('p', { className: 'tavern-project-empty' }, '在这里设计预设、维护资源和调试插件。选择模式后即可开始。') : !visibleRecords.length ? h('p', { className: 'tavern-project-empty', role: 'status' }, '没有匹配的对话') : null))
    }
    ctx.tavernUi.registerSidebarWorkspace({ id: 'agent', label: 'Agent', sessions: store, component: ProjectAgentPanel })
    ctx.effect(() => { const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = ctx.tavernUi.assetUrl('workspace.css'); document.head.append(link); return () => link.remove() }, 'project Agent styles')
    void refresh().catch(() => {})
  } }
} })
