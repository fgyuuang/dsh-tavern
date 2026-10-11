import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { stubFrameDependencyImports } from './fixtures/frame-dependency-imports.mjs'
import { readFile } from 'node:fs/promises'
const lodash = await readFile(new URL('../tavern-plugin/lib/vendor/runtime-assets/lodash/lodash.min.js', import.meta.url), 'utf8')
const source = await readFile(process.env.FRAME_TEST_CLIENT || new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
function fixture() {
  let descriptor
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load(d) { descriptor = d } } } })
  const client = descriptor.factory(() => ({}))
  const html = client.buildTavernFrameDocument({ token: 'frame', turn: 1, content: '', helperContext: {
    characterVariables: { unrelated: 1, start_presets: { presets: [] } }, globalVariables: { shared: 2 },
    scriptVariables: { a: {count:1}, b: {count:7} },
    messages: [{ message_id: 0, variables: { stat_data: { 主角: { 姓名: '旧' } } } }], turnMessageIds: { 1: 0 }
  } })
  const calls = [], listeners = []
  const parent = { postMessage(m) { calls.push(m) } }
  const w = { parent, structuredClone, console: { info() {}, warn() {}, error() {} }, addEventListener(name, fn) { if (name === 'message') listeners.push(fn) } }
  w.window = w
  const context = vm.createContext(w)
  vm.runInContext(lodash, context)
  let script = html.match(/<script data-dsh-tavern-helper>([\s\S]*?)<\/script>/)[1]
  script = stubFrameDependencyImports(script)
  vm.runInContext(script, context)
  vm.runInContext(html.match(/<script data-dsh-tavern-frame-variable-aliases>([\s\S]*?)<\/script>/)[1], context)
  return { w, calls, reply(result = { updated: true }, ok = true) { for (const fn of listeners) fn({ source: parent, data: { type: 'dsh-tavern-helper-response', token: 'frame', requestId: calls.at(-1).requestId, ok, result, error: '保存失败' } }) } }
}
test('状态栏 script 作用域读写隔离，失败回滚不污染消息或其他脚本', async () => {
  const h=fixture(), option={type:'script',script_id:'a'}, w=h.w
  assert.equal(w.getVariables(option).count,1)
  const message=JSON.stringify(w.getVariables({type:'message'}))
  const pending=w.insertOrAssignVariables({count:2},option)
  assert.equal(w.getVariables(option).count,2)
  assert.equal(w.getVariables({type:'script',script_id:'b'}).count,7)
  assert.equal(JSON.stringify(w.getVariables({type:'message'})),message)
  h.reply(); await pending
  const failed=w.replaceVariables({count:3},option)
  h.reply({},false)
  await assert.rejects(failed,/保存失败/)
  assert.equal(w.getVariables(option).count,2)
  assert.equal(JSON.stringify(w.getVariables({type:'message'})),message)
})

test('前端非标准 updateVariable 写入本楼 stat_data 嵌套路径，保留 Helper 字面键语义', async () => {
  const h = fixture()
  const pending = h.w.updateVariable('环境与剧情.开局激活', true)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.calls.at(-1).args.option.message_id, 0)
  assert.equal(h.calls.at(-1).args.variables.stat_data.环境与剧情.开局激活, true)
  assert(!Object.hasOwn(h.calls.at(-1).args.variables, '环境与剧情.开局激活'))
  h.reply(); await pending
  assert.equal(h.w.getAllVariables().stat_data.环境与剧情.开局激活, true)
  assert.equal(h.w.getAllVariables().stat_data.主角.姓名, '旧')
  const literal = h.w.insertOrAssignVariables({ 'custom.literal': 1 })
  h.reply(); await literal
  assert.equal(h.w.getVariables()['custom.literal'], 1)
})

test('前端路径写入串行合并，失败回滚后仍可继续，拒绝原型路径', async () => {
  const h = fixture()
  const first = h.w.updateVariable('stat_data.环境与剧情.基础世界', '验证世界')
  const second = h.w.updateVariable('环境与剧情.开局模式', '验证模式')
  await new Promise(resolve => setImmediate(resolve))
  h.reply(); await first
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.calls.at(-1).args.variables.stat_data.环境与剧情.基础世界, '验证世界')
  h.reply(); await second
  const failed = h.w.updateVariable('环境与剧情.开局模式', '失败')
  await new Promise(resolve => setImmediate(resolve))
  h.reply({}, false); await assert.rejects(failed, /保存失败/)
  assert.equal(h.w.getAllVariables().stat_data.环境与剧情.开局模式, '验证模式')
  const recovered = h.w.updateVariable('环境与剧情.开局激活', true)
  await new Promise(resolve => setImmediate(resolve))
  h.reply(); await recovered
  for (const path of ['', '__proto__.polluted', 'stat_data.constructor.prototype.polluted']) {
    await assert.rejects(h.w.updateVariable(path, true), /无效/)
  }
  assert.equal({}.polluted, undefined)
})

test('自定义建档 MVU 写入 latest 并等待保存，失败回滚且不宣称成功', async () => {
  const h = fixture(), option = { type: 'message', message_id: 'latest' }
  const pending = h.w.Mvu.replaceMvuData({ stat_data: { 主角: { 姓名: '新' } } }, option)
  await new Promise(resolve => setImmediate(resolve))
  h.reply(); await pending
  assert.equal(h.w.Mvu.getMvuData(option).stat_data.主角.姓名, '新')
  const failed = h.w.Mvu.replaceMvuData({ stat_data: { 主角: { 姓名: '失败' } } }, option)
  await new Promise(resolve => setImmediate(resolve))
  h.reply({}, false)
  await assert.rejects(failed, /保存失败/)
  assert.equal(h.w.Mvu.getMvuData(option).stat_data.主角.姓名, '新')
})
