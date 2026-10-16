// Preview text is deliberately inert. Strip serialized private channels before
// painting, including an unfinished opening tag at the current token boundary.
function dreamSikePreviewVisibleText(value) {
    if (typeof value !== "string") return "";
    const privateTag = "(?:think_fox~|think|simple_thinking|dream_self_check|redemption_chain|thought_of_chain|thinking_step)";
    let text = "", offset = 0, privateDepth = 0;
    for (const match of value.matchAll(new RegExp("<(\\/?)" + privateTag + "(?:\\s[^>]*)?>", "gi"))) {
        if (!privateDepth) text += value.slice(offset, match.index);
        privateDepth = match[1] ? Math.max(0, privateDepth - 1) : privateDepth + 1;
        offset = match.index + match[0].length;
    }
    if (!privateDepth) text += value.slice(offset);
    text = text.replace(/```(?:thought|analysis|reasoning|redemption_chain|thought_of_chain|thinking_step)\b[^\n]*\n?[\s\S]*?(?:```|$)/gi, "");
    const partial = text.lastIndexOf("<");
    if (partial >= 0 && !text.slice(partial).includes(">")) text = text.slice(0, partial);
    // The final projection owns HTML and card scripts. The live preview displays
    // readable prose only and never creates an iframe or invokes a Helper API.
    return text.replace(/<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, "")
        .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
        .replace(/<\/(?:p|div|li|h[1-6]|section|article|pre|tr)\s*>|<br\s*\/?\s*>/gi, "\n")
        .replace(/<\/?[a-z][^>]*>/gi, "")
        .replace(/&(?:lt|gt|amp|quot|apos|nbsp);/g, entity => ({ "&lt;": "<", "&gt;": ">", "&amp;": "&", "&quot;": '"', "&apos;": "'", "&nbsp;": " " })[entity]);
}

