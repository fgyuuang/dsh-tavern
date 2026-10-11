// Post-story interaction is a separate artifact, never a formal message floor.
function DreamSikeFollowup(props) {
    const h = React.createElement;
    const state = useLiveTavernView(props.sessionId, 'dream-followup:' + props.turn, [['dreamSikeFollowup']]);
    const record = state.view?.dreamSikeFollowup;
    const [expanded, setExpanded] = React.useState(true), [retrying, setRetrying] = React.useState(false), [error, setError] = React.useState('');
    const identity = props.sessionId + ':' + String(record?.key || '') + ':' + props.turn;
    const identityRef = React.useRef(identity), pending = React.useRef(false), mounted = React.useRef(true);
    identityRef.current = identity;
    React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    React.useEffect(() => { setExpanded(true); setRetrying(false); setError(''); pending.current = false; }, [identity]);
    if (!record || Number(record.turn) !== props.turn) return null;
    const busy = record.status === 'queued' || record.status === 'running';
    const latest = props.latest === true;
    async function retry() {
        if (pending.current || !latest) return;
        pending.current = true; setRetrying(true); setError('');
        const owner = identity;
        try { await rpc('retryDreamSikeFollowup', { sessionId: props.sessionId, key: record.key, turn: props.turn }, props.sessionId); }
        catch (err) { if (mounted.current && identityRef.current === owner) setError(String(err?.message || err)); }
        finally { if (mounted.current && identityRef.current === owner) { pending.current = false; setRetrying(false); liveTavernView.invalidate(props.sessionId); } }
    }
    function executeSlash(...args) {
        const view = liveTavernView.getSnapshot(props.sessionId).view;
        if (!mounted.current || !latest || view?.dreamSikeFollowup?.key !== record.key || view.dreamSikeFollowup.revision !== record.revision || view.dreamSikeFollowup.status !== 'done' || Number(view.dreamSikeFollowup.turn) !== props.turn || tavernLatestProjectionTurn(view) !== props.turn) {
            return Promise.reject(new Error('后续互动已过期，请使用当前回合的面板'));
        }
        return props.executeSlash(...args);
    }
    const moduleNames = new Map([
        ['f9b03e19-fd96-4782-8867-73ad2cbabfb9', '思客说书'], ['27bf435f-4283-4937-8c6f-3c31abc4f6d2', '剧情共创'],
        ['11cdd506-1513-4008-b6b9-c883dbad65c5', '行动选项'], ['f96f47f7-01ef-4676-b0fe-6f254ae7e550', '行动选项'],
        ['6a8e799c-9445-44f2-a853-c6c71b92b855', '本回合摘要']
    ]);
    const enabledIds = new Set((record.enabledModules || []).map(module => module.id));
    const completedLabel = [...new Set([...moduleNames].filter(([id]) => enabledIds.has(id)).map(([, name]) => name))].join('与') || (record.enabledModules ? '后续内容已完成' : '剧情共创与行动选项');
    const summary = record.status === 'queued' ? (record.waitingForSettlement === false ? '正文与结算已完成，等待生成后续互动' : '正文已提交，等待变量结算后生成') : record.status === 'running' ? '正文与结算已完成，正在生成后续互动' : record.status === 'failed' ? '后续互动生成失败，正文已保留' : completedLabel;
    const projection = record.status === 'done' && record.projection ? renderTavernProjection(record.projection, {
        sessionId: props.sessionId, turn: props.turn, partIndexPrefix: 'dream-followup:' + record.key,
        frameOwner: props.frameOwner, frameSizing: props.frameSizing, trustedCardMode: props.trustedCardMode,
        helperContext: liveTavernView.getSnapshot(props.sessionId).view?.tavernHelper,
        helperContextReader: () => liveTavernView.getSnapshot(props.sessionId).view?.tavernHelper,
        executeSlash, eagerFrame: latest, streaming: false, codeLabels: { copyLabel: '复制', copiedLabel: '已复制' }
    }) : null;
    return h('section', { className: 'dsh-sike-followup', 'data-followup-turn': props.turn, 'aria-label': '梦境后续互动' },
        h('button', { type: 'button', className: 'dsh-sike-followup-toggle', 'aria-expanded': expanded, onClick: () => setExpanded(value => !value) }, h('strong', null, '后续互动'), h('span', { role: busy ? 'status' : undefined }, summary), h('span', null, expanded ? '⌃' : '⌄')),
        expanded ? h('div', { className: 'dsh-sike-followup-body' },
            !latest ? h('p', { className: 'dsh-sike-followup-note' }, '历史回合，仅供查看。') : null,
            projection ? h('div', { inert: !latest ? true : undefined }, projection) : null,
            record.status === 'failed' ? h('div', { role: 'alert' }, h('p', null, String(record.error || '未能生成后续互动')), latest ? h('button', { type: 'button', className: 'dsh-tavern-btn', disabled: retrying, onClick: retry }, retrying ? '正在重试…' : '重试后续互动') : null) : null,
            error ? h('p', { role: 'alert' }, error) : null
        ) : null);
}
