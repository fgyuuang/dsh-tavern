// Settings owns its initial snapshot; each editor saves only its own resource.
function createGlobalSettingsModule({ React, rpc, notifySettingsChanged, PresetConfigurationSettings, TavernPresetSettings, TavernDefaultModelSetting, TavernConversationWritingSkills, DisplayPreferencesSettings, CandidatePreferencesSettings, PromptTemplateSettingsEntry, ContextCompactionSettings, SceneImageSettings }) {
    function GlobalPlayDefaults({ settings }) {
        const h = React.createElement;
        const [data, setData] = React.useState(null), [busy, setBusy] = React.useState(false), [message, setMessage] = React.useState("");
        React.useEffect(() => {
            let active = true;
            Promise.all([rpc("listPresets"), rpc("getUserPreferenceProfile", { globalDefaults: true })]).then(([presets, profile]) => {
                if (active) setData({ ...settings.defaultPlaySettings, presets: presets.presets || [], preset: presets.activePresetPath || "", profile: profile.userProfile });
            }, err => { if (active) setMessage("读取失败：" + err.message); });
            return () => { active = false; };
        }, []);
        async function save(patch, method, args) {
            setBusy(true); setMessage("");
            try {
                const result = await rpc(method || "updateTavernSettings", args || { patch: { defaultPlaySettings: patch } });
                if (method === "selectPreset") setData(current => ({ ...current, preset: args.path }));
                else if (method === "manageUserPreferenceProfile") {
                    const profile = await rpc("getUserPreferenceProfile", { globalDefaults: true });
                    setData(current => ({ ...current, profile: profile.userProfile }));
                } else setData(current => ({ ...current, ...result.settings.defaultPlaySettings }));
                setMessage("已保存，新游戏继承此设置，已有游戏保持不变。");
            } catch (err) { setMessage("保存失败：" + err.message); }
            finally { setBusy(false); }
        }
        const disabled = !data || busy;
        function toggle(key, title, help, task) {
            return h("label", { key, className: "dsh-tavern-settings-row dsh-tavern-background-task" },
                h("span", { className: "dsh-tavern-settings-copy" }, h("strong", { className: "dsh-tavern-settings-title" }, title), h("span", { className: "dsh-tavern-settings-desc" }, help)),
                h("input", { type: "checkbox", role: "switch", "aria-label": title, disabled, checked: task ? data?.backgroundTasks[key] === true : data?.[key] === true, onChange: event => save(task ? { backgroundTasks: { [key]: event.target.checked } } : { [key]: event.target.checked }) }));
        }
        return h("div", { className: "dsh-tavern-settings-section dsh-local-settings dsh-tavern-global-defaults" },
            h("section", { className: "dsh-local-section" }, h("h3", null, "基本信息"),
                h("label", { className: "dsh-local-field" }, "默认玩家称呼", h("input", { key: data?.playerName, defaultValue: data?.playerName || "", disabled, maxLength: 80, onBlur: event => { if (event.target.value !== data.playerName) save({ playerName: event.target.value }); } })),
                h("label", { className: "dsh-local-field" }, "默认状态栏位置", h("select", { disabled, value: data?.statusBarPlacement || "sidebar", onChange: event => save({ statusBarPlacement: event.target.value }) }, h("option", { value: "sidebar" }, "侧边栏"), h("option", { value: "body" }, "正文下方"))),
                h("label", { className: "dsh-local-field" }, "默认预设", h("select", { disabled, value: data?.preset || "", onChange: event => save(null, "selectPreset", { path: event.target.value }) }, h("option", { value: "" }, "不使用外部预设"), (data?.presets || []).filter(item => item.valid && item.recognized).map(item => h("option", { key: item.path, value: item.path }, item.title)))),
                h("label", { className: "dsh-local-field" }, "默认长期偏好", h("select", { disabled, value: data?.profile.defaultProfileId || "", onChange: event => save(null, "manageUserPreferenceProfile", { action: "default", profileId: event.target.value }) }, h("option", { value: "" }, "不启用"), (data?.profile.profiles || []).filter(item => item.hasConfirmed).map(item => h("option", { key: item.id, value: item.id }, item.name))))),
            h("section", { className: "dsh-local-section" }, h("h3", null, "后台结算"),
                toggle("variables", "变量结算", "MVU 卡建议开启；普通卡不执行此任务。", true), toggle("posture", "人物姿势结算", "总结本轮结束时人物的位置、动作和姿势。", true), toggle("variableFeedback", "变量回灌前台", "每轮把上一轮变化的变量最新值告诉前台，减少前后不一致。", true)),
            h("section", { className: "dsh-local-section" }, h("h3", null, "扩展功能"),
                toggle("webSearchEnabled", "联网搜索", "允许新游戏的前台和后台按需搜索。")),
            message ? h("p", { role: "status" }, message) : null);
    }

    function AgentPresetSettingsSection() {
        const h = React.createElement;
        const [catalog, setCatalog] = React.useState(null), [presetId, setPresetId] = React.useState("");
        const [data, setData] = React.useState(null), [busy, setBusy] = React.useState(false), [notice, setNotice] = React.useState(""), [error, setError] = React.useState("");
        React.useEffect(() => {
            let active = true;
            rpc("listPlayPresets").then(result => { if (active) { setCatalog(result); setPresetId(result.defaultPlayPresetId || "tavern"); } }, err => { if (active) setError(err.message); });
            return () => { active = false; };
        }, []);
        React.useEffect(() => {
            if (!presetId) return;
            let active = true;
            setData(null); setError(""); setNotice("");
            rpc("getGlobalAgentPresetSettings", { presetId }).then(result => { if (active) setData(result); }, err => { if (active) setError(err.message); });
            return () => { active = false; };
        }, [presetId]);
        async function save(patch) {
            if (!data || busy) return;
            setBusy(true); setError(""); setNotice("");
            try { const result = await rpc("updateGlobalAgentPresetSettings", { presetId, revision: data.settings.globalRevision, ...patch }); setData(result); setNotice("已永久保存，新游戏自动继承。"); notifySettingsChanged(); }
            catch (err) { setError(err.message); } finally { setBusy(false); }
        }
        async function makeDefault() {
            if (busy) return;
            setBusy(true); setError("");
            try { const result = await rpc("setDefaultPlayPreset", { presetId }); setCatalog(current => ({ ...current, defaultPlayPresetId: result.defaultPlayPresetId })); setNotice("已设为全局默认 Agent 预设，重启后仍有效。"); notifySettingsChanged(); }
            catch (err) { setError(err.message); } finally { setBusy(false); }
        }
        const disabled = !data || busy;
        const selected = catalog?.presets?.find(item => item.id === presetId);
        return h("div", { className: "dsh-tavern-settings-section dsh-tavern-global-settings dsh-agent-global-presets" },
            h("header", { className: "dsh-tavern-gs-head" }, h("h2", null, "Agent 预设"), h("p", null, "为每一种玩法维护永久的默认配置。新游戏继承完整作者选项、回复方式与调用预算。")),
            h("section", { className: "dsh-tavern-gs-card dsh-local-settings" },
                h("label", { className: "dsh-local-field" }, "编辑 Agent 预设", h("select", { "aria-label": "编辑全局 Agent 预设", className: "dsh-tavern-settings-select", disabled: !catalog || busy, value: presetId, onChange: event => setPresetId(event.target.value) },
                    (catalog?.presets || []).map(item => h("option", { key: item.id, value: item.id }, item.name + (item.id === catalog.defaultPlayPresetId ? " · 全局默认" : ""))))),
                h("p", { className: "dsh-local-help" }, selected?.description),
                h("button", { type: "button", className: "dsh-tavern-question-primary", disabled: disabled || presetId === catalog?.defaultPlayPresetId, onClick: makeDefault }, presetId === catalog?.defaultPlayPresetId ? "当前全局默认" : "设为全局默认 Agent 预设"),
                h("label", { className: "dsh-local-field" }, "默认回复方式", h("select", { "aria-label": "Agent 默认回复方式", className: "dsh-tavern-settings-select", disabled, value: data?.generationMode || "agent", onChange: event => save({ generationMode: event.target.value }) },
                    h("option", { value: "agent" }, "DSH Agent"), h("option", { value: "sillytavern-once" }, "原版酒馆 · 单次回复"))),
                ["dream-sike-dsh", "hushen-dsh"].includes(presetId) ? h("div", null, [["queryRequests", "默认写前查询次数", [1, 2]], ["revisionRequests", "默认正文修订次数", [0, 1, 2]]].map(([key, title, values]) => h("label", { key, className: "dsh-local-field" }, title,
                    h("select", { "aria-label": title, className: "dsh-tavern-settings-select", disabled, value: data?.executionPolicy?.[key] ?? 1, onChange: event => save({ executionPolicy: { ...data.executionPolicy, [key]: Number(event.target.value) } }) }, values.map(value => h("option", { key: value, value }, value + " 次")))))) : null,
                error ? h("p", { role: "alert" }, error) : h("p", { role: "status" }, notice || (!data ? "正在读取默认配置…" : "每个选项保存后立即写入持久目录。已有游戏可继续保留各局配置。"))),
            presetId && data ? h(TavernPresetSettings, { key: presetId + ":" + data.generationMode, globalDefaults: true, presetId, revision: presetId, globalRevision: data.settings.globalRevision, onSaved: setData }) : null);
    }

    function TavernSettingsSection() {
        const [state, setState] = React.useState({ loading: true, busy: false, defaultForegroundModel: null, defaultBackgroundModel: null, defaultWorkbenchModel: null, defaultImageModel: null, sceneImages: false, notice: "", settings: null, modelCatalog: [], error: "" });
        React.useEffect(function () {
            let active = true;
            rpc("getTavernSettings").then(function (result) {
                if (active) setState({ loading: false, busy: false, defaultForegroundModel: result.settings?.defaultForegroundModel || null, defaultBackgroundModel: result.settings?.defaultBackgroundModel || null, defaultWorkbenchModel: result.settings?.defaultWorkbenchModel || null, defaultImageModel: result.settings?.defaultImageModel || null, sceneImages: Boolean(result.releaseCapabilities && result.releaseCapabilities.sceneImages), notice: "", settings: result.settings, modelCatalog: Array.isArray(result.modelCatalog) ? result.modelCatalog : [], error: "" });
            }, function (error) {
                if (active) setState(function (current) { return Object.assign({}, current, { loading: false, busy: false, error: String(error && error.message || error) }); });
            });
            return function () { active = false; };
        }, []);
        async function saveDefault(name, selection) {
            if (state.loading || state.busy) return;
            setState(current => ({ ...current, busy: true, error: "", notice: "" }));
            try {
                const result = await rpc("updateTavernSettings", { patch: { [name]: selection } });
                notifySettingsChanged();
                setState(current => ({ ...current, [name]: result.settings[name], busy: false, notice: name === "defaultWorkbenchModel" ? "已保存，下次新建工作台对话生效" : "已保存，下次新游戏生效" }));
            } catch (err) { setState(current => ({ ...current, busy: false, error: String(err.message || err) })); }
        }
        const h = React.createElement;
        function group(title, desc, ...children) {
            return h("section", { className: "dsh-tavern-gs-group", "aria-label": title },
                h("header", { className: "dsh-tavern-gs-head" }, h("h2", null, title), desc ? h("p", null, desc) : null),
                ...children);
        }
        return h("div", { className: "dsh-tavern-settings-section dsh-tavern-global-settings" },
            group("已有游戏预设", "逐局调整已有游戏。新游戏的永久默认配置请使用独立的“Agent 预设”设置页。",
                h(PresetConfigurationSettings)),
            group("默认模型", "用于新游戏和新的卡片工作台对话，已有对话保持当前配置。建议使用 High 推理强度；Max 容易过度思考、增加等待。",
            h("div", { className: "dsh-tavern-gs-card" },
            React.createElement(TavernDefaultModelSetting, { label: "默认前台模型", title: "前台模型", description: "写正文、扮演角色，直接决定剧情质量", fallback: "使用 DSH 默认模型", selection: state.defaultForegroundModel, catalog: state.modelCatalog, disabled: state.loading || state.busy, onChange: selection => saveDefault("defaultForegroundModel", selection) }),
            React.createElement(TavernDefaultModelSetting, { label: "默认后台模型", title: "后台模型", description: "变量结算、世界书筛选、候选回复、手机消息等幕后任务", fallback: "跟随前台", selection: state.defaultBackgroundModel, catalog: state.modelCatalog, disabled: state.loading || state.busy, onChange: selection => saveDefault("defaultBackgroundModel", selection) }),
            React.createElement(TavernDefaultModelSetting, { label: "卡片工作台默认模型", title: "工作台模型", description: "卡片工作台里创建和修改人物卡", fallback: "跟随前台", selection: state.defaultWorkbenchModel, catalog: state.modelCatalog, disabled: state.loading || state.busy, onChange: selection => saveDefault("defaultWorkbenchModel", selection) }),
            state.sceneImages ? React.createElement(TavernDefaultModelSetting, { label: "生图 Agent 默认模型", title: "生图 Agent 模型", description: "为剧情插图整理画面、写绘图提示词；跟随前台时使用最低推理强度，出图更快", fallback: "跟随前台", selection: state.defaultImageModel, catalog: state.modelCatalog, disabled: state.loading || state.busy, onChange: selection => saveDefault("defaultImageModel", selection) }) : null),
            state.notice ? h("p", { className: "dsh-tavern-gs-notice", role: "status" }, state.notice) : null),
            group("新游戏默认", "开局时继承，开局后可在本局设置中单独修改。",
                state.settings ? h(GlobalPlayDefaults, { settings: state.settings }) : null,
                h(TavernConversationWritingSkills, { globalDefaults: true })),
            group("显示与交互", "",
                h(DisplayPreferencesSettings),
                h(CandidatePreferencesSettings)),
            group("高级", "",
                h(PromptTemplateSettingsEntry),
                h(ContextCompactionSettings)),
            state.error ? React.createElement("div", { className: "dsh-tavern-settings-error", role: "alert" }, "保存失败：" + state.error) : null
        );
    }

    return { TavernSettingsSection, AgentPresetSettingsSection };
}
