window.__ModuleLoader__.load({ id: 'dsh-tavern-project-agent', factory: require => {
  const React = require('react'), ReactDom = require('react-dom'), h = React.createElement
  return { name: 'dsh-tavern-project-agent', inject: ['tavernUi', 'slots', 'sessions', 'workspaces', 'remote', 'remote.agentPresets'], async apply(ctx) {
    if (typeof ctx.tavernUi.registerSidebarWorkspace !== 'function') return
    const rpc = (method, args = {}) => ctx.tavernUi.callHost('dsh-tavern-project-agent/request', { method, args })
    // Native desktop can disable ordinary HTTP asset access. Use the same
    // authorized host transport as plugin data, and mount only after CSS arrives.
    const { css } = await rpc('stylesheet')
    if (typeof css !== 'string' || !css.trim()) throw new Error('Agent 工作区样式未能加载')
    ctx.effect(() => { const style = document.createElement('style'); style.dataset.tavernProjectAgent = ''; style.textContent = css; document.head.append(style); return () => style.remove() }, 'project Agent styles')
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
      const pending = React.useRef(null), guard = React.useRef(false)
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
      const projectName = root.split(/[\\/]/).filter(Boolean).at(-1) || '加载中…'
      return h('section', { className: 'dsh-tavern-project-agent', 'aria-label': '项目 Agent', style: { flex: '1 1 auto', minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 } },
        h('button', { type: 'button', className: 'dsh-tavern-side-new', disabled: busy || !details || !root.trim(), onClick: create }, busy ? '正在建立…' : '＋ 新建 Agent 对话'),
        h('details', { className: 'dsh-tavern-project-directory' },
          h('summary', { title: root }, h('span', null, '工作目录'), h('span', { className: 'dsh-tavern-project-directory-name' }, projectName)),
          h('label', null, '项目目录', h('input', { value: root, disabled: busy, 'aria-label': 'Agent 项目目录', onChange: event => setRoot(event.target.value) })),
          h('p', null, '此目录保存项目说明、记忆和 Skills；也可以指定已有项目目录。')),
        error ? h('div', { className: 'dsh-tavern-picker-error', role: 'alert' }, error) : null,
        h('div', { className: 'dsh-tavern-side-title dsh-tavern-history-heading' }, h('span', null, '项目对话'), records.length ? h('span', null, String(records.length)) : null),
        records.length > 0 ? h('input', { type: 'search', className: 'tavern-project-search', placeholder: '搜索对话', 'aria-label': '搜索 Agent 对话', value: query, onChange: event => setQuery(event.target.value) }) : null,
        h('div', { className: 'dsh-tavern-side-list' },
          ...visibleRecords.map(row => h('div', { key: row.sessionId, className: 'dsh-tavern-side-row' + (props.currentSessionId === row.sessionId ? ' active' : '') },
            h('button', { className: 'dsh-tavern-side-row-main', title: (details?.modes?.find(mode => mode.id === row.nativePresetId)?.name || row.nativePresetId) + ' · ' + row.path, type: 'button', 'aria-current': props.currentSessionId === row.sessionId ? 'page' : undefined, disabled: busy, onClick: () => { void open(row.sessionId).catch(failure => setError(String(failure.message || failure))) } },
              h('div', { className: 'dsh-tavern-side-row-name' }, native.byId?.[row.sessionId]?.title || row.title),
              h('div', { className: 'dsh-tavern-side-row-meta' }, details?.modes?.find(mode => mode.id === row.nativePresetId)?.name || row.nativePresetId || 'Agent')))),
          !records.length ? h('div', { className: 'dsh-tavern-side-empty' }, '创建一个项目对话。发送首条消息前，可在输入框旁选择 Agent 模式。') : !visibleRecords.length ? h('div', { className: 'dsh-tavern-side-empty', role: 'status' }, '没有匹配的对话') : null))
    }
    function ProjectAgentComposerMode() {
      const snapshot = React.useSyncExternalStore(listener => ctx.sessions.list.subscribe(listener), () => ctx.sessions.list.getSnapshot(), () => ctx.sessions.list.getSnapshot())
      const sessionId = snapshot.current
      const session = sessionId ? snapshot.byId?.[sessionId] : null
      const record = records.find(row => row.sessionId === sessionId)
      const [busy, setBusy] = React.useState(false), [error, setError] = React.useState(''), [pendingMode, setPendingMode] = React.useState('')
      const [open, setOpen] = React.useState(false), [position, setPosition] = React.useState(null)
      const trigger = React.useRef(null), menu = React.useRef(null), saving = React.useRef(false), identity = React.useId()
      React.useEffect(() => { setOpen(false); setError(''); setPendingMode('') }, [sessionId])
      React.useLayoutEffect(() => {
        if (!open) return
        const place = () => {
          const rect = trigger.current?.getBoundingClientRect()
          if (rect) setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - 260 - 12)), bottom: Math.max(12, window.innerHeight - rect.top + 8), maxHeight: Math.max(100, rect.top - 20) })
        }
        const outside = event => { if (!trigger.current?.contains(event.target) && !menu.current?.contains(event.target)) setOpen(false) }
        const keydown = event => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); return }
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const items = Array.from(menu.current?.querySelectorAll('[role="menuitemradio"]:not(:disabled)') || [])
          const current = items.indexOf(document.activeElement)
          const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length
          items[index]?.focus()
        }
        place(); menu.current?.querySelector('[aria-checked="true"]')?.focus()
        document.addEventListener('pointerdown', outside); menu.current?.addEventListener('keydown', keydown)
        window.addEventListener('resize', place); window.addEventListener('scroll', place, true)
        const element = menu.current
        return () => { document.removeEventListener('pointerdown', outside); element?.removeEventListener('keydown', keydown); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
      }, [open])
      React.useEffect(() => { if (session?.blank !== true) setOpen(false) }, [session?.blank])
      if (!record || ctx.sessions.subagentAddress?.(sessionId)) return null
      const selectedId = pendingMode || record.nativePresetId
      const selectedMode = info?.modes?.find(row => row.id === selectedId)
      async function change(presetId) {
        if (saving.current || session?.blank !== true) return
        saving.current = true; setBusy(true); setOpen(false); setError(''); setPendingMode(presetId)
        try {
          const result = await ctx.remote.agentPresets.select(sessionId, presetId)
          if (!result.ok) throw Error(result.error?.message || '模式切换失败')
          await rpc('register', { sessionId, presetId })
          await refresh(); setPendingMode('')
        } catch (failure) { setPendingMode(''); setError(String(failure.message || failure)) }
        finally { saving.current = false; setBusy(false); trigger.current?.focus() }
      }
      return h(React.Fragment, null,
        h('button', { ref: trigger, type: 'button', className: 'dsh-composer-preset-trigger tavern-agent-composer-mode',
          'aria-label': session?.blank === true ? 'Agent 模式' : 'Agent 模式已锁定', 'aria-haspopup': 'menu', 'aria-expanded': open,
          'aria-controls': open ? identity : undefined, disabled: busy || !info?.modes?.length || session?.blank !== true,
          title: session?.blank === true ? '选择 Agent 模式' : '会话开始后模式固定', onClick: () => setOpen(value => !value) },
          h('span', null, selectedMode?.name || selectedId), h('span', { 'aria-hidden': true, className: 'tavern-agent-composer-chevron' }, '⌄')),
        open ? ReactDom.createPortal(h('div', { ref: menu, id: identity, role: 'menu', 'aria-label': '选择 Agent 模式', className: 'tavern-agent-mode-menu', style: position || { visibility: 'hidden' } },
          h('div', { className: 'tavern-agent-mode-heading' }, 'Agent 模式'),
          ...(info?.modes || []).map(row => h('button', { key: row.id, type: 'button', role: 'menuitemradio', 'aria-checked': row.id === selectedId, disabled: busy, onClick: () => change(row.id) },
            h('span', null, h('span', { className: 'tavern-agent-mode-name' }, row.name), row.description ? h('small', null, row.description) : null), h('span', { 'aria-hidden': true, className: 'tavern-agent-mode-check' }, row.id === selectedId ? '✓' : ''))),
          h('p', null, '发送首条消息后固定本局模式。')), document.body) : null,
        error ? h('span', { className: 'tavern-agent-composer-error', role: 'alert' }, error) : null)
    }
    ctx.tavernUi.registerSidebarWorkspace({ id: 'agent', label: 'Agent', sessions: store, component: ProjectAgentPanel })
    ctx.effect(() => ctx.slots.inject('conversation.input.right', () => ctx.slots.register({ name: 'conversation.input.right', id: 'dsh-tavern-project-agent-mode', order: 70, label: 'Agent mode' }, () => React.createElement(ProjectAgentComposerMode))), 'project Agent composer mode')
    void refresh().catch(() => {})
  } }
} })
