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
      const [details, setDetails] = React.useState(info), [busy, setBusy] = React.useState(false), [error, setError] = React.useState('')
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
      return h('section', { className: 'tavern-project-agent', 'aria-label': '项目 Agent' },
        h('header', null, h('small', null, 'DSH 原生工作区'), h('h2', null, '项目 Agent'), h('p', null, '设计预设、维护资源、修改与调试。')),
        h('div', { className: 'tavern-project-modes', role: 'group', 'aria-label': '新对话的原生模式' }, ...(details?.modes || []).map(row => h('button', { key: row.id, type: 'button', disabled: busy, 'aria-pressed': mode === row.id, title: row.description, onClick: () => setMode(row.id) }, row.name))),
        h('p', { className: 'tavern-project-mode-note' }, details?.modes?.find(row => row.id === mode)?.description),
        h('details', null, h('summary', null, '工作目录与持久记忆'), h('label', null, '项目目录', h('input', { value: root, disabled: busy, 'aria-label': 'Agent 项目目录', onChange: event => setRoot(event.target.value) })), h('p', null, '默认工作区含 PROJECT.md、memory/ 与按需 Skills。也可选择已有项目；文件与记忆会跨对话保留。')),
        h('button', { type: 'button', className: 'dsh-tavern-btn tavern-project-create', disabled: busy || !details || !root.trim(), onClick: create }, busy ? '正在建立…' : '＋ 新建 Agent 对话'),
        error ? h('p', { role: 'alert' }, error) : null,
        h('h3', null, '项目对话'),
        ...records.slice().reverse().map(row => h('button', { key: row.sessionId, className: 'tavern-project-session', type: 'button', 'aria-current': props.currentSessionId === row.sessionId ? 'page' : undefined, disabled: busy, onClick: () => { void open(row.sessionId).catch(failure => setError(String(failure.message || failure))) } }, h('strong', null, native.byId?.[row.sessionId]?.title || row.title), h('small', null, row.nativePresetId + ' · ' + row.path.split(/[\\/]/).at(-1)))),
        !records.length ? h('p', { className: 'tavern-project-mode-note' }, '选择模式后新建对话。模式从创建时生效。') : null)
    }
    ctx.tavernUi.registerSidebarWorkspace({ id: 'agent', label: 'Agent', sessions: store, component: ProjectAgentPanel })
    ctx.effect(() => { const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = ctx.tavernUi.assetUrl('workspace.css'); document.head.append(link); return () => link.remove() }, 'project Agent styles')
    void refresh().catch(() => {})
  } }
} })
