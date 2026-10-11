function TavernPresetSettings(props) {
    const h = React.createElement;
    const [settings, setSettings] = React.useState(null), [drafts, setDrafts] = React.useState({});
    const [busy, setBusy] = React.useState(false), [notice, setNotice] = React.useState("");
    const [error, setError] = React.useState("");
    React.useEffect(function () {
        let active = true;
        setSettings(null); setDrafts({}); setNotice(""); setError("");
        rpc("getConversationPresetSettings", {}, props.sessionId).then(result => {
            if (active) setSettings(result.settings);
        }, error => { if (active) setError(String(error.message || error)); });
        return () => { active = false; };
    }, [props.sessionId, props.revision]);
    function patch(kind, item, change) {
        setDrafts(current => ({ ...current, [kind + ":" + item.key]: { ...item, ...current[kind + ":" + item.key], ...change } }));
    }
    async function save() {
        if (busy || !settings) return;
        setBusy(true); setError(""); setNotice("");
        const changes = { entries: [], regexScripts: [] };
        for (const [key, value] of Object.entries(drafts)) {
            const kind = key.startsWith("entries:") ? "entries" : "regexScripts";
            changes[kind].push({ key: value.key, enabled: value.enabled, ...(kind === "entries" ? { content: value.content } : {}) });
        }
        try {
            const result = await rpc("updateConversationPresetSettings", { digest: settings.digest, changes }, props.sessionId);
            setSettings(result.settings); setDrafts({}); setNotice("已保存到本局，从下一回合生效");
            liveTavernView.invalidate(props.sessionId);
            notifyTavernDataChanged(["sessions"], "preset-settings");
        } catch (error) { setError(String(error.message || error)); }
        finally { setBusy(false); }
    }
    function group(entry) {
        if (/角色|信息差|剧情|思维|分析|思考|叙事者/.test(entry.name)) return "剧情理解与角色";
        if (/文风|视角|字数|长篇|转述|禁词|叙事|写作/.test(entry.name)) return "文风与叙事";
        if (/格式|场景|平行|修复|修正|输出/.test(entry.name)) return "格式与修订";
        return "其他写作规则";
    }
    function row(kind, item) {
        const value = drafts[kind + ":" + item.key] || item;
        return h("details", { key: item.key, className: "dsh-tavern-preset-setting-row" },
            h("summary", null, item.name + " · " + (value.enabled ? "启用" : "关闭") + (item.layer ? " · " + item.layer : "")),
            h("label", null, h("input", { type: "checkbox", checked: value.enabled, disabled: busy,
                "aria-label": "启用 " + item.name, onChange: event => patch(kind, item, { enabled: event.target.checked }) }), "启用该规则"),
            item.execution ? h("p", { className: "dsh-tavern-settings-desc" }, item.execution) : null,
            kind === "entries" ? h("label", null, "本局规则内容", h("textarea", { rows: 8, maxLength: 100000, readOnly: item.editableContent === false,
                className: "dsh-tavern-preset-entry-editor", "aria-label": item.name + "规则内容", value: value.content,
                disabled: busy, onChange: event => patch(kind, item, { content: event.target.value }) })) : null);
    }
    return h("section", { "aria-label": "预设功能设置", className: "dsh-local-field" },
        h("h3", null, "预设功能设置"),
        h("p", { className: "dsh-tavern-settings-desc" }, "本局的文风、剧情分析和格式规则会进入 Agent 请求。展开规则可查看原文或修改；保存仅影响本局。"),
        settings ? h(React.Fragment, null,
            h("p", null, settings.presetName || "本局没有引用酒馆预设"),
            ["剧情理解与角色", "文风与叙事", "格式与修订", "其他写作规则"].map(name => {
                const items = settings.entries.filter(item => group(item) === name);
                return items.length ? h("details", { key: name }, h("summary", null, name + "（" + items.filter(item => (drafts["entries:" + item.key] || item).enabled).length + "/" + items.length + "）"), items.map(item => row("entries", item))) : null;
            }),
            settings.regexScripts.length ? h("details", null, h("summary", null, "正则与渲染（" + settings.regexScripts.length + "）"), settings.regexScripts.map(item => row("regexScripts", item))) : null,
            settings.helperScripts.length ? h("details", null, h("summary", null, "预设脚本与 Agent 接管"), settings.helperScripts.map((script, index) => h("p", { key: index }, script.name + "：" + (script.configured ? "原配置启用；" : "原配置关闭；") + script.execution))) : null,
            h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy || !Object.keys(drafts).length, onClick: save }, busy ? "保存中…" : "保存本局预设设置"),
            h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy || !Object.keys(drafts).length, onClick: () => setDrafts({}) }, "撤销未保存修改")) : h("p", null, "正在读取本局预设…"),
        error ? h("p", { role: "alert" }, error) : h("p", { role: "status" }, notice));
}

function TavernReturnToStory(props) {
    const address = props.sessions.subagentAddress(props.sessionId);
    if (!address?.parentSessionId) return null;
    return React.createElement("button", { type: "button", className: "dsh-tavern-btn",
        title: "回到本局前台剧情对话后输入和发送", onClick: () => {
            try { props.sessions.open(address.parentSessionId); }
            catch (error) { tavernErrorHub.report("返回剧情对话", error); }
        } }, "返回剧情对话");
}
