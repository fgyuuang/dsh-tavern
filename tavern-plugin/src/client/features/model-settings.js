function TavernConversationModels(props) {
    const h = React.createElement;
    const [config, setConfig] = React.useState(null), [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState(""), [notice, setNotice] = React.useState("");
    const saving = React.useRef(false), request = React.useRef(0);
    const binding = props.sessions?.binding(props.sessionId);
    const face = binding?.session.projections.faceOf("modelSelection") || EMPTY_PROJECTION_FACE;
    const native = React.useSyncExternalStore(listener => face.subscribe(listener), () => face.getSnapshot(), () => face.getSnapshot());
    const nativeKey = JSON.stringify(native);
    async function load() {
        if (saving.current) return;
        const version = ++request.current;
        try {
            const result = await rpc("getConversationModelConfig", { sessionId: props.sessionId }, props.sessionId);
            if (request.current === version) { setConfig(result); setError(""); }
        } catch (err) { if (request.current === version) setError(String(err.message || err)); }
    }
    React.useEffect(() => { void load(); return () => { ++request.current; }; }, [props.sessionId, nativeKey]);
    async function save(models, scope = "conversation") {
        if (saving.current || !config) return;
        saving.current = true; ++request.current; setBusy(true); setError(""); setNotice("");
        try {
            const result = await rpc("setConversationModelConfig", { sessionId: props.sessionId, scope, models }, props.sessionId);
            setConfig(result); liveTavernView.invalidate(props.sessionId);
            if (scope === "new-games") window.dispatchEvent(new CustomEvent("dsh-tavern-settings-changed"));
            setNotice(scope === "new-games" ? "已保存新游戏默认模型，已有游戏保持当前配置" : "已保存本局模型，下一次请求生效");
        } catch (err) { setError(String(err.message || err)); }
        finally { saving.current = false; setBusy(false); }
    }
    function row(name, title, description, selection, scope, fallback) {
        return h(TavernDefaultModelSetting, { key: name, label: title, title, description, selection,
            catalog: config.modelCatalog || [], fallback, disableFallback: name === "foregroundModel", disabled: busy || (scope !== "new-games" && config.busy),
            onChange: value => save({ [name]: value }, scope) });
    }
    return h("section", { className: "dsh-local-section dsh-conversation-models", "aria-label": "统一模型设置" },
        h("h3", null, "模型设置"), h("p", { className: "dsh-local-help" }, "本局前台与后台统一管理，保留各自模型和推理强度。前台选择与 DSH 原生模型选择器同步。"),
        h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy, onClick: load }, "刷新模型与运行状态"),
        config ? h(React.Fragment, null,
            row("foregroundModel", "本局前台模型", "准备、写作和草稿修订", config.foregroundModel, "conversation", "请选择模型"),
            row("backgroundModel", "本局后台模型", "变量结算与独立模块", config.backgroundModel, "conversation", "跟随前台"),
            h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy || config.busy || !config.foregroundModel,
                onClick: () => save({ foregroundModel: config.foregroundModel, backgroundModel: config.foregroundModel }) }, "前后台统一使用当前前台模型"),
            h("p", { className: "dsh-local-help" }, "平行事件、独立审稿、后续互动、变量结算共用本局后台：" + (backgroundModelLabel(config.effectiveBackgroundModel, config.modelCatalog) || "尚未配置")),
            config.busy ? h("p", { role: "status" }, "前后台有任务运行，完成后可调整本局模型。", h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy, onClick: load }, "刷新状态")) : null,
            h("details", { className: "dsh-tavern-default-skills" }, h("summary", null, "新游戏与卡片工作台默认模型"),
                h("p", { className: "dsh-local-help" }, "仅用于之后创建的游戏或工作台，不更改已有会话。"),
                row("defaultForegroundModel", "新游戏默认前台模型", "留空采用 DSH 默认", config.defaults.defaultForegroundModel, "new-games", "使用 DSH 默认模型"),
                row("defaultBackgroundModel", "新游戏默认后台模型", "留空跟随新游戏前台", config.defaults.defaultBackgroundModel, "new-games", "跟随前台"),
                row("defaultWorkbenchModel", "新工作台默认模型", "人物卡创建与编辑", config.defaults.defaultWorkbenchModel, "new-games", "跟随前台"),
                h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy || !config.foregroundModel,
                    onClick: () => save(Object.fromEntries(["defaultForegroundModel", "defaultBackgroundModel", "defaultWorkbenchModel"].map(name => [name, config.foregroundModel])), "new-games") }, "新游戏与工作台统一使用当前前台模型"))) : h("p", { role: "status" }, "正在读取模型设置…"),
        error ? h("p", { role: "alert" }, error) : h("p", { role: "status" }, busy ? "正在保存模型设置…" : notice),
        error ? h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy, onClick: load }, "刷新模型设置") : null);
}


