import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { browserReactScript } from './fixtures/browser-react.mjs'

function fixture(name = '梦鲸思客V4-0915') {
  return {
    digest: 'initial', presetName: name,
    entries: [{ key: 'original', name: '角色分析', enabled: false, content: '作者原文', editableContent: true }],
    regexScripts: [], helperScripts: [],
    sourceSettings: { title: '梦鲸思客预设助手', description: '来自原助手的选项', errors: [], groups: [
      { id: 'style', label: '文风', mode: 'single', options: [
        { id: 'plain', label: '梦白话', status: 'active', enabled: true, available: true,
          compatibility: { status: 'supported', label: '已迁移', reason: '保留来源提示词' },
          prompts: [{ key: 'original-style', name: '梦白话文风', enabled: true, content: '作者原文 {{setvar::文风::原文}}' }] },
        { id: 'alternative', label: '说书', status: 'inactive', enabled: false, available: true, prompts: [] }
      ], variableInputs: [] },
      { id: 'plot', label: '剧情调查', mode: 'multiple', options: [
        { id: 'investigate', label: '剧情见解', status: 'inactive', enabled: false, available: true, prompts: [] },
        { id: 'prefill', label: 'Kimi 前缀', status: 'inactive', enabled: false, available: true,
          compatibility: { status: 'partial', label: '部分迁移', reason: '未启用 provider Partial Mode' }, prompts: [] },
        { id: 'missing', label: '原生推理格式校验', status: 'unmatched', enabled: false, available: false,
          compatibility: { status: 'unsupported', label: '尚不支持', reason: '原扩展专属检查' }, prompts: [] }
      ], variableInputs: [
        { id: 'chat:plot', label: '调查主题', variableId: 'plot', scope: 'chat', value: '原主题', available: true }
      ] },
      ...Array.from({ length: 11 }, (_, index) => ({ id: 'group-' + index, label: '来源分组 ' + index, mode: 'multiple', options: [], variableInputs: [] }))
    ] }
  }
}

async function mount(t, rpc) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch(process.platform === 'win32' ? { channel: 'msedge' } : {})
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.exposeFunction('testRpc', rpc)
  await page.setContent('<div id="root"></div>')
  await page.addScriptTag({ content: await browserReactScript() + `
    const React=modules.react, rpc=window.testRpc;
    const liveTavernView={invalidate(id){window.invalidations.push(id)}},notifyTavernDataChanged=()=>{};
    window.invalidations=[];
    ${await readFile(new URL('../tavern-plugin/src/client/features/preset-settings.js', import.meta.url), 'utf8')}
    const root=modules['react-dom/client'].createRoot(document.getElementById('root'));
    window.showSession=(sessionId,revision=0)=>root.render(React.createElement(TavernPresetSettings,{sessionId,revision}));
    window.showSession('first');
  ` })
  return page
}