// Decode only the dedicated draft tool's one top-level text argument. Incomplete
// JSON stays display-only; it is never repaired into an executable tool call.
function createDreamSikePreviewDecoder() {
    let raw = "", offset = 0, stack = [], token = null, started = false, done = false, seenText = false, textStarted = false, text = "", high = "", invalid = false;
    const escapes = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
    function reset() { raw = ""; offset = 0; stack = []; token = null; started = false; done = false; seenText = false; textStarted = false; text = ""; high = ""; invalid = false; }
    function valueDone() {
        const parent = stack.at(-1);
        if (!parent) done = true;
        else parent.phase = "comma-or-end";
    }
    function openContainer(kind) {
        if (stack.length >= 64) { invalid = true; return; }
        stack.push({ kind, phase: kind === "object" ? "key-or-end" : "value-or-end", top: stack.length === 0, isText: false });
    }
    function append(character) {
        if (token.key) { if (token.top) token.value += character; return; }
        if (!token.capture) return;
        const code = character.charCodeAt(0);
        if (high) {
            text += code >= 0xdc00 && code <= 0xdfff ? high + character : "\ufffd";
            high = "";
            if (code >= 0xdc00 && code <= 0xdfff) return;
        }
        if (code >= 0xd800 && code <= 0xdbff) high = character;
        else text += code >= 0xdc00 && code <= 0xdfff ? "\ufffd" : character;
    }
    function beginValue(character, parent) {
        const capture = parent.kind === "object" && parent.top && parent.isText;
        if (capture && character !== '"') { invalid = true; return; }
        if (character === '"') {
            token = { kind: "string", key: false, capture, escape: false, unicode: null, length: 0 };
            if (capture) textStarted = true;
        } else if (character === "{") openContainer("object");
        else if (character === "[") openContainer("array");
        else if (/[0-9-]/.test(character)) token = { kind: "number", value: character };
        else if ("tfn".includes(character)) token = { kind: "literal", word: ({ t: "true", f: "false", n: "null" })[character], offset: 1 };
        else invalid = true;
    }
    return {
        read(value) {
            if (typeof value !== "string" || value.length > 500000) { reset(); return null; }
            if (!value.startsWith(raw)) reset();
            raw = value;
            while (!invalid && offset < raw.length) {
                const character = raw[offset++];
                if (token?.kind === "number") {
                    if (/[0-9eE+.-]/.test(character)) {
                        token.value += character;
                        if (token.value.length > 128) invalid = true;
                    } else {
                        if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(token.value)) invalid = true;
                        token = null; valueDone(); --offset;
                    }
                    continue;
                }
                if (token?.kind === "literal") {
                    if (character !== token.word[token.offset++]) invalid = true;
                    else if (token.offset === token.word.length) { token = null; valueDone(); }
                    continue;
                }
                if (token?.kind === "string") {
                    if (++token.length > (token.key ? 1024 : 400000)) { invalid = true; break; }
                    if (token.unicode !== null) {
                        if (!/[0-9a-f]/i.test(character)) { invalid = true; break; }
                        token.unicode += character;
                        if (token.unicode.length === 4) { append(String.fromCharCode(parseInt(token.unicode, 16))); token.unicode = null; }
                    } else if (token.escape) {
                        token.escape = false;
                        if (character === "u") token.unicode = "";
                        else if (Object.hasOwn(escapes, character)) append(escapes[character]);
                        else invalid = true;
                    } else if (character === "\\") token.escape = true;
                    else if (character === '"') {
                        if (token.key) {
                            const parent = stack.at(-1);
                            parent.isText = token.top && token.value === "text";
                            if (parent.isText) { if (seenText) invalid = true; seenText = true; }
                            parent.phase = "colon";
                        } else {
                            if (token.capture && high) { text += "\ufffd"; high = ""; }
                            valueDone();
                        }
                        token = null;
                    } else if (character.charCodeAt(0) < 32) invalid = true;
                    else append(character);
                    if (text.length > 100000) invalid = true;
                    continue;
                }
                if (/[ \t\r\n]/.test(character)) continue;
                if (!started) {
                    started = true;
                    if (character === "{") openContainer("object"); else invalid = true;
                    continue;
                }
                if (done) { invalid = true; break; }
                const parent = stack.at(-1);
                const closing = parent.kind === "object" ? "}" : "]";
                if (parent.phase === "comma-or-end") {
                    if (character === closing) { stack.pop(); valueDone(); }
                    else if (character === ",") parent.phase = parent.kind === "object" ? "key" : "value";
                    else invalid = true;
                } else if (parent.kind === "object" && ["key-or-end", "key"].includes(parent.phase)) {
                    if (character === "}" && parent.phase === "key-or-end") { stack.pop(); valueDone(); }
                    else if (character === '"') token = { kind: "string", key: true, top: parent.top, value: "", escape: false, unicode: null, length: 0 };
                    else invalid = true;
                } else if (parent.phase === "colon") {
                    if (character === ":") parent.phase = "value"; else invalid = true;
                } else if (parent.kind === "array" && parent.phase === "value-or-end" && character === "]") { stack.pop(); valueDone(); }
                else beginValue(character, parent);
            }
            return !invalid && textStarted ? dreamSikePreviewVisibleText(text) : null;
        }
    };
}

function currentDreamSikePreviewTurn(snapshot) {
    const timeline = snapshot && snapshot.timeline;
    const turn = timeline?.turns?.get(timeline.turnOrder?.at(-1));
    return turn?.status === "open" ? turn : null;
}

