import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { browserReactScript } from './fixtures/browser-react.mjs'
import { inspectPreset } from '../tavern-plugin/lib/domain/preset-reading.js'
import { conversationPresetSettings } from '../tavern-plugin/lib/domain/conversation-preset-settings.js'

function fixture(name = '梦鲸思客V4-0915') {
  return {
    digest: 'initial', presetName: name,
    entries: [{ key: 'original', name: '角色分析', enabled: false, content: '作者原文', editableContent: true }],
    regexScripts: [], helperScripts: [],
    agentPreset: { title: '梦境思客DSH', enabled: true, stages: [
      { id: 'role-scene', label: '角色与场景', groupIds: ['style'] },
      { id: 'narration', label: '叙事与文风', groupIds: [] },
      { id: 'planning', label: '思考与检索', groupIds: ['plot'] },
      { id: 'output', label: '输出与共创', groupIds: [] },
      { id: 'review-state', label: '审稿与状态', groupIds: [] },
      { id: 'model', label: '模型与兼容', groupIds: [] }
    ] },
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
  await page.setContent('<main class="dsh-local-settings"><div class="dsh-local-section"><div id="root"></div></div></main>')
  await page.addStyleTag({ content: await readFile(new URL('../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8') })
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
  await page.getByRole('heading', { name: '梦境思客DSH' }).waitFor()
  assert.equal(await page.getByRole('tab').count(), 6)
  assert.equal(await page.locator('[data-compatibility="supported"]').count(), 0)
  await page.getByRole('combobox', { name: '文风', exact: true }).selectOption('alternative')
  await page.getByText('已保存到本局，从下一回合生效', { exact: true }).waitFor()
  assert.deepEqual(calls.at(-1).args.changes, { sourceAction: { groupId: 'style', optionId: 'alternative', enabled: true } })
  assert.equal(await page.getByRole('combobox', { name: '文风', exact: true }).inputValue(), 'alternative')
  await page.getByRole('tab', { name: '思考与检索', exact: true }).click()
  fail = true
  await page.getByRole('switch', { name: '剧情调查：剧情见解', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '原子保存失败' }).waitFor()
  assert.equal(await page.getByRole('switch', { name: '剧情调查：剧情见解', exact: true }).isChecked(), false)
  fail = false
  await page.getByRole('switch', { name: '剧情调查：剧情见解', exact: true }).check()
  await page.getByText('已保存到本局，从下一回合生效', { exact: true }).waitFor()
  assert.equal(await page.getByRole('switch', { name: '剧情调查：原生推理格式校验', exact: true }).isDisabled(), true)
  assert.equal(await page.locator('[data-compatibility="partial"]').textContent(), '部分迁移未启用 provider Partial Mode')
  assert.equal(await page.locator('[data-compatibility="partial"]').getAttribute('open'), null)
  await page.getByLabel('剧情调查：调查主题', { exact: true }).fill('追踪线索')
  await page.getByRole('button', { name: '应用调查主题', exact: true }).click()
  await page.getByText('已保存到本局，从下一回合生效', { exact: true }).waitFor()
  assert.deepEqual(calls.at(-1).args.changes, { sourceAction: { groupId: 'plot', optionId: 'chat:plot', value: '追踪线索' } })
  await page.getByRole('tab', { name: '角色与场景', exact: true }).click()
  await page.getByRole('button', { name: '查看文风原文', exact: true }).click()
  await page.getByRole('dialog').locator('summary').filter({ hasText: '梦白话' }).click()
  const original = page.getByLabel('文风：梦白话：梦白话文风原文', { exact: true })
  assert.equal(await original.inputValue(), '作者原文 {{setvar::文风::原文}}')
  assert.equal(await original.getAttribute('readonly'), '')
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('dialog').count(), 0)
  assert.equal(await page.getByRole('button', { name: '查看文风原文', exact: true }).evaluate(e => e === document.activeElement), true)
  await page.getByText('高级设置：规则、正则与脚本', { exact: true }).click()
  await page.getByText('剧情理解与角色（0/1）', { exact: true }).click()
  await page.getByText('角色分析 · 关闭', { exact: true }).click()
  await page.getByLabel('角色分析规则内容', { exact: true }).fill('未保存高级修改')
  await page.getByText('高级设置有未保存修改，请先保存或撤销，再切换原预设功能。', { exact: true }).waitFor()
  assert.equal(await page.getByRole('combobox', { name: '文风', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: '撤销未保存修改', exact: true }).click()
  assert.equal(await page.getByRole('combobox', { name: '文风', exact: true }).isDisabled(), false)
  await page.getByRole('tab', { name: '角色与场景', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  assert.equal(await page.getByRole('tab', { name: '叙事与文风', exact: true }).getAttribute('aria-selected'), 'true')
  await page.keyboard.press('End')
  assert.equal(await page.getByRole('tab', { name: '模型与兼容', exact: true }).getAttribute('aria-selected'), 'true')
  await page.getByLabel('搜索预设功能', { exact: true }).fill('说书')
  assert.equal(await page.getByRole('combobox', { name: '文风', exact: true }).locator('option[value="alternative"]').count(), 1)
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
  await page.getByRole('combobox', { name: '文风', exact: true }).selectOption('alternative')
  await page.waitForFunction(() => document.querySelector('select').disabled)
  await page.evaluate(() => window.showSession('third'))
  await page.getByText('会话 third', { exact: true }).waitFor()
  releaseSave({ settings: fixture('过期保存 second') })
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 20)))
  assert.equal(await page.getByText('过期保存 second', { exact: true }).count(), 0)
  assert.deepEqual(await page.evaluate(() => window.invalidations), [])
  assert.equal(await page.getByRole('combobox', { name: '文风', exact: true }).inputValue(), 'plain')
})

