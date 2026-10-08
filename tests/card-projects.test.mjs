import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createCardProjects } from '../tavern-plugin/lib/domain/card-projects.js'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'card-projects-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = createProfileDataStore({ dataRoot: root })
  return { store, projects: createCardProjects({ store }) }
}

test('人物卡项目跨重启保持标识，并发开局只建立一个项目', async t => {
  const { store, projects } = await fixture(t)
  assert.deepEqual(await projects.list(), [])
  assert.equal(await store.readJson('card-projects.json'), undefined)
  const results = await Promise.all(Array.from({ length: 8 }, () => projects.ensure('cards\\梦境.json', '梦境')))
  assert.equal(new Set(results.map(project => project.id)).size, 1)
  assert.match(results[0].id, /^project-[0-9a-f-]{36}$/)
  assert.equal(results[0].cardPath, 'cards/梦境.json')
  const restarted = createCardProjects({ store })
  assert.deepEqual(await restarted.ensure('cards/梦境.json', '其他对话标题'), results[0])
  assert.deepEqual(await restarted.list([{ path: 'cards/梦境.json' }]), [results[0]])
})

test('改名保留项目，删除保留历史身份，同路径重新导入建立新项目', async t => {
  const { projects } = await fixture(t)
  const original = await projects.ensure('cards/old.json', '原项目')
  const historicalSession = { id: 'old-chat', cardPath: 'cards/old.json', projectId: original.id }
  assert.equal((await projects.movePath('cards/old.json', 'cards/new.json')).id, original.id)
  assert.equal((await projects.movePath('cards/old.json', 'cards/new.json')).id, original.id)
  assert.equal((await projects.ensure('cards/new.json')).id, original.id)
  await projects.movePath('cards/new.json', null)
  await projects.movePath('cards/new.json', null)
  assert.deepEqual(await projects.list(['cards/new.json']), [])
  assert.equal((await projects.list())[0].cardPath, null)
  const replacement = await projects.ensure('cards/old.json', '重新导入')
  assert.notEqual(replacement.id, original.id)
  const sessions = await projects.projectSessions([historicalSession, { id: 'new-chat', cardPath: 'cards/old.json' }])
  assert.equal(sessions[0].projectId, original.id)
  assert.equal(sessions[1].projectId, replacement.id)
  assert.equal((await projects.list()).length, 2)
})

test('批量归属不信任外部项目 ID，按唯一卡路径迁移，保留输入和顺序', async t => {
  const { projects } = await fixture(t)
  const rows = [
    { id: 'first', cardPath: 'cards/a.json', cardName: 'A', projectId: 'project-from-another-install' },
    { id: 'second', cardPath: 'cards/a.json', cardName: '另一个对话' },
    { id: 'third', cardPath: 'cards/b.json', cardName: 'B' },
    { id: 'workbench', cardPath: '', projectId: 'project-unknown' }
  ]
  const result = await projects.projectSessions(rows)
  assert.deepEqual(result.map(row => row.id), rows.map(row => row.id))
  assert.equal(result[0].projectId, result[1].projectId)
  assert.notEqual(result[0].projectId, rows[0].projectId)
  assert.notEqual(result[0].projectId, result[2].projectId)
  assert.equal('projectId' in result[3], false)
  assert.equal(rows[0].projectId, 'project-from-another-install')
  assert.equal('projectId' in rows[1], false)
  assert.equal((await projects.list()).length, 2)
  const cards = await projects.projectCards([{ path: 'cards/a.json', name: 'A' }])
  assert.equal(cards[0].projectId, result[0].projectId)
})

test('拒绝非法路径和改名冲突，批量失败不留下部分项目', async t => {
  const { projects } = await fixture(t)
  for (const resourcePath of ['../cards/a.json', 'worldbooks/a.json', 'cards', 'cards/../cards/a.json', 'D:/cards/a.json']) {
    await assert.rejects(projects.ensure(resourcePath))
  }
  await assert.rejects(projects.projectSessions([{ cardPath: 'cards/valid.json' }, { cardPath: '../cards/invalid.json' }]))
  assert.deepEqual(await projects.list(), [])
  const source = await projects.ensure('cards/a.json')
  const target = await projects.ensure('cards/b.json')
  await assert.rejects(projects.movePath('cards/a.json', 'cards/b.json'), /其他项目/)
  assert.equal((await projects.ensure('cards/a.json')).id, source.id)
  assert.equal((await projects.ensure('cards/b.json')).id, target.id)
})
