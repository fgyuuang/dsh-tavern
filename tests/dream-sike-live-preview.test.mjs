import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

const source = readFileSync(new URL('../tavern-plugin/src/client/modules/dream-sike-preview.js', import.meta.url), 'utf8')
const { decoder, visible } = runInNewContext(source + '\n({decoder:createDreamSikePreviewDecoder,visible:dreamSikePreviewVisibleText})')

test('incremental draft preview decodes only top-level text and handles escaped and partial JSON', () => {
  const read = decoder()
  const prose = '月光落在窗边。\n她说：“继续吧。”🙂'
  const raw = JSON.stringify({ review: { text: '不能显示的审稿字段' }, text: prose, brief: { text: '不能显示的准备字段' } })
  for (let end = 1; end <= raw.length; end++) {
    const preview = read.read(raw.slice(0, end))
    if (preview !== null) assert.ok(prose.startsWith(preview), `invalid prefix at ${end}`)
  }
  assert.equal(read.read(raw), prose)
  assert.equal(read.read('{"text":"第一版","text":"重复字段"}'), null)
  assert.equal(read.read('{"text":{} }'), null)
  assert.equal(read.read('{"text":"bad\\xescape"}'), null)
  assert.equal(read.read('{"text":"重新尝试"}'), '重新尝试')
})

test('preview hides private channels and unfinished tags, with nested reasoning kept private', () => {
  for (const tag of ['think', 'think_fox~', 'simple_thinking', 'dream_self_check', 'redemption_chain', 'thought_of_chain', 'thinking_step']) {
    const text = `开头<${tag}>秘密<${tag}>嵌套秘密</${tag}>仍然秘密</${tag}>后续正文`
    assert.equal(visible(text), '开头后续正文')
    assert.equal(visible(`开头<${tag}>秘密`), '开头')
  }
  assert.equal(visible('正文<thi'), '正文')
  assert.equal(visible('正文\n```reasoning\n秘密'), '正文\n')
  assert.equal(visible('<style>.x{color:red}</style><dream_body>正文</dream_body><script>unsafe()</script>'), '正文')
})

test('live preview lives in the transcript tail and is absent from the composer dock', () => {
  const renderer = readFileSync(new URL('../tavern-plugin/src/client/features/assistant-renderer.js', import.meta.url), 'utf8')
  const composer = readFileSync(new URL('../tavern-plugin/src/client/features/play-controls.js', import.meta.url), 'utf8')
  assert.match(renderer, /name: "conversation\.chat\.turnTail", id: "dsh-tavern:writing-turn-preview"/)
  assert.match(renderer, /props\.turn\?\.status === "open"/)
  assert.doesNotMatch(composer, /h\(DreamSikeLiveTextPreview/)
})

test('installed native SlotCore accepts the preview chain and native TurnTail supplies its real owner', {
  skip: !process.env.DSH_TAVERN_NATIVE_APP_ROOT
}, async () => {
  const root = process.env.DSH_TAVERN_NATIVE_APP_ROOT
  const nativeSlots = await import(pathToFileURL(join(root, 'node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js')))
  const { SlotCore } = nativeSlots
  const core = new SlotCore()
  core.register({ name: 'root', children: { 'conversation.chat.turnTail': { kind: 'chain', scope: 'session' } } }, () => null)
  const renderer = readFileSync(new URL('../tavern-plugin/src/client/features/assistant-renderer.js', import.meta.url), 'utf8')
  const begin = renderer.indexOf('return input.slots.inject("conversation.chat.turnTail"')
  const end = renderer.indexOf('\n                }, "dsh-tavern: read-only writing preview', begin)
  assert.ok(begin > 0 && end > begin)
  let view = { playPresetId: 'dream-sike-dsh', generationMode: 'agent' }
  const register = runInNewContext('(function(input){' + renderer.slice(begin, end) + '})', {
    liveTavernView: { getSnapshot: () => ({ view }) },
    isWritingAgentView: current => current?.generationMode === 'agent' && ['dream-sike-dsh', 'hushen-dsh'].includes(current.playPresetId),
    TavernWritingTurnPreview() {}
  })
  const dispose = register({ ctx: { sessions: { list: { getSnapshot: () => ({ current: 'game' }) } } },
    slots: { inject: (_name, callback) => callback(), register: (options, component) => core.register(options, component) } })
  const [entry] = core.entriesOfSlot('conversation.chat.turnTail')
  assert.equal(typeof entry.select, 'function')

  const native = readFileSync(join(root, 'node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js'), 'utf8')
  const nativeStart = native.indexOf('const TurnTailNodeView = ')
  const nativeEnd = native.indexOf('\n\t\t//#endregion', nativeStart)
  assert.ok(nativeStart > 0 && nativeEnd > nativeStart)
  const nativeTail = runInNewContext(native.slice(nativeStart, nativeEnd) + '\nTurnTailNodeView', {
    react: { memo: component => component }, react_jsx_runtime: { jsx: () => null },
    TurnTailNodeView_module_css_default: { root: 'tail' }
  })
  const renderSource = readFileSync(join(root, 'node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/client.js'), 'utf8')
  const bindStart = renderSource.indexOf('function materializeStandardBinding(')
  const bindEnd = renderSource.indexOf('/** Stable official-props', bindStart)
  assert.ok(bindStart > 0 && bindEnd > bindStart)
  const bind = runInNewContext(renderSource.slice(bindStart, bindEnd) + '\nmaterializeStandardBinding', {
    _deepseek_ai_dsh_client_ui_slots: nativeSlots,
    observableHook: source => selector => selector(source.getSnapshot())
  })
  const standard = bind({ props: { sessionId: 'game' }, hooks: { chat: { getSnapshot: () => ({ marker: 'native-chat-source' }) } }, keyedHooks: {} }, false)
  assert.equal(standard.sessionId, 'game')
  assert.equal(standard.useChat(snapshot => snapshot.marker), 'native-chat-source', 'native session hook materialization supplies useChat independently of TurnTail owner props')
  const turn = { turn: 8, status: 'open' }
  let owner
  nativeTail({ node: { key: 'tail:8', data: { turn: 8, seq: 19, closing: null }, location: { kind: 'turn', turn } },
    useChat: selector => selector({ locations: { getTurn: () => ['tail:8'] }, timeline: { turnOrder: [8] } }),
    openFile() {}, renderSlotChain: (name, props) => { assert.equal(name, 'conversation.chat.turnTail'); owner = props; return null } })
  assert.deepEqual(Object.keys(owner), ['turn', 'seq', 'openFile'])
  assert.equal(entry.select(owner), true)
  view = { playPresetId: 'hushen-dsh', generationMode: 'agent' }
  assert.equal(entry.select(owner), true)
  assert.equal(entry.select({ ...owner, turn: { ...turn, status: 'closed' } }), null)
  for (const other of [{ playPresetId: 'dream-sike-dsh', generationMode: 'sillytavern-once' }, { playPresetId: 'tavern' }, null]) {
    view = other
    assert.equal(entry.select(owner), null)
  }
  dispose()
  assert.equal(core.entriesOfSlot('conversation.chat.turnTail').length, 0)
})
