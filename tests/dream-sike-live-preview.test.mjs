import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

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
