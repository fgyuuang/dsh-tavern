// Independent user plugin; uses public Tavern and native DSH slot/session services.
window.__ModuleLoader__.load({ id: 'dsh-tavern-writing-presets', factory: require => {
  const React = require('react'), ReactDom = require('react-dom');
  return { name: 'dsh-tavern-writing-presets', inject: ['tavernUi', 'slots', 'sessions'], apply(ctx) {
    if (ctx.tavernUi.writingPresets?.version !== 1) return;
    const rpc = (method, args = {}, sessionId) => ctx.tavernUi.callHost('dsh-tavern-writing-presets/request', { method, args: { ...args, ...(sessionId ? { sessionId } : {}) } });
    const isPlayMode = mode => ['story', 'script'].includes(mode);
    const changed = () => window.dispatchEvent(new Event('dsh-writing-presets-changed'));
    function useLiveTavernView(sessionId) {
      const [view, setView] = React.useState(null);
      React.useEffect(() => {
        let active = true, version = 0;
        const refresh = () => { const request = ++version; rpc('getSession', { sessionId }).then(result => { if (active && request === version) setView(result.view); }, () => {}); };
        refresh();
        const stop = ctx.tavernUi.watchTurnState(sessionId, refresh);
        window.addEventListener('dsh-writing-presets-changed', refresh);
        return () => { active = false; stop(); window.removeEventListener('dsh-writing-presets-changed', refresh); };
      }, [sessionId]);
      return { view };
    }
// One compact entry beside the model selector; settings apply to the next turn.
function TavernComposerPreset(props) {
    const h = React.createElement;
    const sessionId = props.ctx.sessions.subagentAddress(props.sessionId)?.parentSessionId || props.sessionId;
    const live = useLiveTavernView(sessionId, "composer-preset", [["playPresetId"], ["generationMode"], ["runtimePreset"]]);
    const mode = live.view?.mode;
    const [open, setOpen] = React.useState(false), [data, setData] = React.useState(null);
    const [busy, setBusy] = React.useState(false), [error, setError] = React.useState("");
    const [position, setPosition] = React.useState({ left: 12, bottom: 12 });
    const trigger = React.useRef(null), menu = React.useRef(null), generation = React.useRef(0), saving = React.useRef(false);
    const identity = React.useId();
    const revision = [live.view?.playPresetId, live.view?.generationMode, live.view?.runtimePreset?.id].join(":");
    React.useEffect(() => { ++generation.current; saving.current = false; setBusy(false); setOpen(false); setData(null); setError(""); }, [sessionId]);
    async function load() {
        const version = ++generation.current;
        try {
            const [agent, catalog, session, execution] = await Promise.all([
                rpc("listPlayPresets", { sessionId }, sessionId), rpc("listPresets", {}, sessionId),
                rpc("getSession", {}, sessionId), rpc("getGenerationMode", { sessionId }, sessionId)
            ]);
            if (version === generation.current) { setError(""); setData({ presets: agent.presets || [], sources: (catalog.presets || []).filter(item => item.valid && item.recognized),
                presetId: agent.currentPlayPresetId || "tavern", source: session.view?.runtimePreset || null,
                generationMode: execution.generationMode || "agent", running: execution.busy === true }); }
        } catch (failure) { if (version === generation.current) setError(String(failure.message || failure)); }
    }
    React.useEffect(() => {
        if (!open) return;
        void load();
        const refresh = () => { if (!saving.current) void load(); };
        window.addEventListener("dsh-writing-presets-changed", refresh);
        return () => { ++generation.current; window.removeEventListener("dsh-writing-presets-changed", refresh); };
    }, [open, sessionId, revision]);
    React.useLayoutEffect(() => {
        if (!open) return;
        const place = () => {
            const rect = trigger.current?.getBoundingClientRect();
            if (rect) setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - Math.min(340, window.innerWidth - 24) - 12)),
                bottom: Math.max(12, Math.min(window.innerHeight - 24, window.innerHeight - rect.top + 8)),
                maxHeight: Math.max(100, Math.min(window.innerHeight - 24, rect.top - 20)) });
        };
        place(); menu.current?.focus();
        const outside = event => { if (!trigger.current?.contains(event.target) && !menu.current?.contains(event.target)) setOpen(false); };
        const escape = event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); } };
        document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape, true);
        window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
        return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape, true); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
    }, [open]);
    async function change(method, args) {
        if (saving.current || !data || data.running) return;
        saving.current = true; setBusy(true); setError("");
        const version = generation.current;
        try {
            await rpc(method, { sessionId, ...args }, sessionId);
            if (version !== generation.current) return;
            await load(); changed();
        } catch (failure) { if (version === generation.current) setError(String(failure.message || failure)); }
        finally { saving.current = false; setBusy(false); }
    }
    if (!isPlayMode(mode) || props.ctx.sessions.subagentAddress(props.sessionId)) return null;
    const single = (data?.generationMode || live.view?.generationMode) === "sillytavern-once";
    const label = single ? "酒馆回复" : "Agent 预设";
    const disabled = busy || !data || data.running;
    return h(React.Fragment, null,
        h("button", { ref: trigger, type: "button", className: "dsh-composer-preset-trigger", "aria-haspopup": "dialog", "aria-expanded": open,
            "aria-controls": open ? identity : undefined, "aria-label": "选择预设与回复方式", title: "本局预设与回复方式", onClick: () => setOpen(value => !value) }, h("span", null, label), h("span", { "aria-hidden": true }, "⌄")),
        open ? ReactDom.createPortal(h("section", { ref: menu, id: identity, role: "dialog", tabIndex: -1, "aria-label": "本局预设与回复方式", className: "dsh-composer-preset-menu", style: position },
            h("header", null, h("strong", null, "本局预设"), h("button", { type: "button", className: "dsh-tavern-btn", "aria-label": "关闭预设菜单", onClick: () => { setOpen(false); trigger.current?.focus(); } }, "关闭")),
            h("label", null, "Agent 预设", h("select", { "aria-label": "输入区 Agent 预设", disabled, value: data?.presetId || "tavern", onChange: event => change("applyPlayPreset", { presetId: event.target.value }) },
                (data?.presets || []).map(item => h("option", { key: item.id, value: item.id }, item.name)))),
            h("label", null, "酒馆预设 / 作者规则", h("select", { "aria-label": "输入区酒馆预设", disabled, value: data?.source?.id || "", onChange: event => change("applyConversationPreset", { path: event.target.value }) },
                h("option", { value: "" }, "不使用外部预设"),
                data?.source?.id && !data.sources.some(item => item.path === data.source.id) ? h("option", { value: data.source.id }, data.source.name) : null,
                (data?.sources || []).map(item => h("option", { key: item.path, value: item.path }, item.title)))),
            h("label", null, h("input", { type: "checkbox", role: "switch", "aria-label": "酒馆直接回复模式", checked: single, disabled,
                onChange: event => change("setGenerationMode", { generationMode: event.target.checked ? "sillytavern-once" : "agent" }) }), "酒馆直接回复"),
            h("p", null, single ? "按原预设一次生成回复，作者功能选项仍可配置。" : "按所选 Agent 预设执行写作流程。"),
            h("button", { type: "button", className: "dsh-tavern-btn", disabled, onClick: () => {
                setOpen(false);
                void ctx.tavernUi.writingPresets.openSettings(sessionId).catch(failure => setError(String(failure.message || failure)));
            } }, "配置作者选项"),
            data?.running ? h("p", { role: "status" }, "当前回合仍在处理，完成后可切换。") : h("p", null, "仅本局生效，从下一回合开始使用。"),
            error ? h("p", { role: "alert" }, error, h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy, onClick: load }, "重新读取")) : !data ? h("p", { role: "status" }, "正在读取…") : null), document.body) : null);
}

    ctx.effect(() => { const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = ctx.tavernUi.assetUrl('composer.css'); document.head.append(style); return () => style.remove(); }, 'writing preset styles');
    // The native slot selects the lowest priority for an id. Unload restores the
    // maintained host fallback, without replacing DOM or intercepting events.
    ctx.effect(() => ctx.slots.inject('conversation.input.right', () => ctx.slots.register({ name: 'conversation.input.right', id: 'dsh-tavern-composer-preset', order: 90, priority: -1 }, props => React.createElement(TavernComposerPreset, { ...props, ctx }))), 'writing preset composer');
  } };
} });
