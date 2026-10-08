		// A request belongs to exactly one visible session, query, document and page.
		function createGameMemoryReader(request) {
			let generation = 0;
			return {
				cancel: function () { generation += 1; },
				read: async function (args, onValue, onError, onFinish) {
					const current = ++generation;
					try {
						const result = await request(args);
						if (current === generation) onValue(result && result.memory || {});
					} catch (error) {
						if (current === generation) onError(String(error && error.message || error));
					} finally { if (current === generation && onFinish) onFinish(); }
				}
			};
		}
		function createGameMemoryFeatureModule() {
			const pageSize = 20;
			const textPageSize = 6000;
			const css = '.dsh-game-memory{height:100%;min-height:0;display:flex;flex-direction:column;overflow:auto}.dsh-game-memory-body{padding:12px;display:flex;flex-direction:column;gap:12px;min-width:0}.dsh-game-memory-form,.dsh-game-memory-pages{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.dsh-game-memory-form input{flex:1;min-width:100px;padding:8px;color:inherit;background:var(--dsw-specific-input-major);border:1px solid var(--dsw-alias-border-l2);border-radius:6px}.dsh-game-memory-files{display:flex;flex-direction:column;gap:8px;list-style:none;margin:0;padding:0}.dsh-game-memory-file{width:100%;text-align:left;padding:10px;white-space:normal;overflow-wrap:anywhere}.dsh-game-memory-file small{display:block;opacity:.7;margin-top:5px}.dsh-game-memory-file p{margin:6px 0 0;white-space:pre-wrap;font-weight:normal}.dsh-game-memory-text{margin:0;padding:12px;white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;line-height:1.65;border:1px solid var(--dsw-alias-border-l2);border-radius:8px}.dsh-game-memory-meta{font-size:12px;opacity:.75;overflow-wrap:anywhere}.dsh-game-memory-document h3{font-size:14px;overflow-wrap:anywhere;margin:0 0 10px}.dsh-game-memory-pages{justify-content:space-between;font-size:12px}.dsh-game-memory-help{font-size:12px;line-height:1.6;opacity:.75}';
			function GameMemoryView(props) {
				const h = React.createElement;
				const sessionId = props.sessionId;
				const mode = useTavernSessionMode(sessionId);
				const [input, setInput] = React.useState('');
				const [query, setQuery] = React.useState('');
				const [offset, setOffset] = React.useState(0);
				const [path, setPath] = React.useState('');
				const [textOffset, setTextOffset] = React.useState(0);
				const [refresh, setRefresh] = React.useState(0);
				const [result, setResult] = React.useState(null);
				const [failure, setFailure] = React.useState(null);
				const reader = React.useMemo(function () {
					return createGameMemoryReader(function (args) { return rpcWithTimeout('getGameMemory', args, sessionId); });
				}, [sessionId]);
				const requestKey = JSON.stringify([sessionId, path, query, offset, textOffset, refresh]);
				const memory = result && result.key === requestKey ? result.memory : null;
				const error = failure && failure.key === requestKey ? failure.error : '';
				const loading = !memory && !error;
				React.useEffect(function () {
					if (!props.visible || !sessionId || !isPlayMode(mode)) { reader.cancel(); return; }
					const args = path ? { sessionId: sessionId, action: 'read', path: path, offset: textOffset, limit: textPageSize } : query ? { sessionId: sessionId, action: 'search', query: query, limit: 8 } : { sessionId: sessionId, action: 'list', offset: offset, limit: pageSize };
					setResult(null); setFailure(null);
					void reader.read(args,
						function (value) {
							if (path && value.status === 'found' && textOffset > 0 && textOffset >= value.total) { setTextOffset(0); return; }
							if (!path && !query && offset > 0 && offset >= value.total) { setOffset(0); return; }
							setResult({ key: requestKey, memory: value }); setFailure(null);
						},
						function (message) { setFailure({ key: requestKey, error: message }); });
					return function () { reader.cancel(); };
				}, [requestKey, props.visible, mode, reader]);
				React.useEffect(function () {
					if (!props.visible) return;
					function reload() { reader.cancel(); setRefresh(function (value) { return value + 1; }); }
					function onData(event) { if (tavernDataChangeAffects(event, ['sessions', 'memory', 'game-memory'])) reload(); }
					window.addEventListener('dsh-tavern-data-changed', onData);
					window.addEventListener('focus', reload);
					let stop = function () {};
					try { if (tavernSessionSignals && typeof tavernSessionSignals.subscribe === 'function') stop = tavernSessionSignals.subscribe(sessionId, 'tavern-state', reload); } catch (_) {}
					return function () { stop(); window.removeEventListener('dsh-tavern-data-changed', onData); window.removeEventListener('focus', reload); };
				}, [sessionId, props.visible, reader]);
				function invalidate() { reader.cancel(); setRefresh(function (value) { return value + 1; }); }
				function choose(item) { reader.cancel(); setPath(item.path); setTextOffset(0); }
				function showList() { reader.cancel(); setPath(''); setTextOffset(0); }
				function search(event) { event.preventDefault(); reader.cancel(); setQuery(input.trim()); setPath(''); setOffset(0); setTextOffset(0); invalidate(); }
				function clearSearch() { reader.cancel(); setInput(''); setQuery(''); setPath(''); setOffset(0); setTextOffset(0); }
				const files = memory ? (query ? memory.matches : memory.files) || [] : [];
				const total = Math.max(0, Number(memory && memory.total) || 0);
				function pageControls(position, size, next, update) {
					return h('nav', { className: 'dsh-game-memory-pages', 'aria-label': path ? '文档分页' : '文档列表分页' },
						h('button', { type: 'button', className: 'dsh-tavern-btn', disabled: position <= 0, onClick: function () { reader.cancel(); update(Math.max(0, position - size)); } }, '上一页'),
						h('span', null, total ? (position + 1) + '–' + Math.min(total, position + size) + ' / ' + total + (path ? ' 字符' : ' 份') : path ? '0 字符' : '0 份'),
						h('button', { type: 'button', className: 'dsh-tavern-btn', disabled: !Number.isSafeInteger(next), onClick: function () { reader.cancel(); update(next); } }, '下一页'));
				}
				return h('aside', { className: 'dsh-tavern-status dsh-game-memory', 'aria-label': '本局记忆' }, h('style', null, css + '.dsh-tavern-status.dsh-game-memory .dsh-game-memory-file{display:block;height:auto;min-height:44px;line-height:1.5;white-space:normal;min-width:0;max-width:100%;overflow-wrap:anywhere}.dsh-tavern-status.dsh-game-memory .dsh-game-memory-file strong,.dsh-tavern-status.dsh-game-memory .dsh-game-memory-file small{display:block;white-space:normal;overflow-wrap:anywhere;max-width:100%}'),
					h('header', { className: 'dsh-tavern-status-head' }, h('div', { className: 'dsh-tavern-status-title' }, '本局记忆'), h('span', { className: 'dsh-tavern-question-sub' }, '当前分支 · 只读'), h('button', { type: 'button', className: 'dsh-tavern-btn', onClick: invalidate }, '刷新')),
					!isPlayMode(mode) ? h('div', { className: 'dsh-tavern-empty' }, '请打开一个游玩对话查看本局记忆。') : h('div', { className: 'dsh-game-memory-body' },
						h('form', { className: 'dsh-game-memory-form', onSubmit: search }, h('input', { type: 'search', value: input, maxLength: 200, placeholder: '搜索人物、线索或文档', 'aria-label': '搜索本局记忆', onChange: function (event) { setInput(event.target.value); } }), h('button', { type: 'submit', className: 'dsh-tavern-btn' }, '搜索'), query ? h('button', { type: 'button', className: 'dsh-tavern-btn', onClick: clearSearch }, '全部文档') : null),
						path ? h('button', { type: 'button', className: 'dsh-tavern-btn', onClick: showList, style: { alignSelf: 'flex-start' } }, '← 返回文档列表') : null,
						error ? h('div', { className: 'dsh-card-error', role: 'alert' }, '读取记忆失败：' + error, h('button', { type: 'button', className: 'dsh-tavern-btn', onClick: invalidate }, '重试')) : null,
						loading ? h('div', { className: 'dsh-tavern-empty', role: 'status' }, '正在读取本局记忆…') : null,
						memory ? h(React.Fragment, null,
							h('div', { className: 'dsh-game-memory-meta' }, '分支：' + (memory.branchId || '当前分支') + ' · 剧情版本 ' + (Number.isSafeInteger(memory.revision) ? memory.revision : '未知'), memory.head ? h('div', { title: memory.head }, '记忆版本：' + String(memory.head).slice(0, 12)) : null),
							path ? h('section', { className: 'dsh-game-memory-document', 'aria-label': '记忆文档' }, h('h3', null, path), memory.status === 'not-found' ? h('div', { className: 'dsh-tavern-empty' }, '当前分支没有这份文档。文档可能已更新或随回退撤销，请返回列表。') : h(React.Fragment, null, h('pre', { className: 'dsh-game-memory-text' }, typeof memory.text === 'string' ? memory.text : memory.content || ''), pageControls(textOffset, textPageSize, memory.nextOffset, setTextOffset))) :
							h(React.Fragment, null,
								query ? h('div', { className: 'dsh-game-memory-meta' }, '“' + query + '”匹配 ' + total + ' 份文档' + (total > files.length ? '，展示前 ' + files.length + ' 份；可细化搜索词。' : '。')) : null,
								files.length ? h('ul', { className: 'dsh-game-memory-files' }, files.map(function (item) { return h('li', { key: item.path }, h('button', { type: 'button', className: 'dsh-tavern-btn dsh-game-memory-file', onClick: function () { choose(item); } }, h('strong', null, item.path), h('small', null, Math.max(0, Number(item.bytes) || 0) + ' 字节' + (item.source && Number.isSafeInteger(item.source.turn) ? ' · 更新于第 ' + item.source.turn + ' 回合' : '')), typeof item.excerpt === 'string' ? h('p', null, item.excerpt) : null)); })) : h('div', { className: 'dsh-tavern-empty' }, query ? '没有匹配的记忆文档。' : '本局尚无记忆文档。Agent 确认正文并完成后台结算后，会维护场景、人物记忆和未完成线索。'),
								!query && total > 0 ? pageControls(offset, pageSize, memory.nextOffset, setOffset) : null),
							h('p', { className: 'dsh-game-memory-help' }, memory.enabled ? 'Agent 正在使用本局持久记忆。文档随剧情分支和回退恢复；JSON、CSV 与 Markdown 均按原文展示。' : '本局可查看已有文档。切换到梦境思客DSH 后，Agent 将开始维护持久记忆。')) : null));
			}
			function GameMemoryTab(props) { return React.createElement(GameMemoryView, Object.assign({}, props, { key: props.sessionId })); }
			function GameMemoryAction(props) {
				const owner = props.sessions.subagentAddress(props.sessionId)?.parentSessionId || props.sessionId;
				if (!isPlayMode(useTavernSessionMode(owner))) return null;
				return React.createElement('button', { type: 'button', className: 'dsh-tavern-btn', title: '查看当前分支的场景、人物与线索文档', 'aria-label': '打开本局记忆', onClick: function () { void openTavernSidebarTab(props.ctx, { type: 'dsh-tavern:game-memory' }, { sessionId: owner }); } }, React.createElement('span', null, '本局记忆'));
			}
			function register(input) {
				const ctx = input.ctx, slots = input.slots;
				ctx.effect(function () { return ctx.betterSidebar.registerTab({ id: 'dsh-tavern:game-memory', title: '本局记忆', order: 8, single: true, component: function (props) { return React.createElement(GameMemoryTab, { sessionId: props.scope.sessionId, visible: props.visible }); } }); }, 'dsh-tavern: game memory tab');
				ctx.effect(function () { return slots.inject('conversation.session.header.utilities', function () { return slots.register({ name: 'conversation.session.header.utilities', id: 'dsh-tavern:game-memory', order: 86 }, function (props) { return React.createElement(GameMemoryAction, Object.assign({}, props, { ctx: ctx, sessions: ctx.sessions })); }); }); }, 'dsh-tavern: game memory action');
			}
			return Object.freeze({ register: register });
		}
		const gameMemoryFeature = createGameMemoryFeatureModule();
