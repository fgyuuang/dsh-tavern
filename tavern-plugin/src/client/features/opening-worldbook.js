function TavernOpeningWorldbook(props) {
    const h = React.createElement;
    const [book, setBook] = React.useState(null), [error, setError] = React.useState("");
    const [saving, setSaving] = React.useState(false), [query, setQuery] = React.useState("");
    const generation = React.useRef(0), callbacks = React.useRef(props), mutating = React.useRef(false);
    callbacks.current = props;
    React.useEffect(() => {
        if (!props.visible) return;
        const token = ++generation.current;
        let id = props.preparationId, pending = false;
        setBook(null); setError(""); setSaving(false); mutating.current = false;
        callbacks.current.onPending();
        async function refresh() {
            if (pending || mutating.current) return;
            pending = true;
            try {
                if (!id) id = (await props.call("createOpeningPreparation", { path: props.cardPath, userName: props.userName })).id;
                const result = await props.call("getOpeningWorldBook", { id });
                if (token !== generation.current) return;
                setBook(current => current?.revision === result.revision ? current : result);
                setError(""); callbacks.current.onReady(id);
            } catch (err) {
                if (token === generation.current) { setError(String(err.message || err)); callbacks.current.onError(); }
            } finally { pending = false; }
        }
        void refresh();
        const timer = window.setInterval(refresh, 4000);
        window.addEventListener("focus", refresh);
        return () => { generation.current++; window.clearInterval(timer); window.removeEventListener("focus", refresh); };
    }, [props.visible, props.preparationId, props.cardPath, props.userName]);
    async function toggle(entry) {
        if (!book || saving || props.busy) return;
        const token = generation.current;
        mutating.current = true; setSaving(true); setError(""); callbacks.current.onPending();
        try {
            const result = await props.call("setOpeningWorldBookEntryEnabled", { id: props.preparationId, ref: entry.ref, enabled: !entry.enabled, revision: book.revision });
            if (token !== generation.current) return;
            setBook(result); callbacks.current.onReady(props.preparationId);
        } catch (err) { if (token === generation.current) { setError(String(err.message || err)); callbacks.current.onError(); } }
        finally { if (token === generation.current) { mutating.current = false; setSaving(false); } }
    }
    const counts = book?.counts;
    const entries = (book?.entries || []).filter(entry => !query || (entry.title + " " + entry.ref).toLowerCase().includes(query.toLowerCase()));
    return h("section", { className: "dsh-opening-worldbook", "aria-label": "本局世界书", "aria-busy": saving },
        h("details", null, h("summary", null, h("strong", null, "本局世界书"), h("span", { role: "status" }, book ? book.name ? book.name + " · " + counts.enabled + "/" + counts.total + " 条启用" : "未绑定世界书" : "正在读取…")),
            h("p", null, "这里调整本次新游戏的条目。角色卡脚本的选择也会显示在这里；资源库原件保留。"),
            counts ? h("p", null, "常驻剧情 " + counts.constant + " · 动态触发 " + counts.dynamic + " · 后台变量规则 " + counts.mvuRules) : null,
            counts?.total ? h("label", null, "搜索条目", h("input", { type: "search", value: query, onChange: event => setQuery(event.target.value), placeholder: "标题或编号" })) : null,
            h("div", { className: "dsh-opening-worldbook-entries" }, entries.map(entry => h("label", { key: entry.ref },
                h("input", { type: "checkbox", checked: entry.enabled, disabled: props.busy || saving || !props.preparationId, onChange: () => toggle(entry) }),
                h("span", null, entry.title, h("small", null, entry.mvuRule ? "后台变量规则" : entry.constant ? "常驻剧情" : "动态触发"))))),
            book?.source ? h("button", { type: "button", className: "dsh-tavern-btn", disabled: props.busy || saving, onClick: () => props.openLibrary(book.source) }, "管理资源库原件 ↗") : null),
        error ? h("p", { className: "dsh-card-error", role: "alert" }, "世界书读取或保存失败：" + error + "。正在重新读取，请稍后重试。") : null);
}
