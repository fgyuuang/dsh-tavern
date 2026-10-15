// One compact entry beside the model selector; settings apply to the next turn.
function TavernComposerPreset(props) {
    const h = React.createElement;
    const sessionId = props.ctx.sessions.subagentAddress(props.sessionId)?.parentSessionId || props.sessionId;
    const mode = useTavernSessionMode(sessionId);
    const live = useLiveTavernView(sessionId, "composer-preset", [["playPresetId"], ["generationMode"], ["runtimePreset"]]);
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
        window.addEventListener("dsh-tavern-data-changed", refresh);
        return () => { ++generation.current; window.removeEventListener("dsh-tavern-data-changed", refresh); };
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
            await load(); liveTavernView.invalidate(sessionId); tavernCoordination.invalidate(sessionId);
            notifyTavernDataChanged(["presets", "sessions"], "play-controls");
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
                (data?.presets || []).map(item => h("option", { key: item.id, value: item.id, disabled: item.available === false }, item.name + (item.available === false ? ' · 插件未启用' : item.provider?.kind === 'plugin' ? ' · 插件' : ''))))),
            h("label", null, "酒馆预设 / 作者规则", h("select", { "aria-label": "输入区酒馆预设", disabled, value: data?.source?.id || "", onChange: event => change("applyConversationPreset", { path: event.target.value }) },
                h("option", { value: "" }, "不使用外部预设"),
                data?.source?.id && !data.sources.some(item => item.path === data.source.id) ? h("option", { value: data.source.id }, data.source.name) : null,
                (data?.sources || []).map(item => h("option", { key: item.path, value: item.path }, item.title)))),
            h("label", null, h("input", { type: "checkbox", role: "switch", "aria-label": "酒馆直接回复模式", checked: single, disabled,
                onChange: event => change("setGenerationMode", { generationMode: event.target.checked ? "sillytavern-once" : "agent" }) }), "酒馆直接回复"),
            h("p", null, single ? "按原预设一次生成回复，作者功能选项仍可配置。" : "按所选 Agent 预设执行写作流程。"),
            h("button", { type: "button", className: "dsh-tavern-btn", disabled, onClick: () => {
                setOpen(false);
                const task = isWritingAgentPresetId(live.view?.playPresetId) || single
                    ? agentWorkbenchFeature.open(props.ctx, sessionId, "tavern/author-settings")
                    : openTavernSidebarTab(props.ctx, { type: "dsh-tavern:dream-sike-settings" }, { sessionId });
                void task.catch(failure => tavernErrorHub.report("预设设置", failure));
            } }, "配置作者选项"),
            data?.running ? h("p", { role: "status" }, "当前回合仍在处理，完成后可切换。") : h("p", null, "仅本局生效，从下一回合开始使用。"),
            error ? h("p", { role: "alert" }, error, h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy, onClick: load }, "重新读取")) : !data ? h("p", { role: "status" }, "正在读取…") : null), document.body) : null);
}
