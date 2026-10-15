import test from 'node:test'
import assert from 'node:assert/strict'
import { createConversationModelSettings } from '../tavern-plugin/lib/domain/conversation-model-settings.js'

const front = { provider: 'saved', model: 'front' }, worker = { provider: 'saved', model: 'worker' }
function fixture() {
  let chat = { id: 'game', sessionId: 'native', _storageRevision: 1, messages: ['history'], variables: { n: 3 }, backgroundModelSelection: worker }
  let selected = front, settings = {}, busy = false, failUpdate = false, writes = 0, failSelect = false
  const service = createConversationModelSettings({
    read: async () => structuredClone(chat), selection: () => selected,
    catalog: async () => [{ provider: 'saved', models: [{ id: 'front' }, { id: 'worker' }] }],
    resolve: async route => { if (route.reasoningEffort === 'bad') throw Error('推理强度不可用'); return route },
    isBusy: () => busy, readSettings: async () => settings,
    updateSettings: async patch => { settings = { ...settings, ...patch }; return settings },
    select: async (_id, route) => { selected = route; if (failSelect) { failSelect = false; throw Error('flush failed') } },
    update: async (_id, mutation) => { if (failUpdate) throw Error('storage failed'); chat = mutation(chat); writes++; return chat }
  })
  return { service, setBusy: v => { busy = v }, failUpdate: () => { failUpdate = true }, failSelect: () => { failSelect = true },
    nativeSwitch: route => { selected = route }, snapshot: () => ({ chat, selected, settings, writes }) }
}

test('统一前后台保留历史变量，继承实际后台路由且原生选择器同步', async () => {
  const f = fixture(), before = structuredClone(f.snapshot().chat)
  let result = await f.service.apply('native', { models: { foregroundModel: worker, backgroundModel: null } })
  assert.deepEqual(result.foregroundModel, worker); assert.equal(result.backgroundModel, null)
  assert.deepEqual(result.effectiveBackgroundModel, worker)
  assert.deepEqual(f.snapshot().chat.messages, before.messages); assert.deepEqual(f.snapshot().chat.variables, before.variables)
  f.nativeSwitch(front); result = await f.service.get('native')
  assert.deepEqual(result.foregroundModel, front); assert.deepEqual(result.effectiveBackgroundModel, front)
})

test('前后台忙、无效供应商或无效强度时不改变任何选择', async () => {
  const f = fixture(), before = structuredClone(f.snapshot())
  f.setBusy(true)
  await assert.rejects(f.service.apply('native', { models: { foregroundModel: worker } }), /前后台任务/)
  f.setBusy(false)
  await assert.rejects(f.service.apply('native', { models: { foregroundModel: worker, backgroundModel: { provider: 'missing', model: 'm' } } }), /不可用/)
  await assert.rejects(f.service.apply('native', { models: { backgroundModel: { ...worker, reasoningEffort: 'bad' } } }), /推理强度/)
  await assert.rejects(f.service.apply('native', { models: { foregroundModel: null } }), /配置无效/)
  assert.deepEqual(f.snapshot(), before)
})

test('后台保存或前台持久化失败时补偿恢复原模型', async () => {
  for (const failure of ['failUpdate', 'failSelect']) {
    const f = fixture(), before = structuredClone(f.snapshot()); f[failure]()
    await assert.rejects(f.service.apply('native', { models: { foregroundModel: worker, backgroundModel: front } }), /failed/)
    assert.deepEqual(f.snapshot(), before)
  }
})

test('集中页新游戏默认修改不改已有本局模型，未知范围和字段被拒绝', async () => {
  const f = fixture(), before = structuredClone(f.snapshot().chat)
  const result = await f.service.apply('native', { scope: 'new-games', models: { defaultForegroundModel: worker, defaultBackgroundModel: null, defaultWorkbenchModel: front } })
  assert.deepEqual(result.defaults, { defaultForegroundModel: worker, defaultBackgroundModel: null, defaultWorkbenchModel: front, defaultImageModel: null })
  assert.deepEqual(f.snapshot().chat, before); assert.deepEqual(result.foregroundModel, front)
  await assert.rejects(f.service.apply('native', { scope: 'all-sessions', models: { foregroundModel: worker } }), /范围无效/)
  await assert.rejects(f.service.apply('native', { models: { providers: {} } }), /设置项无效/)
})
