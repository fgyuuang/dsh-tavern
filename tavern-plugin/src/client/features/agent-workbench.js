// A host for plugin views. View preferences never change Agent capabilities.
function createAgentWorkbenchFeatureModule() {
    const eventName = "dsh-tavern:open-agent-workbench";
    function ownerOf(ctx, sessionId) { return ctx.sessions.subagentAddress(sessionId)?.parentSessionId || sessionId; }
    function keyFor(sessionId) { return "dsh-tavern:agent-workbench:" + sessionId; }
    function readPreferences(sessionId) {
        try {
            const value = JSON.parse(window.localStorage.getItem(keyFor(sessionId)) || "{}");
            return { selected: typeof value.selected === "string" ? value.selected : "", hidden: Array.isArray(value.hidden) ? value.hidden.filter(item => typeof item === "string") : [] };
        } catch (_) { return { selected: "", hidden: [] }; }
    }
    function remember(sessionId, preferences) {
        try { window.localStorage.setItem(keyFor(sessionId), JSON.stringify(preferences)); } catch (_) {}
    }
    function icon(id) {
        const paths = { draft: "M4 5h16M4 10h16M4 15h9M4 20h9m2-3 4-4 2 2-4 4-3 1z", "author-settings": "M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-6 0v6", memory: "M4 4h7a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4zm10 3a3 3 0 0 1 3-3h3v15h-3a4 4 0 0 0-3 2", state: "M4 4h16v16H4zM4 10h16M10 4v16", runtime: "m8 7-4 5 4 5m8-10 4 5-4 5m-2-14-4 18" };
        return React.createElement("svg", { width: 19, height: 19, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.65, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true }, React.createElement("path", { d: paths[id.split("/").pop()] || "M4 4h6v6H4zm10 0h6v6h-6zM4 14h6v6H4zm10 0h6v6h-6z" }));
    }
    function WorkbenchView(props) {
        const h = React.createElement;
        useTavernUiExtensions();
        const mode = useTavernSessionMode(props.sessionId);
        const modeView = useLiveTavernView(props.sessionId, "agent-workbench-mode", [["playPresetId"]]);
        const enabled = isPlayMode(mode) && modeView.view?.playPresetId === "dream-sike-dsh";
        const coordination = useTavernCoordination(props.sessionId);
        const activity = describeTavernActivity(coordination.view?.activity);
        const binding = React.useSyncExternalStore(
            listener => props.ctx.sessions.list?.subscribe(listener) || (() => {}),
            () => props.ctx.sessions.binding?.(props.sessionId) || null,
            () => null);
        const running = React.useSyncExternalStore(
            listener => binding?.session.subscribe(listener) || (() => {}),
            () => binding ? binding.session.getSnapshot().running === true : props.running === true,
            () => false);
        const [preferences, setPreferences] = React.useState(() => readPreferences(props.sessionId));
        const [managing, setManaging] = React.useState(false), [retries, setRetries] = React.useState({});
        const [visited, setVisited] = React.useState([]);
        const tabRefs = React.useRef(new Map());
        const managementTrigger = React.useRef(null), managementBox = React.useRef(null);
        const identity = React.useId();
        const context = { gameId: props.sessionId, sessionId: props.sessionId, visible: props.visible, mode, playPresetId: modeView.view?.playPresetId, ctx: props.ctx, tabId: props.tabId };
        const panels = enabled ? tavernUiExtensions.workbenchPanels().filter(panel => {
            try { return !panel.when || panel.when(context); }
            catch (error) { try { tavernErrorHub.report("工作台模块 " + panel.owner, error); } catch (_) {} return false; }
        }) : [];
        const visiblePanels = panels.filter(panel => !preferences.hidden.includes(panel.id));
        const selected = visiblePanels.find(panel => panel.id === preferences.selected) || visiblePanels[0];
        React.useEffect(() => {
            if (!enabled) { setVisited([]); return; }
            if (selected) setVisited(current => current.includes(selected.id) ? current : [...current, selected.id]);
        }, [enabled, selected?.id]);
        function update(transform) {
            setPreferences(current => { const next = transform(current); remember(props.sessionId, next); return next; });
        }
        function select(panelId) { update(current => ({ ...current, selected: panelId })); }
        React.useEffect(() => {
            function requested(event) {
                if (event.detail?.sessionId !== props.sessionId || !event.detail.panelId) return;
                const panelId = event.detail.panelId;
                update(current => ({ selected: panelId, hidden: current.hidden.filter(id => id !== panelId) }));
            }
            window.addEventListener(eventName, requested);
            return () => window.removeEventListener(eventName, requested);
        }, [props.sessionId]);
        React.useEffect(() => {
            if (!managing) return;
            managementBox.current?.querySelector("input")?.focus();
            function escape(event) { if (event.key === "Escape") { setManaging(false); managementTrigger.current?.focus(); } }
            document.addEventListener("keydown", escape);
            return () => document.removeEventListener("keydown", escape);
        }, [managing]);
        function navigate(event, index) {
            let next;
            if (["ArrowRight", "ArrowDown"].includes(event.key)) next = (index + 1) % visiblePanels.length;
            else if (["ArrowLeft", "ArrowUp"].includes(event.key)) next = (index + visiblePanels.length - 1) % visiblePanels.length;
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = visiblePanels.length - 1;
            if (next === undefined) return;
            event.preventDefault(); select(visiblePanels[next].id); tabRefs.current.get(visiblePanels[next].id)?.focus();
        }
        function toggle(panel) {
            update(current => ({ ...current, hidden: current.hidden.includes(panel.id) ? current.hidden.filter(id => id !== panel.id) : [...current.hidden, panel.id] }));
        }
        return h("section", { className: "dsh-agent-workbench", "aria-label": "Agent 工作台" },
            h("header", { className: "dsh-agent-workbench-head" },
                h("div", { className: "dsh-agent-workbench-identity" }, h("span", { className: "dsh-agent-workbench-kicker" }, "梦境思客 · 创作空间"), h("h2", null, "Agent 工作台")),
                h("button", { ref: managementTrigger, type: "button", className: "dsh-agent-workbench-manage", disabled: !enabled, "aria-expanded": managing, "aria-controls": identity + "-modules", onClick: () => setManaging(value => !value) }, "管理模块")),
            !enabled ? h("div", { className: "dsh-agent-workbench-empty", role: "status" }, modeView.loading ? "正在读取本局模式…" : "在本局设置选择梦境思客DSH，即可打开创作工作台。DSH 原版使用原有交互界面。") : h(React.Fragment, null,
                h("div", { className: "dsh-agent-workbench-status" }, h("span", { className: "dsh-agent-workbench-dot", "data-busy": String(activity.busy || running), "aria-hidden": true }), running && props.visible ? h(DreamSikeMainTurnStatus, { sessionId: props.sessionId }) : h("span", { role: "status" }, activity.busy ? activity.label || "正在处理本回合" : "等待你的行动"), h("span", { className: "dsh-agent-workbench-status-note" }, "当前游戏")),
                managing ? h("section", { ref: managementBox, id: identity + "-modules", className: "dsh-agent-workbench-modules", "aria-label": "工作台模块管理" },
                    h("div", { className: "dsh-agent-workbench-module-heading" }, h("strong", null, "按你的习惯布置"), h("button", { type: "button", onClick: () => { update(current => ({ ...current, hidden: [] })); } }, "显示全部")),
                    h("p", null, "只调整本局的界面显示。Agent 继续使用已启用的能力。"),
                    panels.map(panel => h("label", { key: panel.id, className: "dsh-agent-workbench-module-choice" }, h("input", { type: "checkbox", checked: !preferences.hidden.includes(panel.id), onChange: () => toggle(panel) }), h("span", null, h("strong", null, panel.label), h("small", null, panel.owner || "工作台插件"))))) : null,
                panels.length ? h(React.Fragment, null,
                    visiblePanels.length ? h("nav", { className: "dsh-agent-workbench-nav", role: "tablist", "aria-label": "创作模块" }, visiblePanels.map((panel, index) => h("button", { key: panel.id, id: identity + "-tab-" + index, ref: node => { if (node) tabRefs.current.set(panel.id, node); else tabRefs.current.delete(panel.id); }, type: "button", role: "tab", tabIndex: panel === selected ? 0 : -1, "aria-selected": panel === selected, "aria-controls": identity + "-panel-" + panel.id, className: "dsh-agent-workbench-tab", onClick: () => select(panel.id), onKeyDown: event => navigate(event, index) }, icon(panel.id), h("span", null, h("strong", null, panel.label), h("small", null, panel.description))))) : h("div", { className: "dsh-agent-workbench-empty", role: "status" }, "模块已收起。打开“管理模块”可恢复显示。"),
                    panels.filter(panel => panel === selected || panel.keepAlive && visited.includes(panel.id)).map(panel => h("div", { key: panel.id, id: identity + "-panel-" + panel.id, role: "tabpanel", hidden: panel !== selected, "aria-labelledby": panel === selected ? identity + "-tab-" + visiblePanels.indexOf(panel) : undefined, tabIndex: 0, className: "dsh-agent-workbench-panel" },
                        (props.visible || panel.keepAlive && visited.includes(panel.id)) ? h(tavernPluginBoundary(), { key: panel.id + ":" + (retries[panel.id] || 0), owner: panel.owner, fallback: h("div", { className: "dsh-agent-workbench-empty", role: "alert" }, h("strong", null, panel.label + "暂时无法显示"), h("p", null, "你可以切换其他模块，或重新打开这一模块。"), h("button", { type: "button", onClick: () => setRetries(current => ({ ...current, [panel.id]: (current[panel.id] || 0) + 1 })) }, "重新打开模块")) }, h(panel.component, { ...context, visible: props.visible && panel === selected })) : null))) : h("div", { className: "dsh-agent-workbench-empty", role: "status" }, "暂无可用的工作台模块。")));
    }
    function WorkbenchTab(props) {
        const sessionId = ownerOf(props.ctx, props.sessionId || props.scope?.sessionId);
        return React.createElement(WorkbenchView, { ...props, key: sessionId, sessionId });
    }
    async function open(ctx, sessionId, panelId) {
        const owner = ownerOf(ctx, sessionId);
        if (panelId) {
            const preferences = readPreferences(owner);
            remember(owner, { selected: panelId, hidden: preferences.hidden.filter(id => id !== panelId) });
            window.dispatchEvent(new CustomEvent(eventName, { detail: { sessionId: owner, panelId } }));
        }
        return openTavernSidebarTab(ctx, { type: "dsh-tavern:agent-workbench" }, { sessionId: owner });
    }
    function Action(props) {
        const owner = ownerOf(props.ctx, props.sessionId);
        const mode = useTavernSessionMode(owner);
        const view = useLiveTavernView(owner, "agent-workbench-action", [["playPresetId"]]);
        if (!isPlayMode(mode) || view.view?.playPresetId !== "dream-sike-dsh") return null;
        return React.createElement("button", { type: "button", className: "dsh-tavern-btn", "aria-label": "打开 Agent 工作台", onClick: () => { void open(props.ctx, owner); } }, icon("workbench"), React.createElement("span", { className: "dsh-tavern-header-action-label" }, "Agent 工作台"));
    }
    function register(input) {
        const ctx = input.ctx;
        ctx.effect(() => ctx.betterSidebar.registerTab({ id: "dsh-tavern:agent-workbench", title: "Agent 工作台", order: 7, single: true, component: props => React.createElement(WorkbenchTab, { ...props, ctx, tabId: props.tab?.id }) }), "dsh-tavern: Agent workbench");
        if (input.slots) ctx.effect(() => input.slots.inject("conversation.session.header.utilities", () => input.slots.register({ name: "conversation.session.header.utilities", id: "dsh-tavern:agent-workbench", order: 84 }, props => React.createElement(Action, { ...props, ctx }))), "dsh-tavern: Agent workbench action");
    }
    return Object.freeze({ register, open, View: WorkbenchTab });
}
const agentWorkbenchFeature = createAgentWorkbenchFeatureModule();
