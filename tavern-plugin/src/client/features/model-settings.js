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
            row("imageModel", "本局生图 Agent 模型", "整理插图方案与绘图提示词；留空沿用前台模型", config.imageModel, "conversation", "跟随前台"),
            h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy || config.busy || !config.foregroundModel,
                onClick: () => save({ foregroundModel: config.foregroundModel, backgroundModel: config.foregroundModel }) }, "前后台统一使用当前前台模型"),
            h("p", { className: "dsh-local-help" }, "平行事件、独立审稿、后续互动、变量结算共用本局后台：" + (backgroundModelLabel(config.effectiveBackgroundModel, config.modelCatalog) || "尚未配置")),
            config.busy ? h("p", { role: "status" }, "前后台有任务运行，完成后可调整本局模型。", h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy, onClick: load }, "刷新状态")) : null,
            h("details", { className: "dsh-tavern-default-skills" }, h("summary", null, "新游戏与卡片工作台默认模型"),
                h("p", { className: "dsh-local-help" }, "仅用于之后创建的游戏或工作台，不更改已有会话。"),
                row("defaultForegroundModel", "新游戏默认前台模型", "留空采用 DSH 默认", config.defaults.defaultForegroundModel, "new-games", "使用 DSH 默认模型"),
                row("defaultBackgroundModel", "新游戏默认后台模型", "留空跟随新游戏前台", config.defaults.defaultBackgroundModel, "new-games", "跟随前台"),
                row("defaultWorkbenchModel", "新工作台默认模型", "人物卡创建与编辑", config.defaults.defaultWorkbenchModel, "new-games", "跟随前台"),
                row("defaultImageModel", "新游戏默认生图 Agent 模型", "整理插图方案与绘图提示词", config.defaults.defaultImageModel, "new-games", "跟随前台"),
                h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy || !config.foregroundModel,
                    onClick: () => save(Object.fromEntries(["defaultForegroundModel", "defaultBackgroundModel", "defaultWorkbenchModel", "defaultImageModel"].map(name => [name, config.foregroundModel])), "new-games") }, "新游戏与工作台统一使用当前前台模型"))) : h("p", { role: "status" }, "正在读取模型设置…"),
        error ? h("p", { role: "alert" }, error) : h("p", { role: "status" }, busy ? "正在保存模型设置…" : notice),
        error ? h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy, onClick: load }, "刷新模型设置") : null);
}