// A named public composer seat: show exact-model levels, including the default-only case.
function TavernComposerReasoning(props) {
    const h = React.createElement;
    const sessionId = props.sessionId || "";
    const binding = props.sessions?.binding(sessionId);
    const face = binding?.session.projections.faceOf("modelSelection") || EMPTY_PROJECTION_FACE;
    const native = React.useSyncExternalStore(fn => face.subscribe(fn), () => face.getSnapshot(), () => face.getSnapshot());
    const nativeKey = JSON.stringify(native);
    const [state, setState] = React.useState(null), [saving, setSaving] = React.useState(false), [error, setError] = React.useState("");
    const generation = React.useRef(0), savePending = React.useRef(false);
    const background = Boolean(props.sessions?.subagentAddress(sessionId));
    React.useEffect(() => {
        const version = ++generation.current;
        savePending.current = false; setSaving(false); setError(""); setState(null);
        if (!sessionId || background) return;
        rpc("getConversationReasoningConfig", { sessionId }, sessionId).then(result => {
            if (version === generation.current) setState({ ...result, nativeKey });
        }, failure => { if (version === generation.current) setError(String(failure.message || failure)); });
        return () => { ++generation.current; };
    }, [sessionId, nativeKey, background]);
    async function change(value) {
        if (savePending.current || !state?.selection || state.nativeKey !== nativeKey) return;
        const version = generation.current;
        savePending.current = true; setSaving(true); setError("");
        const selection = { provider: state.selection.provider, model: state.selection.model, ...(value ? { reasoningEffort: value } : {}) };
        try {
            const result = await rpc("setConversationModelConfig", { sessionId, models: { foregroundModel: selection } }, sessionId);
            if (version === generation.current) setState(current => ({ ...current, selection: result.foregroundModel }));
        } catch (failure) { if (version === generation.current) setError(String(failure.message || failure)); }
        finally { if (version === generation.current) { savePending.current = false; setSaving(false); } }
    }
    if (background || !sessionId || (!state?.selection && !error)) return null;
    const efforts = state?.reasoning?.efforts || [];
    const selected = efforts.some(item => item.id === state?.selection?.reasoningEffort) ? state.selection.reasoningEffort : "";
    const help = error || (efforts.length ? "设置本局前台模型的推理强度，下一次请求生效。" : "此供应商未提供可调推理档位，使用模型默认；不代表模型没有推理能力。");
    return h("label", { className: "dsh-composer-reasoning", title: help },
        h("span", null, "强度"),
        h("select", { "aria-label": "本局模型推理强度", disabled: saving || !efforts.length || state?.nativeKey !== nativeKey, value: selected, onChange: event => change(event.target.value) },
            h("option", { value: "" }, efforts.length ? "模型默认" : "模型默认 · 未提供档位"),
            efforts.map(item => h("option", { key: item.id, value: item.id }, item.name || item.id))),
        error ? h("span", { role: "alert", className: "dsh-composer-reasoning-error" }, error) : null);
}
