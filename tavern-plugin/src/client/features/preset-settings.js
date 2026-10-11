function TavernPresetSettings(props) {
    const h = React.createElement;
    const [settings, setSettings] = React.useState(null), [drafts, setDrafts] = React.useState({});
    const [busy, setBusy] = React.useState(false), [notice, setNotice] = React.useState("");
    const [error, setError] = React.useState("");
    const [variableDrafts, setVariableDrafts] = React.useState({});
    const context = React.useRef({ sessionId: props.sessionId, revision: props.revision, generation: 0 });
    const saving = React.useRef(false);
    context.current.sessionId = props.sessionId;
    context.current.revision = props.revision;
    React.useEffect(function () {
        let active = true;
        context.current.generation += 1;
        saving.current = false;
        setSettings(null); setDrafts({}); setVariableDrafts({}); setBusy(false); setNotice(""); setError("");
        rpc("getConversationPresetSettings", {}, props.sessionId).then(result => {
            if (active) setSettings(result.settings);
        }, error => { if (active) setError(String(error.message || error)); });
        return () => { active = false; context.current.generation += 1; };
    }, [props.sessionId, props.revision]);
    function patch(kind, item, change) {
        setDrafts(current => ({ ...current, [kind + ":" + item.key]: { ...item, ...current[kind + ":" + item.key], ...change } }));
    }
    async function submit(changes) {
        if (saving.current || !settings) return;
        const request = { ...context.current };
        function isCurrent() {
            return request.sessionId === context.current.sessionId && request.revision === context.current.revision && request.generation === context.current.generation;
        }
        saving.current = true;
        setBusy(true); setError(""); setNotice("");
        try {
            const result = await rpc("updateConversationPresetSettings", { digest: settings.digest, changes }, request.sessionId);
            if (!isCurrent()) return;
            setSettings(result.settings); setDrafts({}); setNotice("已保存到本局，从下一回合生效");
            if (changes.sourceAction?.value !== undefined) setVariableDrafts(current => {
                const next = { ...current };
                delete next[changes.sourceAction.groupId + ":" + changes.sourceAction.optionId];
                return next;
            });
            liveTavernView.invalidate(request.sessionId);
            notifyTavernDataChanged(["sessions"], "preset-settings");
        } catch (error) { if (isCurrent()) setError(String(error.message || error)); }
        finally { if (isCurrent()) { saving.current = false; setBusy(false); } }
    }
    function save() {
        if (busy || !settings) return;
        const changes = { entries: [], regexScripts: [] };
        for (const [key, value] of Object.entries(drafts)) {
            const kind = key.startsWith("entries:") ? "entries" : "regexScripts";
            changes[kind].push({ key: value.key, enabled: value.enabled, ...(kind === "entries" ? { content: value.content } : {}) });
        }
        return submit(changes);
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
    const hasDrafts = Object.keys(drafts).length > 0;
    function compatibility(item) {
        const value = item.compatibility;
        return value ? h("p", { className: "dsh-tavern-settings-desc", "data-compatibility": value.status },
            value.label || value.status, value.reason ? "：" + value.reason : "") : null;
    }
    function sourceGroup(source) {
        const multiple = source.mode === "multiple" || source.mode === "checkbox";
        return h("fieldset", { key: source.id, className: "dsh-local-field", "data-source-group": source.id },
            h("legend", null, source.label),
            (source.options || []).map(option => h("div", { key: option.id, className: "dsh-tavern-preset-setting-row" },
                h("label", null, h("input", {
                    type: multiple ? "checkbox" : "radio", name: "preset-source-" + props.sessionId + "-" + source.id,
                    checked: !!option.enabled, disabled: busy || hasDrafts || option.available === false,
                    "aria-label": source.label + "：" + option.label,
                    onChange: event => {
                        if (hasDrafts || option.available === false) return;
                        submit({ sourceAction: { groupId: source.id, optionId: option.id, enabled: event.target.checked } });
                    }
                }), " " + option.label),
                option.description ? h("p", { className: "dsh-tavern-settings-desc" }, option.description) : null,
                h("small", null, option.status === "unmatched" ? "未匹配原预设条目" : option.enabled ? "已开启" : "未开启"),
                compatibility(option),
                (option.prompts || []).length ? h("details", null,
                    h("summary", null, "来源提示词原文（" + option.prompts.length + "）"),
                    option.prompts.map(prompt => h("div", { key: prompt.key },
                        h("p", null, prompt.name + " · " + (prompt.enabled ? "启用" : "关闭")),
                        h("textarea", { className: "dsh-tavern-preset-entry-editor", rows: 6, readOnly: true,
                            "aria-label": source.label + "：" + option.label + "：" + prompt.name + "原文", value: prompt.content || "" })))) : null)),
            (source.variableInputs || []).map(input => {
                const key = source.id + ":" + input.id;
                const value = Object.prototype.hasOwnProperty.call(variableDrafts, key) ? variableDrafts[key] : String(input.value == null ? "" : input.value);
                return h("div", { key: input.id, className: "dsh-tavern-preset-setting-row" },
                    h("label", null, input.label, h("input", { type: "text", value, maxLength: 100000,
                        "aria-label": source.label + "：" + input.label,
                        disabled: busy || hasDrafts || input.available === false,
                        onChange: event => setVariableDrafts(current => ({ ...current, [key]: event.target.value })) })),
                    input.description ? h("p", { className: "dsh-tavern-settings-desc" }, input.description) : null,
                    h("small", null, input.scope === "global" ? "原全局变量 · 本局覆盖" : "本局变量"),
                    compatibility(input),
                    h("button", { type: "button", className: "dsh-tavern-btn",
                        disabled: busy || hasDrafts || input.available === false || value === String(input.value == null ? "" : input.value),
                        onClick: () => submit({ sourceAction: { groupId: source.id, optionId: input.id, value } }) }, "应用" + input.label));
            }));
    }
    function advanced() {
        return h(React.Fragment, null,
            ["剧情理解与角色", "文风与叙事", "格式与修订", "其他写作规则"].map(name => {
                const items = settings.entries.filter(item => group(item) === name);
                return items.length ? h("details", { key: name }, h("summary", null, name + "（" + items.filter(item => (drafts["entries:" + item.key] || item).enabled).length + "/" + items.length + "）"), items.map(item => row("entries", item))) : null;
            }),
            settings.regexScripts.length ? h("details", null, h("summary", null, "正则与渲染（" + settings.regexScripts.length + "）"), settings.regexScripts.map(item => row("regexScripts", item))) : null,
            settings.helperScripts.length ? h("details", null, h("summary", null, "预设脚本与 Agent 接管"), settings.helperScripts.map((script, index) => h("p", { key: index }, script.name + "：" + (script.configured ? "原配置启用；" : "原配置关闭；") + script.execution))) : null,
            h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy || !hasDrafts, onClick: save }, busy ? "保存中…" : "保存本局预设设置"),
            h("button", { type: "button", className: "dsh-tavern-btn", disabled: busy || !hasDrafts, onClick: () => setDrafts({}) }, "撤销未保存修改"));
    }
    return h("section", { "aria-label": "预设功能设置", className: "dsh-local-field" },
        h("h3", null, "预设功能设置"),
        h("p", { className: "dsh-tavern-settings-desc" }, settings?.sourceSettings ? "按原预设助手分组选取功能，选择后立即保存，从下一回合生效。展开来源提示词可查看原文；迁移状态显示各功能的实际支持情况。" : "本局的文风、剧情分析和格式规则会进入 Agent 请求。展开规则可查看原文或修改；保存仅影响本局。"),
        settings ? h(React.Fragment, null,
            h("p", null, settings.presetName || "本局没有引用酒馆预设"),
            settings.sourceSettings ? h(React.Fragment, null,
                h("h4", null, settings.sourceSettings.title || "原预设助手设置"),
                settings.sourceSettings.description ? h("p", { className: "dsh-tavern-settings-desc" }, settings.sourceSettings.description) : null,
                (settings.sourceSettings.errors || []).map((item, index) => h("p", { key: index, role: "alert" }, typeof item === "string" ? item : item.message || String(item))),
                hasDrafts ? h("p", { role: "status" }, "高级设置有未保存修改，请先保存或撤销，再切换原预设功能。") : null,
                (settings.sourceSettings.groups || []).map(sourceGroup),
                h("details", null, h("summary", null, "高级设置：规则、正则与脚本"), advanced())) : advanced()) : h("p", null, "正在读取本局预设…"),
        error ? h("p", { role: "alert" }, error) : h("p", { role: "status" }, busy ? "正在保存本局预设设置…" : notice));
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