test('统一原助手页面展示 13 组、原文、兼容状态，原子选择与变量保存，避免覆盖高级草稿', {
  skip: !process.env.TAVERN_BROWSER_TESTS, timeout: 30000
}, async t => {
  let snapshot = fixture(), fail = false
  const calls = []
  const page = await mount(t, async (method, args, sessionId) => {
    calls.push({ method, args, sessionId })
    if (method === 'getConversationPresetSettings') return { settings: snapshot }
    if (fail) throw Error('原子保存失败')
    const next = structuredClone(snapshot)
    if (args.changes.sourceAction && args.changes.sourceAction.value === undefined) {
      const action = args.changes.sourceAction
      const group = next.sourceSettings.groups.find(item => item.id === action.groupId)
      for (const option of group.options) {
        if (group.mode === 'single' || option.id === action.optionId) option.enabled = option.id === action.optionId && action.enabled
      }
    }
    if (args.changes.sourceAction?.value !== undefined) {
      const action = args.changes.sourceAction
      next.sourceSettings.groups.find(group => group.id === action.groupId).variableInputs.find(item => item.id === action.optionId).value = action.value
    }
    next.digest += '-saved'
    snapshot = next
    return { settings: snapshot }
  })
  await page.getByRole('heading', { name: '梦鲸思客预设助手' }).waitFor()
  assert.equal(await page.locator('[data-source-group]').count(), 13)
  await page.getByRole('radio', { name: '文风：说书', exact: true }).check()
  await page.getByText('已保存到本局，从下一回合生效', { exact: true }).waitFor()
  assert.deepEqual(calls.at(-1).args.changes, { sourceAction: { groupId: 'style', optionId: 'alternative', enabled: true } })
  assert.equal(await page.getByRole('radio', { name: '文风：梦白话', exact: true }).isChecked(), false)
  fail = true
  await page.getByRole('checkbox', { name: '剧情调查：剧情见解', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '原子保存失败' }).waitFor()
  assert.equal(await page.getByRole('checkbox', { name: '剧情调查：剧情见解', exact: true }).isChecked(), false)
  fail = false
  await page.getByRole('checkbox', { name: '剧情调查：剧情见解', exact: true }).check()
  await page.getByText('已保存到本局，从下一回合生效', { exact: true }).waitFor()
  assert.equal(await page.getByRole('checkbox', { name: '剧情调查：原生推理格式校验', exact: true }).isDisabled(), true)
  assert.equal(await page.locator('[data-compatibility="partial"]').textContent(), '部分迁移：未启用 provider Partial Mode')
  await page.getByLabel('剧情调查：调查主题', { exact: true }).fill('追踪线索')
  await page.getByRole('button', { name: '应用调查主题', exact: true }).click()
  await page.getByText('已保存到本局，从下一回合生效', { exact: true }).waitFor()
  assert.deepEqual(calls.at(-1).args.changes, { sourceAction: { groupId: 'plot', optionId: 'chat:plot', value: '追踪线索' } })
  await page.getByText('来源提示词原文（1）', { exact: true }).click()
  const original = page.getByLabel('文风：梦白话：梦白话文风原文', { exact: true })
  assert.equal(await original.inputValue(), '作者原文 {{setvar::文风::原文}}')
  assert.equal(await original.getAttribute('readonly'), '')
  await page.getByText('高级设置：规则、正则与脚本', { exact: true }).click()
  await page.getByText('剧情理解与角色（0/1）', { exact: true }).click()
  await page.getByText('角色分析 · 关闭', { exact: true }).click()
  await page.getByLabel('角色分析规则内容', { exact: true }).fill('未保存高级修改')
  await page.getByText('高级设置有未保存修改，请先保存或撤销，再切换原预设功能。', { exact: true }).waitFor()
  assert.equal(await page.getByRole('radio', { name: '文风：梦白话', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: '撤销未保存修改', exact: true }).click()
  assert.equal(await page.getByRole('radio', { name: '文风：梦白话', exact: true }).isDisabled(), false)
})

test('切换会话后拒绝过期设置读取和保存响应', {
  skip: !process.env.TAVERN_BROWSER_TESTS, timeout: 30000
}, async t => {
  let releaseGet, releaseSave
  const page = await mount(t, (method, args, sessionId) => {
    if (method === 'getConversationPresetSettings') {
      if (sessionId === 'first') return new Promise(resolve => { releaseGet = resolve })
      return { settings: fixture('会话 ' + sessionId) }
    }
    return new Promise(resolve => { releaseSave = resolve })
  })
  await page.getByText('正在读取本局预设…', { exact: true }).waitFor()
  await page.evaluate(() => window.showSession('second'))
  await page.getByText('会话 second', { exact: true }).waitFor()
  releaseGet({ settings: fixture('过期 first') })
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 20)))
  assert.equal(await page.getByText('过期 first', { exact: true }).count(), 0)
  await page.getByRole('radio', { name: '文风：说书', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('input[type="radio"]').disabled)
  await page.evaluate(() => window.showSession('third'))
  await page.getByText('会话 third', { exact: true }).waitFor()
  releaseSave({ settings: fixture('过期保存 second') })
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 20)))
  assert.equal(await page.getByText('过期保存 second', { exact: true }).count(), 0)
  assert.deepEqual(await page.evaluate(() => window.invalidations), [])
  assert.equal(await page.getByRole('radio', { name: '文风：梦白话', exact: true }).isChecked(), true)
})
