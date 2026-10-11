function TavernPresetSettings(props) {
    const h = React.createElement;
    const [settings, setSettings] = React.useState(null), [drafts, setDrafts] = React.useState({});
    const [busy, setBusy] = React.useState(false), [notice, setNotice] = React.useState("");
    const [error, setError] = React.useState("");
    const [variableDrafts, setVariableDrafts] = React.useState({});
    const [stageId, setStageId] = React.useState("role-scene"), [query, setQuery] = React.useState("");
    const [sourceDrawer, setSourceDrawer] = React.useState(null);
    const drawerElement = React.useRef(null), drawerTrigger = React.useRef(null);
    const context = React.useRef({ sessionId: props.sessionId, revision: props.revision, generation: 0 });
    const saving = React.useRef(false);
    context.current.sessionId = props.sessionId;
    context.current.revision = props.revision;
    React.useEffect(function () {
        let active = true;
        context.current.generation += 1;
        saving.current = false;
        setSettings(null); setDrafts({}); setVariableDrafts({}); setBusy(false); setNotice(""); setError(""); setSourceDrawer(null);
        rpc("getConversationPresetSettings", {}, props.sessionId).then(result => {
            if (active) setSettings(result.settings);
        }, error => { if (active) setError(String(error.message || error)); });
        return () => { active = false; context.current.generation += 1; };
    }, [props.sessionId, props.revision]);
    React.useEffect(function () {
        if (!sourceDrawer) return;
        if (drawerElement.current && !drawerElement.current.open) drawerElement.current.showModal();
        drawerElement.current?.querySelector("button")?.focus();
        return () => { drawerTrigger.current?.focus(); };
    }, [sourceDrawer]);
    function openSource(event, target) {
        drawerTrigger.current = event.currentTarget;
        setSourceDrawer(target || {});
    }
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
    function compatibility(item, includeSupported) {
        const value = item.compatibility;
        if (value?.status === "supported" && !includeSupported) return null;
        return value ? h("details", { className: "dsh-agent-preset-compat", "data-compatibility": value.status },
            h("summary", null, value.label || value.status), h("p", null, value.reason || "")) : null;
    }
    function sourceGroup(source) {
        const multiple = source.mode === "multiple" || source.mode === "checkbox";
        const selected = (source.options || []).find(option => option.enabled);
        return h("section", { key: source.id, className: "dsh-agent-preset-group", "data-source-group": source.id },
            h("div", { className: "dsh-agent-preset-group-heading" }, h("h4", null, source.label),
                h("button", { type: "button", className: "dsh-agent-preset-link", "aria-label": "查看" + source.label + "原文",
                    onClick: event => openSource(event, { groupId: source.id }) }, "来源原文")),
            source.description ? h("p", { className: "dsh-tavern-settings-desc" }, source.description) : null,
            multiple ? h("div", { className: "dsh-agent-preset-options" }, (source.options || []).map(option =>
                h("div", { key: option.id, className: "dsh-agent-preset-option", "data-source-option": option.id },
                    h("label", { className: "dsh-agent-preset-switch-row" }, h("span", null, option.label), h("input", {
                        type: "checkbox", role: "switch", checked: !!option.enabled,
                        disabled: busy || hasDrafts || option.available === false,
                        "aria-label": source.label + "：" + option.label,
                        onChange: event => submit({ sourceAction: { groupId: source.id, optionId: option.id, enabled: event.target.checked } }) })),
                    option.description ? h("p", { className: "dsh-tavern-settings-desc" }, option.description) : null,
                    compatibility(option)))) : h(React.Fragment, null,
                h("select", { value: selected?.id || "", disabled: busy || hasDrafts, "aria-label": source.label,
                    onChange: event => { if (event.target.value) submit({ sourceAction: { groupId: source.id, optionId: event.target.value, enabled: true } }); } },
                    h("option", { value: "", disabled: true }, "请选择" + source.label),
                    (source.options || []).map(option => h("option", { key: option.id, value: option.id, disabled: option.available === false,
                        "data-source-option": option.id }, option.label + (option.available === false ? "（不可用）" : "")))),
                selected?.description ? h("p", { className: "dsh-tavern-settings-desc" }, selected.description) : null,
                selected ? compatibility(selected) : null),
            (source.variableInputs || []).map(input => {
                const key = source.id + ":" + input.id;
                const value = Object.prototype.hasOwnProperty.call(variableDrafts, key) ? variableDrafts[key] : String(input.value == null ? "" : input.value);
                return h("div", { key: input.id, className: "dsh-agent-preset-variable", "data-source-variable": input.id },
                    h("label", null, input.label, h("input", { type: "text", value, maxLength: 10000,
                        "aria-label": source.label + "：" + input.label,
                        disabled: busy || hasDrafts || input.available === false,
                        onChange: event => setVariableDrafts(current => ({ ...current, [key]: event.target.value })) })),
                    input.description || input.compatibility?.reason ? h("details", { className: "dsh-agent-preset-help" }, h("summary", null, "用法说明"),
                        input.description ? h("p", null, input.description) : null,
                        input.compatibility?.reason ? h("p", null, input.compatibility.reason) : null) : null,
                    h("small", null, "保存到本局"),
                    compatibility(input),
                    h("button", { type: "button", className: "dsh-tavern-btn",
                        disabled: busy || hasDrafts || input.available === false || value === String(input.value == null ? "" : input.value),
                        onClick: () => submit({ sourceAction: { groupId: source.id, optionId: input.id, value } }) }, "应用" + input.label));
            }));
    }
    function stages() {
        const groups = settings.sourceSettings.groups || [];
        const defaults = [
            { id: "role-scene", label: "角色与场景", groupIds: ["角色设定", "人称设定"] },
            { id: "narration", label: "叙事与文风", groupIds: ["文风设置", "次要文风", "叙事者", "字数要求"] },
            { id: "planning", label: "思考与检索", groupIds: ["思考强度", "角色分析"] },
            { id: "output", label: "输出与共创", groupIds: ["抢话设定", "输出模式"] },
            { id: "review-state", label: "审稿与状态", groupIds: ["MVU适配", "其他选开设置"] },
            { id: "model", label: "模型与兼容", groupIds: ["模型适配"] }
        ];
        const provided = settings.agentPreset?.stages;
        const result = (provided?.length ? provided : defaults).map(stage => ({ ...stage,
            optionIds: [...(stage.optionIds || groups.filter(group => (stage.groupIds || []).includes(group.id)).flatMap(group => group.options.map(option => ({ groupId: group.id, optionId: option.id }))))],
            variableIds: [...(stage.variableIds || groups.filter(group => (stage.groupIds || []).includes(group.id)).flatMap(group => group.variableInputs.map(input => ({ groupId: group.id, inputId: input.id }))))] }));
        const last = result.find(stage => stage.id === "model") || result[result.length - 1];
        for (const group of groups) {
            for (const option of group.options || []) if (!result.some(stage => stage.optionIds.some(ref => ref.groupId === group.id && ref.optionId === option.id))) last.optionIds.push({ groupId: group.id, optionId: option.id });
            for (const input of group.variableInputs || []) if (!result.some(stage => stage.variableIds.some(ref => ref.groupId === group.id && (ref.inputId || ref.optionId) === input.id))) last.variableIds.push({ groupId: group.id, inputId: input.id });
        }
        return result;
    }
    function workbench() {
        const workflow = stages(), current = workflow.find(stage => stage.id === stageId) || workflow[0];
        const agentEnabled = settings.agentPreset?.enabled === true;
        const search = query.trim().toLocaleLowerCase();
        const groups = (settings.sourceSettings.groups || []).map(source => ({ ...source,
            options: (source.options || []).filter(option => search
                ? [source.label, option.label, option.description].some(text => String(text || "").toLocaleLowerCase().includes(search))
                : current.optionIds.some(ref => ref.groupId === source.id && ref.optionId === option.id)),
            variableInputs: (source.variableInputs || []).filter(input => search
                ? [source.label, input.label, input.description].some(text => String(text || "").toLocaleLowerCase().includes(search))
                : current.variableIds.some(ref => ref.groupId === source.id && (ref.inputId || ref.optionId) === input.id))
        })).filter(group => group.options.length || group.variableInputs.length);
        const tabPrefix = "dsh-preset-" + props.sessionId;
        return h(React.Fragment, null,
            h("header", { className: "dsh-agent-preset-header" },
                h("div", null, h("h3", null, agentEnabled ? settings.agentPreset?.title || "梦境思客DSH" : settings.presetName || "梦境思客"),
                    h("p", null, agentEnabled ? "保留原作者规则，按 Agent 执行阶段配置" : "保留原作者规则，配置原酒馆预设选项")),
                h("span", { className: "dsh-agent-preset-badge" }, agentEnabled ? "Agent 模式" : "原酒馆模式")),
            h("div", { className: "dsh-agent-preset-toolbar" },
                h("input", { type: "search", value: query, placeholder: "查找预设功能…", "aria-label": "搜索预设功能", onChange: event => setQuery(event.target.value) }),
                h("button", { type: "button", className: "dsh-agent-preset-link", onClick: event => openSource(event) }, "来源与原文")),
            h("nav", { role: "tablist", "aria-label": agentEnabled ? "Agent 执行阶段" : "预设配置分类", className: "dsh-agent-preset-tabs" }, workflow.map((stage, index) =>
                h("button", { key: stage.id, type: "button", role: "tab", id: tabPrefix + "-" + stage.id,
                    "aria-selected": current.id === stage.id, "aria-controls": tabPrefix + "-panel", tabIndex: current.id === stage.id ? 0 : -1,
                    onClick: () => { setStageId(stage.id); setQuery(""); }, onKeyDown: event => {
                        const offset = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
                        const target = event.key === "Home" ? 0 : event.key === "End" ? workflow.length - 1 : offset ? (index + offset + workflow.length) % workflow.length : -1;
                        if (target >= 0) { event.preventDefault(); setStageId(workflow[target].id); setQuery(""); event.currentTarget.parentElement.children[target].focus(); }
                    } }, stage.label))),
            hasDrafts ? h("p", { role: "status", className: "dsh-agent-preset-warning" }, "高级设置有未保存修改，请先保存或撤销，再切换原预设功能。") : null,
            [...(settings.sourceSettings.errors || []), ...(settings.agentPreset?.errors || [])].map((item, index) => h("p", { key: index, role: "alert" }, typeof item === "string" ? item : item.message || String(item))),
            h("div", { role: "tabpanel", id: tabPrefix + "-panel", "aria-labelledby": tabPrefix + "-" + current.id, className: "dsh-agent-preset-panel" },
                h("div", { className: "dsh-agent-preset-stage-heading" }, h("h4", null, search ? "搜索结果" : current.label),
                    h("p", null, search ? "显示所有分类中匹配的功能" : agentEnabled ? current.description || "选择后立即保存，从下一回合生效" : "原预设选项，选择后从下一回合生效")),
                groups.length ? h("div", { className: "dsh-agent-preset-groups" }, groups.map(sourceGroup)) : h("p", null, search ? "没有匹配的功能" : "此阶段暂无可配置选项")),
            h("details", { className: "dsh-agent-preset-advanced" }, h("summary", null, "高级设置：规则、正则与脚本"), advanced()),
            h("footer", { className: "dsh-agent-preset-footer" }, h("span", null, settings.presetName || "原预设"), h("span", null, "仅影响本局 · 下一回合生效")),
            sourceDrawer ? h("div", { className: "dsh-agent-preset-overlay", onClick: event => { if (event.target === event.currentTarget) setSourceDrawer(null); } },
                h("dialog", { "aria-modal": "true", "aria-label": "来源提示词原文", className: "dsh-agent-preset-drawer", ref: drawerElement,
                    onCancel: event => { event.preventDefault(); setSourceDrawer(null); },
                    onKeyDown: event => {
                        if (event.key === "Escape") { event.preventDefault(); setSourceDrawer(null); }
                        if (event.key === "Tab") {
                            const controls = [...event.currentTarget.querySelectorAll('button,textarea,summary,[tabindex="0"]')].filter(element => element.getClientRects().length);
                            const first = controls[0], last = controls[controls.length - 1];
                            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
                            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
                        }
                    } },
                    h("div", { className: "dsh-agent-preset-drawer-heading" }, h("h3", null, "来源与原文"), h("button", { type: "button", "aria-label": "关闭来源原文", onClick: () => setSourceDrawer(null) }, "关闭")),
                    h("p", null, "原作者提示词仅供查看，选项与高级设置保存在本局。"),
                    settings.sourceSettings.groups.filter(group => !sourceDrawer.groupId || sourceDrawer.groupId === group.id).map(group =>
                        h("section", { key: group.id }, h("h4", null, group.label), group.options.map(option =>
                            h("details", { key: option.id, className: "dsh-agent-preset-source-row" }, h("summary", null, option.label + (option.enabled ? " · 已开启" : "")),
                                option.description ? h("p", null, option.description) : null, compatibility(option, true),
                                (option.prompts || []).length ? option.prompts.map(prompt => h("label", { key: prompt.key }, prompt.name,
                                    h("textarea", { rows: 7, readOnly: true, value: prompt.content || "", "aria-label": group.label + "：" + option.label + "：" + prompt.name + "原文" }))) : h("p", null, "此项为宿主设置，没有对应提示词原文。"))))))) : null);
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
    return h("section", { "aria-label": "预设功能设置", className: settings?.sourceSettings ? "dsh-agent-preset" : "dsh-local-field" },
        !settings?.sourceSettings ? h("h3", null, "预设功能设置") : null,
        !settings?.sourceSettings ? h("p", { className: "dsh-tavern-settings-desc" }, "本局的文风、剧情分析和格式规则会进入 Agent 请求。展开规则可查看原文或修改；保存仅影响本局。") : null,
        settings ? h(React.Fragment, null,
            settings.sourceSettings ? workbench() : h(React.Fragment, null, h("p", null, settings.presetName || "本局没有引用酒馆预设"), advanced())) : h("p", null, "正在读取本局预设…"),
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
