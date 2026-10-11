function openingPickerInput(picker, openingId) {
    return picker && picker.preparedInputId === openingId ? String(picker.preparedInput || "") : "";
}
function updateOpeningPickerInput(picker, openingId, text) {
    if (!picker || picker.openings[picker.index]?.id !== openingId) return picker;
    return { ...picker, preparedInputId: openingId, preparedInput: String(text || "") };
}
function TavernOpeningInput(props) {
    const h = React.createElement;
    return h("div", { className: "dsh-tavern-player-name" },
        h("label", null, "开局指令（可编辑）", h("textarea", { rows: 6, maxLength: 100000,
            className: "dsh-tavern-preset-entry-editor", "aria-label": "开局指令", disabled: props.busy,
            value: openingPickerInput(props.picker, props.openingId), onChange: event => props.onChange(event.target.value) })),
        h("p", { className: "dsh-tavern-player-name-help" }, "卡片按钮生成的指令会填入这里。回车用于换行；核对或编辑后点击“开始新游戏”提交。留空时只载入开场。"));
}
