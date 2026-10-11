// Provider-reported counters only. Prefix characters are separate structural evidence.
function createContextCacheFeatureModule() {
    const number = value => Number.isFinite(value) ? value.toLocaleString('zh-CN') : '未报告';
    const percent = value => Number.isFinite(value) ? (100 * value).toFixed(1) + '%' : '未报告';
    const taskName = value => ({ reply: '正文', settlement: '状态结算', 'dream-followup': '梦境后续', 'dream-draft-module': '独立草稿模块', candidate: '候选', ledger: '台账', 'worldbook-filter': '世界书筛选' }[value] || value || '未标明任务');
    function ViewBody(props) {
        const h = React.createElement, sessionId = props.sessionId;
        const mode = useTavernSessionMode(sessionId), active = props.visible !== false && isPlayMode(mode);
        const [audit, setAudit] = React.useState(null), [error, setError] = React.useState(''), [loading, setLoading] = React.useState(false);
        const [request, setRequest] = React.useState({ revision: 0, includePrefix: false });
        React.useEffect(() => {
            if (!active || !sessionId) return;
            let cancelled = false;
            setLoading(true); setError('');
            rpcWithTimeout('getContextCacheAudit', { sessionId, limit: 50, includePrefix: request.includePrefix }, sessionId).then(value => {
                if (!cancelled) { setAudit(value?.audit || null); setLoading(false); }
            }, reason => { if (!cancelled) { setError(String(reason?.message || reason)); setLoading(false); } });
            return () => { cancelled = true; };
        }, [active, sessionId, request]);
        function refresh(includePrefix = false) { setRequest(value => ({ revision: value.revision + 1, includePrefix })); }
        const rows = Array.isArray(audit?.requests) ? audit.requests : [], summary = audit?.summary || {};
        const prompts = rows.filter(row => Number.isFinite(row.promptTokens));
        const promptTotal = prompts.length ? prompts.reduce((sum, row) => sum + row.promptTokens, 0) : null;
        const groups = new Map();
        for (const row of rows) {
            const key = JSON.stringify([row.scope, row.task, row.provider, row.model]);
            const group = groups.get(key) || { row, rows: [], totals: {} };
            group.rows.push(row);
            for (const [name, value] of Object.entries(row.usage || {})) if (Number.isFinite(value)) group.totals[name] = (group.totals[name] || 0) + value;
            groups.set(key, group);
        }
        function counters(totals) {
            return h('dl', { className: 'dsh-context-cache-counters' }, [['inputTokens', '未缓存输入'], ['cacheReadTokens', '缓存读取'], ['cacheWriteTokens', '缓存写入'], ['outputTokens', '输出']].map(([key, label]) => h('div', { key }, h('dt', null, label), h('dd', null, number(totals?.[key])))));
        }
        return h('section', { className: 'dsh-context-cache', 'aria-label': '上下文缓存', 'aria-busy': loading },
            h('header', null, h('div', null, h('h2', null, '上下文缓存'), h('p', null, '按真实模型回报检查输入成本')), h('button', { type: 'button', className: 'dsh-tavern-btn', disabled: loading || !active, onClick: () => refresh() }, '刷新缓存统计')),
            !isPlayMode(mode) ? h('p', null, '请打开游玩对话。') : error ? h('div', { role: 'alert', className: 'dsh-card-error' }, error, h('button', { type: 'button', className: 'dsh-tavern-btn', onClick: () => refresh() }, '重试')) : !audit ? h('p', { role: 'status' }, loading ? '正在读取缓存统计…' : '尚无缓存统计。') : h(React.Fragment, null,
                h('div', { className: 'dsh-context-cache-overview' }, [['有效样本', String(summary.requestsWithUsage ?? 0) + ' / ' + String(summary.requests ?? rows.length)], ['已报告输入总量', number(promptTotal)], ['缓存读取率', percent(summary.cacheReadRatio)]].map(([label, value]) => h('div', { key: label }, h('small', null, label), h('strong', null, value)))),
                h('p', { className: 'dsh-context-cache-note' }, '统计最近 ' + rows.length + ' 次请求。输入总量包含未缓存输入、缓存读取及缓存写入；缺失计数显示“未报告”。缓存率只使用输入总量与缓存读取都已报告的样本。'),
                summary.requestsWithoutUsage ? h('p', { role: 'status', className: 'dsh-context-cache-note' }, summary.requestsWithoutUsage + ' 次请求未报告 usage，旧记录不会反推或补造计数。') : null,
                counters(summary.totals),
                h('p', { className: 'dsh-context-cache-note' }, '缓存命中仍占上下文窗口。跨提供方、模型或上游实例切换后，相同文本也可能重新计费；总输入量比命中率更能反映每轮处理规模。'),
                h('h3', null, '按任务与模型'), [...groups.values()].map(({ row, rows: members, totals }, index) => h('details', { className: 'dsh-context-cache-group', key: index },
                    h('summary', null, h('strong', null, (row.scope === 'background' ? '后台' : '前台') + ' · ' + taskName(row.task)), h('small', null, (row.provider || '未记录提供方') + ' / ' + (row.model || '未记录模型') + ' · ' + members.length + ' 次')),
                    counters(totals), h('div', { className: 'dsh-context-cache-requests' }, members.map(item => h('article', { key: item.id },
                        h('strong', null, '第 ' + (item.turn || item.agentTurn || 0) + ' 回合 · 步骤 ' + item.step), h('p', null, item.usage ? '输入 ' + number(item.promptTokens) + ' token · 缓存读取率 ' + percent(item.cacheReadRatio) : 'usage 未报告'), counters(item.usage),
                        item.prefix ? h('p', { className: 'dsh-context-cache-note' }, '结构前缀：' + number(item.prefix.sharedPrefixCharacters) + ' / ' + number(item.prefix.serializedCharacters) + ' 字符。字符统计不等于 token 或实际缓存命中。') : null))))),
                h('button', { type: 'button', className: 'dsh-tavern-btn', disabled: loading || !active, onClick: () => refresh(true) }, '检查最近请求前缀'),
                h('p', { className: 'dsh-context-cache-note' }, '前缀检查额外读取至多 8 个请求快照，按会话及模型路由分别比较，仅展示长度和摘要；默认刷新只读取计数记录。')));
    }
    function View(props) { return React.createElement(ViewBody, { ...props, key: props.sessionId }); }
    function register({ ctx }) {
        ctx.effect(() => tavernUiExtensions.service.registerWorkbenchPanel({ id: 'tavern/context-cache', label: '上下文缓存', description: '真实 token 与缓存复用', order: 45, keepAlive: true,
            component: props => React.createElement(View, { sessionId: props.gameId, visible: props.visible }) }), 'dsh-tavern: context cache module');
    }
    return Object.freeze({ register, View });
}
const contextCacheFeature = createContextCacheFeatureModule();