test('真实原预设全部 72 选项、13 组和 2 变量可访问，窄屏无横向溢出，原文只读', {
  skip: !process.env.TAVERN_BROWSER_TESTS || !process.env.TAVERN_AUTHOR_PRESET_FILE, timeout: 30000
}, async t => {
  const text = await readFile(process.env.TAVERN_AUTHOR_PRESET_FILE, 'utf8'), preset = inspectPreset(text, 'presets/梦鲸思客V4-0915.json')
  const snapshot = { presetName: preset.title, digest: 'real-source', compatibilityPreset: preset, compatibilityPresetDocument: JSON.parse(text),
    front: { entries: preset.entries.filter(entry => entry.enabled && entry.injectable && !entry.marker).map(entry => ({ ...entry, id: entry.entryKey })) },
    middle: { entries: [] }, back: { entries: [] }, regexScripts: preset.regexScripts }
  const settings = conversationPresetSettings(snapshot, 'dream-sike-dsh')
  const page = await mount(t, () => ({ settings }))
  await page.getByRole('tab').first().waitFor()
  const seen = new Set(), variables = new Set(), groups = new Set()
  for (const tab of await page.getByRole('tab').all()) {
    await tab.click()
    for (const group of await page.locator('[data-source-group]').all()) {
      const id = await group.getAttribute('data-source-group'); groups.add(id)
      for (const option of await group.locator('[data-source-option]').all()) seen.add(id + ':' + await option.getAttribute('data-source-option'))
      for (const variable of await group.locator('[data-source-variable]').all()) variables.add(id + ':' + await variable.getAttribute('data-source-variable'))
    }
  }
  assert.equal(seen.size, 72); assert.equal(groups.size, 13); assert.equal(variables.size, 2)
  assert.equal(await page.locator('input[type="radio"]').count(), 0)
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  await page.getByRole('button', { name: '来源与原文', exact: true }).click()
  const drawer = page.getByRole('dialog')
  assert.equal(await drawer.evaluate(element => element.getBoundingClientRect().width <= window.innerWidth), true)
  assert.equal(await drawer.evaluate(element => { const r = element.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight }), true)
  const texts = await drawer.locator('textarea').evaluateAll(nodes => nodes.map(node => ({ value: node.value, readOnly: node.readOnly })))
  assert.ok(texts.length > 72)
  assert.ok(texts.every(value => value.readOnly))
  const authorTexts = new Set(JSON.parse(text).prompts.map(prompt => prompt.content || ''))
  assert.ok(texts.every(value => authorTexts.has(value.value)))
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--dsh-vv-height', '280px')
    document.documentElement.style.setProperty('--dsh-vv-top', '20px')
  })
  assert.equal(await drawer.evaluate(element => { const r = element.getBoundingClientRect(); return r.top >= 20 && r.bottom <= 300 }), true, '原文抽屉留在软键盘上方')
  assert.equal(await page.getByRole('button', { name: '关闭来源原文' }).evaluate(element => {
    const r = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
  }), true, '关闭按钮不被正文遮住')
  await page.keyboard.press('Escape')
  assert.equal(await drawer.count(), 0)
})

test('原酒馆模式与缺失 Agent profile 不误报 Agent 已启用', {
  skip: !process.env.TAVERN_BROWSER_TESTS, timeout: 30000
}, async t => {
  const settings = fixture(); settings.agentPreset.enabled = false
  const page = await mount(t, () => ({ settings }))
  await page.getByText('原酒馆模式', { exact: true }).waitFor()
  assert.equal(await page.getByText('Agent 模式', { exact: true }).count(), 0)
  assert.equal(await page.getByRole('tablist', { name: '预设配置分类', exact: true }).count(), 1)
  delete settings.agentPreset
  settings.presetName = '缺少 Agent profile 的原预设'
  await page.evaluate(() => window.showSession('missing-profile'))
  await page.getByRole('heading', { name: '缺少 Agent profile 的原预设', exact: true }).waitFor()
  await page.getByText('原酒馆模式', { exact: true }).waitFor()
  assert.equal(await page.getByText('Agent 模式', { exact: true }).count(), 0)
})
