import test from 'node:test'
import assert from 'node:assert/strict'
import { gameWorldbookView, readGameWorldbook } from '../tavern-plugin/lib/domain/game-worldbook-view.js'
import { inspectWorldBookDocument } from '../tavern-plugin/lib/domain/worldbook-resource.js'

const source = { kind: 'standalone', path: 'worldbooks/test.json' }
function record(enabled = true) {
 const document = { name: '规则', entries: {
  0: { uid: 0, comment: '剧情', content: '正文', constant: true, disable: !enabled },
  1: { uid: 1, comment: '[mvu_update]变量规则', content: '后台', constant: true },
  2: { uid: 2, comment: '触发', content: '动态', constant: false },
  3: { uid: 3, comment: '关闭', content: '暂不使用', disable: true }
 } }
 return { source, document, view: inspectWorldBookDocument(document) }
}
test('世界书状态区分剧情、动态、后台规则，保留禁用条目且紧凑视图不携带正文', () => {
 const view = gameWorldbookView(record(), 'snapshot', false)
 assert.deepEqual(view.counts, { total: 4, enabled: 3, constant: 1, dynamic: 1, mvuRules: 1 })
 assert.equal(view.entries[3].enabled, false)
 assert.ok(view.entries.every(entry => !Object.hasOwn(entry, 'content')))
 assert.notEqual(view.revision, gameWorldbookView(record(false)).revision)
 assert.equal(gameWorldbookView(null).counts.total, 0)
})
test('本局视图使用快照而资源库摘要使用现场资源，不写入聊天', async () => {
 const chat = { mode: 'story', cardPath: 'cards/test.json', openingWorldbookSnapshot: { version: 1 } }
 const before = structuredClone(chat)
 const view = await readGameWorldbook({ chat, card: {}, worldBooks: { bound: async (_path, _card, candidate) => record(!candidate.openingWorldbookSnapshot) }, updateStatus: async () => ({ digest: 'v2', worldbookChanged: true }) })
 assert.equal(view.scope, 'snapshot'); assert.equal(view.counts.enabled, 2)
 assert.equal(view.library.counts.enabled, 3); assert.equal(view.update.digest, 'v2')
 assert.deepEqual(chat, before)
})
test('资源库损坏仍允许查看游戏快照，并给出同步错误', async () => {
 const view = await readGameWorldbook({ chat: { mode: 'story', openingWorldbookSnapshot: { version: 1 } }, card: {}, worldBooks: { bound: async (_path, _card, chat) => { if (!chat.openingWorldbookSnapshot) throw Error('资源不存在'); return record() } }, updateStatus: async () => ({ error: '资源不存在' }) })
 assert.equal(view.entries.length, 4); assert.match(view.library.error, /不存在/)
 await assert.rejects(readGameWorldbook({ chat: { mode: 'card' } }), /游玩/)
})
