		function createDreamSikeDraftFeatureModule() {
			let pageLeaving = false;
			const mountedWindows = new Map();
			function preferenceKey(sessionId) { return "dsh-tavern:dream-sike-draft-visible:" + sessionId; }
			function wantsDraftWindow(sessionId) {
				try { return window.localStorage.getItem(preferenceKey(sessionId)) === "1"; } catch (_) { return false; }
			}
			function rememberDraftWindow(sessionId, visible) {
				if (!sessionId) return;
				try { window.localStorage.setItem(preferenceKey(sessionId), visible ? "1" : "0"); } catch (_) {}
			}
			function draftPhaseLabel(draft) {
				const phase = String(draft && (draft.status === "stale" ? "stale" : draft.phase || draft.status) || "");
				return ({ reading: "读取资料", planning: "规划剧情", draft: "撰写正文", writing: "撰写正文", checking: "检查正文", revision: "修订正文", revising: "修订正文", ready: "等待提交", committing: "提交正文", committed: "已完成", complete: "已完成", completed: "已完成", stale: "已切换剧情分支", blocked: "需要处理", failed: "发生错误", error: "发生错误" })[phase] || (phase ? phase : "尚未开始");
			}
			function brief(value, limit) {
				const text = typeof value === "string" ? value.trim() : "";
				return text.length > limit ? text.slice(0, limit) + "…" : text;
			}
			function traceLabel(entry) {
				if (typeof entry === "string") return brief(entry, 140);
				if (!entry || typeof entry !== "object") return "执行步骤";
				return brief(entry.label || entry.tool || entry.action || entry.phase || entry.type || "执行步骤", 80);
			}
			function traceDetail(entry) {
				if (!entry || typeof entry !== "object") return "";
				return brief(entry.summary || entry.message || entry.resultSummary || entry.detail || "", 240);
			}
			function nativeToolStatus(status) {
				switch (status) {
					case "running": case "started": return "运行中";
					case "completed": case "success": case "ok": return "已完成";
					case "failed": case "error": return "失败";
					case "cancelled": return "已取消";
					case "interrupted": return "已中断";
					default: return "已记录";
				}
			}
			function DreamSikeDraftTab(props) {
				const h = React.createElement;
				const sessionId = props.sessionId;
				const mode = useTavernSessionMode(sessionId);
				const modeView = useLiveTavernView(sessionId, "dream-sike-window-mode", [["playPresetId"]]);
				const dreamMode = modeView.view?.playPresetId === "dream-sike-dsh";
				const [draft, setDraft] = React.useState(null);
				const [executionTrace, setExecutionTrace] = React.useState([]);
				const [loading, setLoading] = React.useState(true);
				const [error, setError] = React.useState("");
				const [resuming, setResuming] = React.useState(false);
				React.useEffect(function () {
					if (!sessionId || !dreamMode || props.embedded) return;
					if (props.visible) rememberDraftWindow(sessionId, true);
					else {
						const right = props.ctx.get("sidebarRight");
						if (right && !right.isExpanded()) rememberDraftWindow(sessionId, false);
					}
				}, [sessionId, dreamMode, props.visible, props.embedded]);
				React.useEffect(function () {
					if (!sessionId || !dreamMode || props.embedded) return;
					mountedWindows.set(sessionId, (mountedWindows.get(sessionId) || 0) + 1);
					return function () {
						const remaining = (mountedWindows.get(sessionId) || 1) - 1;
						if (remaining > 0) mountedWindows.set(sessionId, remaining);
						else mountedWindows.delete(sessionId);
						window.setTimeout(function () {
							if (!pageLeaving && !mountedWindows.has(sessionId) && props.ctx.sessions.list.getSnapshot().current === sessionId) rememberDraftWindow(sessionId, false);
						}, 100);
					};
				}, [sessionId, dreamMode, props.embedded]);
				React.useEffect(function () {
					setDraft(null);
					setExecutionTrace([]);
					setLoading(true);
					setError("");
					if (!props.visible || !sessionId || !isPlayMode(mode) || !dreamMode) return;
					let active = true;
					let pending = false;
					async function refresh() {
						if (!active || pending) return;
						pending = true;
						try {
							const result = await rpcWithTimeout("getDraftView", { sessionId: sessionId }, sessionId);
							if (active) {
								setDraft(result.draft && typeof result.draft === "object" ? result.draft : null);
								setExecutionTrace(Array.isArray(result.executionTrace) ? result.executionTrace : []);
								setError("");
							}
						} catch (failure) {
							if (active) setError(String(failure && failure.message || failure));
						} finally { pending = false; if (active) setLoading(false); }
					}
					function onData(event) { if (tavernDataChangeAffects(event, ["sessions", "drafts", "presets"])) void refresh(); }
					function onFocus() { void refresh(); }
					function onVisibility() { if (document.visibilityState === "visible") void refresh(); }
					let stopSignal = function () {};
					try {
						if (tavernSessionSignals && typeof tavernSessionSignals.subscribe === "function") {
							stopSignal = tavernSessionSignals.subscribe(sessionId, "tavern-state", function () { void refresh(); });
						}
					} catch (_error) {}
					window.addEventListener("dsh-tavern-data-changed", onData);
					window.addEventListener("focus", onFocus);
					document.addEventListener("visibilitychange", onVisibility);
					const timer = window.setInterval(function () { if (document.visibilityState === "visible") void refresh(); }, 2500);
					void refresh();
					return function () {
						active = false;
						window.clearInterval(timer);
						stopSignal();
						window.removeEventListener("dsh-tavern-data-changed", onData);
						window.removeEventListener("focus", onFocus);
						document.removeEventListener("visibilitychange", onVisibility);
					};
				}, [sessionId, props.visible, mode, dreamMode]);
				async function resume() {
					if (!draft || !draft.resumable || resuming) return;
					setResuming(true); setError("");
					try {
						await rpc("resumeDreamSikeDraft", { sessionId: sessionId, expectedOperationId: draft.operationId, expectedVersion: draft.version }, sessionId);
						notifyTavernDataChanged(["sessions", "drafts"], "dream-sike-draft");
					} catch (failure) { setError(String(failure && failure.message || failure)); }
					finally { setResuming(false); }
				}
				function closeWindow() {
					rememberDraftWindow(sessionId, false);
					try {
						const right = props.ctx.get("sidebarRight");
						if (right && props.tabId) right.close(props.tabId);
						else props.ctx.betterSidebar.closeTab(props.tabId, { sessionId: sessionId });
					} catch (failure) { setError(String(failure && failure.message || failure)); }
				}
				const changes = draft && Array.isArray(draft.changes) ? draft.changes : [];
				const checked = Boolean(draft && draft.checks && Array.isArray(draft.checks.issues));
				const checks = checked ? draft.checks.issues : [];
				const trace = draft && Array.isArray(draft.trace) ? draft.trace : [];
				const text = draft && typeof draft.text === "string" ? draft.text : "";
				const revisions = Math.max(0, Number(draft && draft.revisionCount) || 0);
				function renderExecutionTrace() {
					if (!executionTrace.length) return null;
					return h("details", { className: "dsh-sike-draft-trace dsh-sike-native-trace", "aria-label": "Agent 工具调用" },
						h("summary", null, "Agent 工具调用 · " + executionTrace.length + " 次"),
						h("ol", { className: "dsh-sike-draft-list" }, executionTrace.slice(-24).map(function (entry, index) {
							const item = entry && typeof entry === "object" ? entry : {};
							const step = Number(item.step);
							const elapsedMs = item.elapsedMs;
							const tool = brief(item.tool, 80) || "工具调用";
							const summary = brief(item.summary, 180);
							return h("li", { key: index, className: "dsh-sike-native-trace-item" },
								h("div", { className: "dsh-sike-native-trace-head" },
									Number.isSafeInteger(step) && step > 0 ? h("span", { className: "dsh-sike-native-trace-step" }, "第 " + step + " 步") : null,
									h("strong", null, tool),
									h("span", { className: "dsh-sike-native-trace-status" }, nativeToolStatus(item.status)),
									Number.isFinite(elapsedMs) && elapsedMs >= 0 ? h("span", { className: "dsh-sike-native-trace-time" }, Math.round(elapsedMs) + " ms") : null),
								summary ? h("p", null, summary) : null);
						})));
				}
				function renderWritingEvidence() {
					const preparation = draft && draft.preparation;
					const review = draft && draft.checks && draft.checks.editorial && draft.checks.editorial.review;
					const labels = { scene: "当前场景", characters: "人物约束", knowledge: "认知边界", style: "本局写规", progression: "本轮推进", stopAt: "玩家停止位置", character: "角色行为", continuity: "剧情连续性", playerAgency: "玩家选择", format: "渲染格式" };
					return h(React.Fragment, null,
						preparation && preparation.brief ? h("details", { className: "dsh-sike-draft-section", "aria-label": "写作准备" },
							h("summary", null, "写作准备 · 本回合"),
							h("ul", { className: "dsh-sike-draft-list" }, ["scene", "characters", "knowledge", "style", "progression", "stopAt"].map(function (key) {
								return h("li", { key: key }, h("b", null, labels[key] + "："), brief(preparation.brief[key], 400));
							}))) : null,
						review ? h("details", { className: "dsh-sike-draft-section", "aria-label": "六维审稿" },
							h("summary", null, "六维审稿 · Agent 判断"),
							h("ul", { className: "dsh-sike-draft-list" }, ["character", "knowledge", "style", "continuity", "playerAgency", "format"].map(function (key) {
								const item = review[key];
								return item ? h("li", { key: key }, h("b", null, labels[key] + "：" + (item.status === "pass" ? "通过" : "待修订") + " · "), brief(item.evidence, 500)) : null;
							}))) : null);
				}
				return h("aside", { className: "dsh-tavern-status dsh-sike-draft", "aria-label": "正文工作窗" },
					h("header", { className: "dsh-tavern-status-head dsh-sike-draft-head" },
						h("div", null, h("div", { className: "dsh-tavern-status-title" }, "正文工作窗"), h("div", { className: "dsh-tavern-question-sub" }, "当前回合的草稿与 Agent 执行进度")),
						h("span", { className: "dsh-sike-draft-phase", role: "status" }, draft ? draftPhaseLabel(draft) : executionTrace.length ? "处理中" : "尚未开始"),
						!props.embedded ? h("button", { type: "button", className: "dsh-tavern-btn", onClick: closeWindow, "aria-label": "关闭正文工作窗" }, "关闭") : null),
				!isPlayMode(mode) || !dreamMode ? h("div", { className: "dsh-tavern-empty" }, "本局未启用梦境思客DSH。") :
					h("div", { className: "dsh-sike-draft-body" },
						error ? h("div", { className: "dsh-card-error", role: "alert" }, "读取工作窗失败：" + error) : null,
						loading && !draft ? h("div", { className: "dsh-tavern-empty" }, "正在读取当前回合…") :
						!draft ? h(React.Fragment, null,
							h("div", { className: "dsh-tavern-empty" }, executionTrace.length ? "Agent 正在准备本回合正文。" : "当前没有正文草稿。开始新回合后，这里会显示 Agent 的工作进度。"),
							renderExecutionTrace()) :
						h(React.Fragment, null,
							h("div", { className: "dsh-sike-draft-meta" }, h("span", null, "版本 " + (Math.max(0, Number(draft.version) || 0) || 1)), h("span", null, "已修订 " + revisions + " 次")),
							renderWritingEvidence(),
							draft.resumable ? h("button", { type: "button", className: "dsh-tavern-btn dsh-sike-draft-resume", disabled: resuming, onClick: resume }, resuming ? "正在继续…" : "继续处理本回合") : null,
							draft.status === "committed" ? h("details", { className: "dsh-sike-draft-section dsh-sike-draft-completed" },
								h("summary", null, "正文已提交 · 展开查看"),
								h("pre", { className: "dsh-sike-draft-text" }, text)) : h("section", { className: "dsh-sike-draft-section", "aria-label": "当前正文" },
								h("h3", null, "当前正文"),
								text ? h("pre", { className: "dsh-sike-draft-text" }, text) : h("p", { className: "dsh-sike-draft-muted" }, "Agent 尚未写入正文。")),
							h("section", { className: "dsh-sike-draft-section", "aria-label": "修改摘要" },
								h("h3", null, "修改摘要"),
								changes.length ? h("ol", { className: "dsh-sike-draft-list" }, changes.slice(-6).map(function (change, index) {
									const label = typeof change === "string" ? change : change && typeof change === "object" ? (change.summary || change.reason || change.note || change.label || (typeof change.find === "string" ? "将“" + brief(change.find, 38) + "”改为“" + brief(change.replacement, 38) + "”" : "局部修改")) : "局部修改";
									return h("li", { key: index }, brief(label, 180));
								})) : h("p", { className: "dsh-sike-draft-muted" }, "尚无修订。"),
								checked ? h("div", { className: "dsh-sike-draft-checks" }, checks.length ? h(React.Fragment, null,
									"检查反馈：" + checks.length + " 条", h("ul", { className: "dsh-sike-draft-list" }, checks.slice(0, 8).map(function (issue, index) { return h("li", { key: index }, brief(issue && issue.message || issue, 180)); }))) : "当前版本检查通过") : null),
							renderExecutionTrace(),
							trace.length ? h("details", { className: "dsh-sike-draft-trace" },
								h("summary", null, "草稿处理记录 · " + trace.length + " 步"),
								h("ol", { className: "dsh-sike-draft-list" }, trace.slice(-12).map(function (entry, index) {
									return h("li", { key: index }, h("b", null, traceLabel(entry)), traceDetail(entry) ? h("span", null, traceDetail(entry)) : null);
								}))) : null)));
			}
			function DreamSikeDraftAction(props) {
				const owner = props.sessions.subagentAddress(props.sessionId)?.parentSessionId || props.sessionId;
				const mode = useTavernSessionMode(owner);
				const modeView = useLiveTavernView(owner, "dream-sike-action-mode", [["playPresetId"]]);
				const dreamMode = isPlayMode(mode) && modeView.view?.playPresetId === "dream-sike-dsh";
				React.useEffect(function () {
					if (!dreamMode || !wantsDraftWindow(owner)) return;
					let active = true;
					const timer = window.setTimeout(function () {
						if (active && props.sessions.list.getSnapshot().current === owner) void openTavernSidebarTab(props.ctx, { type: "dsh-tavern:dream-sike-draft" }, { sessionId: owner });
					}, 0);
					return function () { active = false; window.clearTimeout(timer); };
				}, [owner, dreamMode]);
				if (!dreamMode) return null;
				return React.createElement("button", { type: "button", className: "dsh-tavern-btn dsh-sike-draft-action", title: "打开本局正文工作窗", "aria-label": "打开正文工作窗", onClick: function () { rememberDraftWindow(owner, true); openTavernSidebarTab(props.ctx, { type: "dsh-tavern:dream-sike-draft" }, { sessionId: owner }); } },
					React.createElement("svg", { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" },
						React.createElement("path", { d: "M4 5h16M4 10h16M4 15h10M4 20h8" }), React.createElement("path", { d: "m15 18 4-4 2 2-4 4-3 1z" })),
					React.createElement("span", { className: "dsh-tavern-header-action-label" }, "正文工作窗"));
			}
			function DreamSikeMainTurnStatus(props) {
				const [phase, setPhase] = React.useState("读取资料");
				React.useEffect(function () {
					let active = true, pending = false;
					async function refresh() {
						if (!active || pending) return;
						pending = true;
						try {
							const result = await rpcWithTimeout("getDraftView", { sessionId: props.sessionId }, props.sessionId);
							if (active) setPhase(result.draft ? draftPhaseLabel(result.draft) : "读取资料");
						} catch (_) {} finally { pending = false; }
					}
					const timer = window.setInterval(refresh, 2500);
					void refresh();
					return function () { active = false; window.clearInterval(timer); };
				}, [props.sessionId]);
				return React.createElement("div", { className: "dsh-sike-main-status", role: "status" }, "梦境思客DSH · " + phase);
			}
			function register(input) {
				const ctx = input.ctx;
				const slots = input.slots;
                ctx.effect(() => tavernUiExtensions.service.registerWorkbenchPanel({ id: "tavern/draft", label: "正文与过程", description: "当前草稿、检查结果与执行记录", order: 20,
                    component: props => React.createElement(DreamSikeDraftTab, { sessionId: props.gameId, visible: props.visible, ctx, embedded: true })
                }), "dsh-tavern: draft workbench module");
			ctx.effect(function () {
				pageLeaving = false;
				function onPageHide() { pageLeaving = true; }
				window.addEventListener("beforeunload", onPageHide);
				window.addEventListener("pagehide", onPageHide);
				return function () { window.removeEventListener("beforeunload", onPageHide); window.removeEventListener("pagehide", onPageHide); };
			}, "dsh-tavern: Dream Sike window preference");
			ctx.effect(function () { return ctx.betterSidebar.registerTab({ id: "dsh-tavern:dream-sike-draft", title: "正文工作窗", order: 8, single: true,
					component: function (props) { return React.createElement(DreamSikeDraftTab, { sessionId: props.scope.sessionId, visible: props.visible, ctx: ctx, tabId: props.tab?.id }); }
				}); }, "dsh-tavern: Dream Sike draft tab");
				ctx.effect(function () { return slots.inject("conversation.session.header.utilities", function () { return slots.register(
					{ name: "conversation.session.header.utilities", id: "dsh-tavern:dream-sike-draft", order: 85 },
					function (props) { return React.createElement(DreamSikeDraftAction, Object.assign({}, props, { ctx: ctx, sessions: ctx.sessions })); }
				); }); }, "dsh-tavern: Dream Sike draft action");
			}
			return { register: register, MainTurnStatus: DreamSikeMainTurnStatus };
		}
		const dreamSikeDraftFeature = createDreamSikeDraftFeatureModule();
		const DreamSikeMainTurnStatus = dreamSikeDraftFeature.MainTurnStatus;