// Read the Step's native data source, including tool-only Steps that the host
// correctly omits from its visible chat nodes. No Session or Tavern state writes.
function DreamSikeLiveTextPreview(props) {
    const turn = props.useChat(currentDreamSikePreviewTurn);
    const step = turn?.steps?.at(-1);
    const source = step?.data?.source?.("assistant-step");
    const subscribe = React.useCallback(listener => source?.subscribe(listener) || (() => {}), [source]);
    const snapshot = React.useCallback(() => source?.getSnapshot() || null, [source]);
    const data = React.useSyncExternalStore(subscribe, snapshot, snapshot);
    const reader = React.useRef(null);
    const epoch = React.useRef(0);
    const pending = React.useRef(null);
    const latest = React.useRef(null);
    const [preview, setPreview] = React.useState(null);
    const [savedDraft, setSavedDraft] = React.useState(null);
    const turnKey = turn ? JSON.stringify([props.sessionId, turn.turn, turn.start?.seq]) : "";
    const stepKey = step ? JSON.stringify([turnKey, step.step, step.start?.seq]) : "";
    React.useEffect(function () {
        let active = true;
        if (!props.running || !turnKey) { setSavedDraft(null); return; }
        // One durable read per native Step recovers an already saved draft after
        // reload or during a later check. Never poll on every streamed token.
        void rpcWithTimeout("getDraftView", { sessionId: props.sessionId }, props.sessionId).then(result => {
            const draft = result?.draft;
            if (active) setSavedDraft(draft?.turn === turn.turn && ["draft", "ready"].includes(draft.status)
                ? { turnKey, text: dreamSikePreviewVisibleText(draft.text), version: draft.version } : null);
        }).catch(() => {});
        return () => { active = false; };
    }, [props.sessionId, props.running, turnKey, stepKey]);
    React.useEffect(function () {
        ++epoch.current;
        reader.current = null;
        setPreview(previous => props.running && turnKey && previous?.turnKey === turnKey && previous.step < step?.step ? previous : null);
        return function () {
            ++epoch.current;
            if (pending.current !== null) window.clearTimeout(pending.current);
            pending.current = null;
            reader.current = null;
        };
    }, [props.sessionId, props.running, turnKey, stepKey]);
    React.useEffect(function () {
        latest.current = { data, turnKey, stepKey, step: step?.step };
        if (!props.running || !turnKey || !stepKey || pending.current !== null) return;
        const generation = epoch.current;
        // Throttle, rather than debounce: a continuous token stream must still paint.
        pending.current = window.setTimeout(function () {
            pending.current = null;
            if (epoch.current !== generation) return;
            const current = latest.current;
            const call = current.data?.blocks?.find(block => block && block.kind === "tool-call" && block.name === "sike_put_draft" && typeof block.callId === "string" && block.callId);
            if (!call) {
                reader.current = null;
                const text = dreamSikePreviewVisibleText((current.data?.blocks || []).filter(block => block?.kind === "text").map(block => block.text || "").join(""));
                if (text.trim()) {
                    setPreview({ key: current.stepKey + ":text", turnKey: current.turnKey, stepKey: current.stepKey, step: current.step, source: "text", text });
                    return;
                }
                // Keep an already read draft while later checking Steps run;
                // a reset in its own Step is a retry, so its old preview is gone.
                setPreview(previous => previous?.turnKey === current.turnKey && previous.step < current.step ? previous : null);
                return;
            }
            const callKey = JSON.stringify([current.stepKey, call.callId]);
            if (reader.current?.key !== callKey) reader.current = { key: callKey, decoder: createDreamSikePreviewDecoder() };
            const text = reader.current.decoder.read(call.argsRaw);
            setPreview(previous => text && previous?.key === callKey && previous.text === text ? previous : text
                ? { key: callKey, turnKey: current.turnKey, stepKey: current.stepKey, step: current.step, source: "draft", text } : null);
        }, 100);
    }, [props.sessionId, props.running, turnKey, stepKey, step?.step, data]);
    const livePreview = preview?.turnKey === turnKey && preview.step <= step?.step
        && (preview.step !== step?.step || preview.stepKey === stepKey) ? preview : null;
    const savedText = savedDraft?.turnKey === turnKey ? savedDraft.text : "";
    const text = livePreview?.source === "draft" && livePreview.step === step?.step
        ? livePreview.text : savedText || livePreview?.text || "";
    if (!props.running || !turnKey || props.turn && props.turn.turn !== turn.turn || !text.trim()) return null;
    return React.createElement("section", { className: "dsh-sike-draft-section", "aria-label": "正文预览（未提交）", "data-dsh-draft-preview": true,
        style: { maxWidth: props.maxWidth > 0 ? props.maxWidth + "px" : "100%", width: "100%", marginInline: "auto", minWidth: 0, boxSizing: "border-box" } },
        React.createElement("div", { className: "dsh-sike-draft-muted", role: "status" }, "正文预览 · 未提交"),
        React.createElement("pre", { className: "dsh-sike-draft-text", style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere", font: "inherit", marginBlock: "0.5em" } }, text));
}
