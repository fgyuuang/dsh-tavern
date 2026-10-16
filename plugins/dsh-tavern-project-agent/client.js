window.__ModuleLoader__.load({ id: 'dsh-tavern-project-agent', factory: require => {
  const React = require('react'), h = React.createElement
  return { name: 'dsh-tavern-project-agent', inject: ['tavernUi', 'slots', 'sessions', 'workspaces', 'remote.agentPresets'], apply(ctx) {
    if (typeof ctx.tavernUi.registerSidebarWorkspace !== 'function') return
    const rpc = (method, args = {}) => ctx.tavernUi.callHost('dsh-tavern-project-agent/request', { method, args })
    let records = [], ids = [], info = null
    const listeners = new Set()
    const store = { getSnapshot: () => ids, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) } }
    function publish() { ids = ids.slice(); listeners.forEach(listener => listener()) }
    async function refresh() {
      const result = await rpc('list'); records = result.sessions || []; ids = records.map(row => row.sessionId)
      publish()
    }
    function ProjectAgentPanel(props) {
      React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
      const native = React.useSyncExternalStore(listener => ctx.sessions.list.subscribe(listener), () => ctx.sessions.list.getSnapshot(), () => ctx.sessions.list.getSnapshot())
      const [root, setRoot] = React.useState(info?.root || '')
      const [details, setDetails] = React.useState(info), [busy, setBusy] = React.useState(false), [error, setError] = React.useState(''), [query, setQuery] = React.useState('')
      const pending = React.useRef(null), guard = React.useRef(false), activation = React.useRef('')
      React.useEffect(() => {
        let active = true
        Promise.all([rpc('info'), refresh()]).then(([value]) => { info = value; if (active) { setDetails(value); setRoot(current => current || value.root); publish() } }).catch(failure => { if (active) setError(String(failure.message || failure)) })
        return () => { active = false }
      }, [])
      async function open(sessionId) { await ctx.sessions.refresh?.(); await ctx.sessions.open(sessionId); props.onOpen?.() }
      async function create() {
        if (guard.current || !root.trim()) return
        guard.current = true; setBusy(true); setError('')
        try {
          const signature = JSON.stringify([root.trim(), 'standard'])
          if (pending.current?.signature !== signature) {
            const workspace = await ctx.workspaces.create({ path: root.trim() })
            pending.current = { signature, sessionId: await ctx.sessions.create({ workspaceId: workspace.workspaceId }) }
          }
          const sessionId = pending.current.sessionId
          const selected = await ctx.remote.agentPresets.select(sessionId, 'standard')
          if (!selected.ok) throw Error(selected.error?.message || '原生模式选择失败')
          await rpc('register', { sessionId, presetId: 'standard' })
          await refresh(); await props.onSessionsChanged?.(); await open(sessionId); pending.current = null
        } catch (failure) { setError(String(failure.message || failure)) }
        finally { guard.current = false; setBusy(false) }
      }
      const visibleRecords = records.slice().reverse().filter(row => [native.byId?.[row.sessionId]?.title, row.title, row.path].some(value => String(value || '').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())))
      React.useEffect(() => {
        if (!details) return
        const sessionIds = store.getSnapshot()
        if (props.currentSessionId && sessionIds.includes(props.currentSessionId)) { activation.current = ''; return }
        const key = JSON.stringify([props.currentSessionId || '', sessionIds])
        if (activation.current === key || guard.current) return
        activation.current = key
        if (sessionIds.length) void open(sessionIds.at(-1)).catch(failure => setError(String(failure.message || failure)))
        else void create()
      }, [details, props.currentSessionId, native.current, native.byId?.[props.currentSessionId]?.blank])
      return h('section', { className: 'tavern-project-agent', 'aria-label': '项目 Agent' },
        h('button', { type: 'button', className: 'tavern-project-create', disabled: busy || !details || !root.trim(), onClick: create }, busy ? '正在建立…' : '新建 Agent 对话'),
        h('p', { className: 'tavern-project-hint' }, '模式在聊天输入框旁选择；发送第一条消息后固定为本局模式。'),
        h('details', { className: 'tavern-project-directory' },
          h('summary', { title: root }, '工作目录', h('span', null, root.split(/[\\/]/).filter(Boolean).at(-1) || '加载中…')),
          h('label', null, '项目目录', h('input', { value: root, disabled: busy, 'aria-label': 'Agent 项目目录', onChange: event => setRoot(event.target.value) })),
          h('p', null, '默认目录提供项目说明、持久记忆和 Skills。也可以填写已有项目的目录。')),
        error ? h('p', { className: 'tavern-project-error', role: 'alert' }, error) : null,
        h('div', { className: 'tavern-project-list-heading' }, h('h3', null, '项目对话'), h('span', null, records.length || '')),
        records.length > 0 ? h('input', { type: 'search', className: 'tavern-project-search', placeholder: '搜索对话', 'aria-label': '搜索 Agent 对话', value: query, onChange: event => setQuery(event.target.value) }) : null,
        h('div', { className: 'tavern-project-sessions' },
          ...visibleRecords.map(row => h('button', { key: row.sessionId, className: 'tavern-project-session', title: (details?.modes?.find(mode => mode.id === row.nativePresetId)?.name || row.nativePresetId) + ' · ' + row.path, type: 'button', 'aria-current': props.currentSessionId === row.sessionId ? 'page' : undefined, disabled: busy, onClick: () => { void open(row.sessionId).catch(failure => setError(String(failure.message || failure))) } }, h('span', null, native.byId?.[row.sessionId]?.title || row.title))),
          !records.length ? h('p', { className: 'tavern-project-empty' }, '在这里维护项目资源和 Agent 对话。模式在聊天输入框旁选择。') : !visibleRecords.length ? h('p', { className: 'tavern-project-empty', role: 'status' }, '没有匹配的对话') : null))
    }
    function ProjectAgentComposerMode() {
      const snapshot = React.useSyncExternalStore(listener => ctx.sessions.list.subscribe(listener), () => ctx.sessions.list.getSnapshot(), () => ctx.sessions.list.getSnapshot())
      const sessionId = snapshot.current
      const session = sessionId ? snapshot.byId?.[sessionId] : null
      const record = records.find(row => row.sessionId === sessionId)
      const [busy, setBusy] = React.useState(false), [error, setError] = React.useState(''), [pendingMode, setPendingMode] = React.useState('')
      if (!record || ctx.sessions.subagentAddress?.(sessionId)) return null
      const selectedId = pendingMode || record.nativePresetId
      const selectedMode = info?.modes?.find(row => row.id === selectedId)
      async function change(event) {
        const presetId = event.target.value
        if (busy || session?.blank !== true) return
        setBusy(true); setError(''); setPendingMode(presetId)
        try {
          const result = await ctx.remote.agentPresets.select(sessionId, presetId)
          if (!result.ok) throw Error(result.error?.message || '模式切换失败')
          await rpc('register', { sessionId, presetId })
          await refresh(); setPendingMode('')
        } catch (failure) { setPendingMode(''); setError(String(failure.message || failure)) }
        finally { setBusy(false) }
      }
      return h('label', { className: 'tavern-agent-composer-mode', title: error || (session?.blank === true ? '首条消息发送前可以切换' : '会话开始后模式固定') },
        h('span', { 'aria-hidden': true }, 'Agent'),
        session?.blank === true
          ? h('select', { 'aria-label': 'Agent 模式', value: selectedId, disabled: busy || !info?.modes?.length, onChange: change }, ...(info?.modes || []).map(row => h('option', { key: row.id, value: row.id }, row.name)))
          : h('span', { className: 'tavern-agent-composer-locked', 'aria-label': 'Agent 模式已锁定' }, selectedMode?.name || selectedId),
        error ? h('span', { className: 'tavern-agent-composer-error', role: 'alert' }, error) : null)
    }
    ctx.tavernUi.registerSidebarWorkspace({ id: 'agent', label: 'Agent', sessions: store, component: ProjectAgentPanel })
    ctx.effect(() => { const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = ctx.tavernUi.assetUrl('workspace.css'); document.head.append(link); return () => link.remove() }, 'project Agent styles')
    ctx.effect(() => ctx.slots.inject('conversation.input.right', () => ctx.slots.register({ name: 'conversation.input.right', id: 'dsh-tavern-project-agent-mode', order: 70, label: 'Agent mode' }, () => React.createElement(ProjectAgentComposerMode))), 'project Agent composer mode')
    void refresh().catch(() => {})
  } }
} })
