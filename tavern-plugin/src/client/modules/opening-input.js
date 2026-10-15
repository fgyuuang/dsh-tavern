function openingPickerInput(picker, openingId) {
    return picker && picker.preparedInputId === openingId ? String(picker.preparedInput || "") : "";
}
function updateOpeningPickerInput(picker, openingId, text) {
    if (!picker || picker.openings[picker.index]?.id !== openingId) return picker;
    return { ...picker, preparedInputId: openingId, preparedInput: String(text || "") };
}
function TavernOpeningInput(props) {
    const h = React.createElement;
    const value = openingPickerInput(props.picker, props.openingId);
    const [expanded, setExpanded] = React.useState(Boolean(value));
    React.useEffect(() => { if (value) setExpanded(true); }, [value]);
    if (props.inline) return h("div", { className: "dsh-opening-composer" },
        h("label", { htmlFor: "dsh-opening-message" }, "你的开局消息"),
        h("textarea", { id: "dsh-opening-message", rows: 3, maxLength: 100000,
            "aria-label": "开局指令", disabled: props.busy, value,
            placeholder: "输入你的第一句话，或使用卡面按钮填写开局指令…",
            onChange: event => props.onChange(event.target.value) }),
        h("small", null, "确认开场后开始对话；留空则只载入开场白。"));
    return h("details", { className: "dsh-opening-command", open: expanded, onToggle: event => setExpanded(event.currentTarget.open) },
        h("summary", null, "开局指令", h("span", null, value ? "已填入，可修改" : "选填 · 卡面按钮会填入这里")),
        h("div", { className: "dsh-tavern-player-name" },
        h("label", null, "开局指令（可编辑）", h("textarea", { rows: 6, maxLength: 100000,
            className: "dsh-tavern-preset-entry-editor", "aria-label": "开局指令", disabled: props.busy,
            value, onChange: event => props.onChange(event.target.value) })),
        h("p", { className: "dsh-tavern-player-name-help" }, "卡片按钮生成的指令会填入这里。回车用于换行；核对或编辑后点击“开始新游戏”提交。留空时只载入开场。")));
}
