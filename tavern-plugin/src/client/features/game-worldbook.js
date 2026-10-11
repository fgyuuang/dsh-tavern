// A read-only view of the material saved for this game, separate from the library.
function createGameWorldbookFeatureModule() {
    function GameWorldbookView(props) {
        const h = React.createElement, sessionId = props.sessionId, ctx = props.ctx;
        const mode = useTavernSessionMode(sessionId);
        const askConfirm = useTavernConfirm(sessionId);
        const coordination = useTavernCoordination(sessionId);
        const activity = describeTavernActivity(coordination.view?.activity);
        const binding = React.useSyncExternalStore(listener => ctx?.sessions.list?.subscribe(listener) || (() => {}), () => ctx?.sessions.binding?.(sessionId) || null, () => null);
        const running = React.useSyncExternalStore(listener => binding?.session.subscribe(listener) || (() => {}), () => binding?.session.getSnapshot().running === true, () => false);
        const [refresh, setRefresh] = React.useState(0), [tab, setTab] = React.useState('entries');
        const [query, setQuery] = React.useState(''), [filter, setFilter] = React.useState('all');
        const [book, setBook] = React.useState(null), [bookError, setBookError] = React.useState('');
        const [recall, setRecall] = React.useState(null), [recallError, setRecallError] = React.useState(''), [turn, setTurn] = React.useState('');
        const [syncBusy, setSyncBusy] = React.useState(false), [syncError, setSyncError] = React.useState(''), [notice, setNotice] = React.useState('');
        const mounted = React.useRef(true), syncPending = React.useRef(false);
        const active = props.visible !== false && isPlayMode(mode);
        React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
        React.useEffect(() => {
            if (!active || !sessionId) return;
            let cancelled = false;
            setBook(null); setBookError('');
            rpcWithTimeout('getGameWorldBook', { sessionId }, sessionId).then(value => { if (!cancelled) setBook(value); }, error => { if (!cancelled) setBookError(String(error?.message || error)); });
            return () => { cancelled = true; };
        }, [active, sessionId, refresh]);
        React.useEffect(() => {
            if (!active || tab !== 'recall' || !sessionId) return;
            let cancelled = false;
            setRecall(null); setRecallError('');
            const args = { sessionId }; if (turn) args.turn = Number(turn);
            rpcWithTimeout('getWorldBookRecallLog', args, sessionId).then(value => { if (!cancelled) setRecall(value); }, error => { if (!cancelled) setRecallError(String(error?.message || error)); });
            return () => { cancelled = true; };
        }, [active, sessionId, tab, turn, refresh]);
        React.useEffect(() => {
            if (!active) return;
            const reload = () => setRefresh(value => value + 1);
            const changed = event => { if (tavernDataChangeAffects(event, ['sessions', 'cards', 'worldbooks'])) reload(); };
            window.addEventListener('dsh-tavern-data-changed', changed); window.addEventListener('focus', reload);
            let stop = () => {};
            try { if (typeof tavernSessionSignals !== 'undefined') stop = tavernSessionSignals.subscribe(sessionId, 'tavern-state', reload); } catch (_) {}
            return () => { stop(); window.removeEventListener('dsh-tavern-data-changed', changed); window.removeEventListener('focus', reload); };
        }, [active, sessionId]);
        function reload() { setRefresh(value => value + 1); }
        async function synchronize() {
            if (syncPending.current || running || activity.busy || !book?.update?.digest || book.update.error) return;
            syncPending.current = true; setSyncBusy(true); setSyncError(''); setNotice('');
            try {
                if (!await askConfirm('将资源库最新的人物卡和世界书同步到本局？\n\n会替换本局世界书条目的启用状态和内容，包括本局或角色卡脚本的修改，并一并更新人物卡及关联扩展。保留聊天历史和游戏变量。下轮使用新版本；提示词缓存会重新建立。')) return;
                if (!mounted.current) return;
                await rpc('applyUpdatedCard', { digest: book.update.digest }, sessionId);
                if (!mounted.current) return;
                liveTavernView.invalidate(sessionId); setNotice('已同步人物卡和世界书。本局后续生成使用更新后的材料。'); reload();
            } catch (error) { if (mounted.current) setSyncError(String(error?.message || error)); }
            finally { syncPending.current = false; if (mounted.current) setSyncBusy(false); }
        }
        function openLibrary() {
            const source = book?.library?.source || book?.source;
            void openTavernSidebarTab(ctx, { type: 'dsh-tavern:worldbooks', meta: source ? { worldBookSource: source } : {} }, { sessionId });
        }
        const counts = book?.counts || {}, entries = Array.isArray(book?.entries) ? book.entries : [];
        const search = query.trim().toLocaleLowerCase();
        const filtered = entries.filter(entry => (filter === 'all' || (filter === 'enabled' ? entry.enabled !== false : filter === 'disabled' ? entry.enabled === false : filter === 'constant' ? entry.constant : entry.mvuRule)) && (!search || [entry.ref, entry.title, entry.content].some(value => String(value || '').toLocaleLowerCase().includes(search))));
        const update = book?.update;
        const updateText = update?.error ? '资源库检查失败：' + update.error : update?.worldbookSyncRequired || update?.legacy ? '本局需要同步资源库版本' : update?.cardChanged && update?.worldbookChanged ? '资源库人物卡和世界书有更新' : update?.worldbookChanged ? '资源库世界书有更新' : update?.cardChanged ? '资源库人物卡有更新' : book?.localChanges ? '本局世界书含有本局修改，资源库来源版本没有变化' : book?.library && !book.library.error ? '资源库来源版本没有变化' : '资源库没有可同步的绑定';
        const log = recall?.log, turns = Array.isArray(recall?.availableTurns) ? recall.availableTurns : [];
        function badge(text) { return h('span', { className: 'dsh-game-worldbook-badge' }, text); }
        function entryStatus(entry) { return (entry.enabled === false ? '已禁用' : '已启用') + ' · ' + (entry.mvuRule ? 'MVU 更新规则' : entry.constant ? '常驻' : '动态召回'); }
        function renderEntries() {
            return h(React.Fragment, null,
                h('div', { className: 'dsh-game-worldbook-filters' }, h('label', null, '搜索条目', h('input', { type: 'search', 'aria-label': '搜索条目', maxLength: 200, value: query, placeholder: '名称、引用或正文', onChange: event => setQuery(event.target.value) })),
                    h('label', null, '筛选', h('select', { 'aria-label': '筛选', value: filter, onChange: event => setFilter(event.target.value) }, [['all', '全部条目'], ['enabled', '已启用'], ['disabled', '已禁用'], ['constant', '常驻条目'], ['mvu', 'MVU 规则']].map(([value, label]) => h('option', { key: value, value }, label))))),
                h('p', { className: 'dsh-game-worldbook-help', role: 'status' }, '显示 ' + filtered.length + ' / ' + entries.length + ' 条。启用表示允许使用；动态条目是否进入某轮请求，请查看“回合接入记录”。'),
                filtered.length ? h('div', { className: 'dsh-game-worldbook-entries' }, filtered.map((entry, index) => h('details', { key: entry.ref || index, className: 'dsh-game-worldbook-entry' }, h('summary', null, h('strong', null, entry.title || entry.ref || '未命名条目'), h('small', null, entryStatus(entry))), h('div', { className: 'dsh-game-worldbook-entry-content' }, h('div', { className: 'dsh-game-worldbook-help' }, '引用：' + (entry.ref || '未提供')), h('pre', null, typeof entry.content === 'string' ? entry.content : ''))))) : h('p', { className: 'dsh-tavern-empty' }, entries.length ? '没有匹配的条目。' : '本局没有世界书条目。请检查人物卡绑定或同步资源库。'));
        }
        function renderRecall() {
            return h('section', { 'aria-label': '世界书回合接入记录' },
                h('label', { className: 'dsh-game-worldbook-turn' }, '回合', h('select', { 'aria-label': '回合', value: turn, onChange: event => setTurn(event.target.value) }, h('option', { value: '' }, '当前分支最新记录'), [...new Set([...turns, ...(turn ? [Number(turn)] : [])])].sort((a, b) => b - a).map(value => h('option', { key: value, value: String(value) }, '第 ' + value + ' 回合')))),
                recallError ? h('div', { className: 'dsh-card-error', role: 'alert' }, '读取接入记录失败：' + recallError, h('button', { className: 'dsh-tavern-btn', onClick: reload }, '重试')) : !recall ? h('p', { role: 'status' }, '正在读取本轮记录…') : !log ? h('p', { className: 'dsh-game-worldbook-help' }, recall.message || '没有这轮接入记录；不会用当前世界书反推历史。') : h(React.Fragment, null,
                    h('p', { className: 'dsh-game-worldbook-log-status', role: 'status' }, '第 ' + log.turn + ' 回合 · ' + (log.status === 'requested' ? '已关联模型请求' : '已准备，尚无发送记录')),
                    h('p', { className: 'dsh-game-worldbook-help' }, log.status === 'requested' ? '以下按已保存请求记录展示。正文匹配说明文本出现在请求中，不代表模型必然遵循。' : '准备记录只说明完成了筛选和模板处理，不能据此认定已发送。'),
                    log.error ? h('p', { className: 'dsh-card-error', role: 'alert' }, '准备失败：' + log.error) : null,
                    h('div', { className: 'dsh-game-worldbook-metrics' }, Object.entries(log.counts || {}).map(([reason, count]) => h('span', { key: reason }, ({selected:'已选中',disabled:'已禁用',keywords:'未命中关键词',cooldown:'冷却中',budget:'超出预算',group:'组内未选中',empty:'正文为空','mvu-update':'MVU 规则',semantic:'筛选排除'}[reason] || reason) + '：' + count))),
                    (Array.isArray(log.entries) ? log.entries : []).map((entry, index) => h('div', { className: 'dsh-game-worldbook-recall-entry', key: entry.ref || index }, h('strong', null, entry.title || entry.ref), h('small', null, (entry.reasonLabel || entry.reason || '未记录原因') + ' · ' + ({ rendered: '模板已生成', 'empty-output': '模板结果为空', 'not-selected': '未入选' }[entry.rendering] || entry.rendering || '未记录模板结果') + (entry.outputOrder ? ' · 顺序 ' + entry.outputOrder : '')))),
                    h('h3', null, '模板输出与请求匹配'), (Array.isArray(log.outputs) ? log.outputs : []).length ? log.outputs.map((output, index) => h('details', { key: String(output.ref) + ':' + index, className: 'dsh-game-worldbook-entry' }, h('summary', null, h('strong', null, output.title || output.ref || '输出 ' + (index + 1)), h('small', null, (output.location === 'foreground' ? '前台' : output.location === 'background' ? '后台' : output.location || '未记录位置') + ' · ' + (output.requestContainsText === true ? '请求正文已匹配' : output.requestContainsText === false ? '请求正文未匹配' : '没有请求正文匹配证据'))), h('pre', null, typeof output.text === 'string' ? output.text : ''))) : h('p', { className: 'dsh-game-worldbook-help' }, '该记录没有模板输出。')));
        }
        return h('section', { className: 'dsh-game-worldbook', 'aria-label': '本局世界书', 'aria-busy': !book && !bookError },
            h('header', { className: 'dsh-game-worldbook-head' }, h('div', null, h('h2', null, '世界书'), h('p', null, '本局材料与回合接入')), h('button', { type: 'button', className: 'dsh-tavern-btn', onClick: reload }, '刷新世界书')),
            !isPlayMode(mode) ? h('p', { className: 'dsh-tavern-empty' }, '请打开一个游玩对话查看世界书。') : h(React.Fragment, null,
                bookError ? h('div', { className: 'dsh-card-error', role: 'alert' }, '读取世界书失败：' + bookError, h('button', { type: 'button', className: 'dsh-tavern-btn', onClick: reload }, '重试')) : !book ? h('p', { role: 'status' }, '正在读取本局世界书…') : h(React.Fragment, null,
                    h('section', { className: 'dsh-game-worldbook-overview', 'aria-label': '世界书启用状态' }, h('h3', null, book.name || '未绑定世界书'), h('p', null, book.scope === 'snapshot' ? '当前展示本局保存的世界书快照，生成与 Agent 读取使用这份材料。' : '此存档沿用资源库世界书，尚无本局快照。同步人物卡和世界书后，可保存本局使用的版本。'),
                        h('div', { className: 'dsh-game-worldbook-metrics' }, badge('全部 ' + (counts.total ?? entries.length)), badge('启用 ' + (counts.enabled ?? entries.filter(entry => entry.enabled !== false).length)), badge('常驻 ' + (counts.constant ?? 0)), badge('动态 ' + (counts.dynamic ?? 0)), badge('MVU 规则 ' + (counts.mvuRules ?? 0))),
                        (book.library?.sources || []).length > 1 ? h('div', { className: 'dsh-game-worldbook-actions', 'aria-label': '资源库关联世界书' }, book.library.sources.map((item, index) => h('button', { key: index, type: 'button', className: 'dsh-tavern-btn', onClick: () => openTavernSidebarTab(ctx, { type: 'dsh-tavern:worldbooks', meta: { worldBookSource: item.source } }, { sessionId }) }, item.name || '世界书 ' + (index + 1)))) : null,
                        h('p', { className: 'dsh-game-worldbook-help' }, updateText), book.library?.counts ? h('p', { className: 'dsh-game-worldbook-help' }, '资源库：' + (book.library.name || '已绑定世界书') + ' · ' + book.library.counts.total + ' 条 · 启用 ' + book.library.counts.enabled + ' 条') : null,
                        book.localChanges ? h('p', { className: 'dsh-game-worldbook-help' }, '本局条目与资源库不同。同步将替换本局条目的启用状态和内容，包括角色卡脚本所作的修改。') : null,
                        book.library?.error ? h('p', { className: 'dsh-card-error', role: 'alert' }, '读取资源库世界书失败：' + book.library.error) : null, h('div', { className: 'dsh-game-worldbook-actions' }, h('button', { type: 'button', className: 'dsh-tavern-btn', onClick: openLibrary }, '打开资源库世界书'), h('button', { type: 'button', className: 'dsh-tavern-btn', disabled: syncBusy || running || activity.busy || !update?.digest || !!update.error, onClick: synchronize }, syncBusy ? '正在同步…' : '同步人物卡和世界书')),
                        running || activity.busy ? h('p', { className: 'dsh-game-worldbook-help' }, '当前生成或后台任务仍在运行，结束后可同步。') : null,
                        syncError ? h('p', { className: 'dsh-card-error', role: 'alert' }, '同步未完成：' + syncError) : null, notice ? h('p', { role: 'status' }, notice) : null),
                    h('nav', { className: 'dsh-game-worldbook-navigation', 'aria-label': '世界书视图' }, [['entries', '条目与启用'], ['recall', '回合接入记录']].map(([value, label]) => h('button', { type: 'button', key: value, className: 'dsh-tavern-btn', 'aria-pressed': tab === value, onClick: () => setTab(value) }, label))),
                    tab === 'entries' ? renderEntries() : renderRecall())));
    }
    function View(props) { return React.createElement(GameWorldbookView, { ...props, key: props.sessionId }); }
    function register(input) {
        const ctx = input.ctx;
        ctx.effect(() => tavernUiExtensions.service.registerWorkbenchPanel({ id: 'tavern/worldbook', label: '世界书', description: '启用条目、版本与回合接入', order: 35, keepAlive: true, component: props => React.createElement(View, { sessionId: props.gameId, visible: props.visible, ctx }) }), 'dsh-tavern: worldbook workbench module');
        ctx.effect(() => ctx.betterSidebar.registerTab({ id: 'dsh-tavern:game-worldbook', title: '本局世界书', order: 9, single: true, component: props => React.createElement(View, { sessionId: props.scope.sessionId, visible: props.visible, ctx }) }), 'dsh-tavern: game worldbook tab');
    }
    return Object.freeze({ register, View });
}
const gameWorldbookFeature = createGameWorldbookFeatureModule();
