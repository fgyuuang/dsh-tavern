import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { browserReactScript } from './fixtures/browser-react.mjs'

test('集中模型页真实 React 保存、同步原生选择器、失败保留原配置及窄屏布局', { skip: !process.env.TAVERN_BROWSER_TESTS, timeout: 30000 }, async t => {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch(process.platform === 'win32' ? { headless: true, channel: 'msedge' } : { headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } })
  const errors = [], calls = [], front = { provider: 'agnes', model: '2.5' }, other = { provider: 'saved', model: 'custom' }
  page.on('pageerror', error => errors.push(error.message))
  let fail = false
  let config = { foregroundModel: front, backgroundModel: other, effectiveBackgroundModel: other, busy: false,
    defaults: { defaultForegroundModel: null, defaultBackgroundModel: null, defaultWorkbenchModel: null },
    modelCatalog: [{ provider: 'agnes', providerName: 'Agnes', models: [{ id: '2.5' }] }, { provider: 'saved', models: [{ id: 'custom' }] }] }
  await page.exposeFunction('testRpc', async (method, args) => {
    calls.push({ method, args })
    if (method === 'getBackgroundModelReasoning') return { reasoning: { efforts: [{ id: 'low', name: 'Low' }] } }
    if (method === 'setConversationModelConfig') {
      if (fail) throw Error('保存失败测试')
      if (args.scope === 'new-games') config.defaults = { ...config.defaults, ...args.models }
      else config = { ...config, ...args.models, effectiveBackgroundModel: args.models.backgroundModel === null ? args.models.foregroundModel || config.foregroundModel : args.models.backgroundModel || config.backgroundModel }
    }
    return config
  })
  const settings = await readFile(new URL('../tavern-plugin/src/client/features/settings.js', import.meta.url), 'utf8')
  const picker = settings.slice(settings.indexOf('        function TavernDefaultModelSetting('), settings.indexOf('        // @include features/model-settings.js'))
  const label = settings.slice(settings.indexOf('\t\tfunction backgroundModelLabel('), settings.indexOf('\t\tfunction TavernBackgroundModelLabel('))
  await page.setContent('<div id="root"></div>')
  await page.addScriptTag({ content: await browserReactScript() + `
    const React=modules.react, rpc=window.testRpc, liveTavernView={invalidate(){}},EMPTY_PROJECTION_FACE={subscribe(){return()=>{}},getSnapshot(){return null}};
    ${label}${picker}${await readFile(new URL('../tavern-plugin/src/client/features/model-settings.js', import.meta.url), 'utf8')}
    let current={next:{provider:'agnes',model:'2.5'}},listener;const face={subscribe(fn){listener=fn;return()=>{}},getSnapshot(){return current}};
    window.nativeChange=()=>{current={next:{provider:'saved',model:'custom'}};listener()};
    modules['react-dom/client'].createRoot(document.getElementById('root')).render(React.createElement(TavernConversationModels,{sessionId:'native',sessions:{binding(){return {session:{projections:{faceOf(){return face}}}}}}}));
  ` })
  const background = page.getByLabel('本局后台模型', { exact: true })
  await background.waitFor()
  await page.getByRole('button', { name: '前后台统一使用当前前台模型', exact: true }).click()
  await page.getByText('已保存本局模型，下一次请求生效', { exact: true }).waitFor()
  assert.deepEqual(calls.filter(call => call.method === 'setConversationModelConfig').at(-1).args.models, { foregroundModel: front, backgroundModel: front })
  fail = true
  await background.selectOption(JSON.stringify(other))
  await page.getByRole('alert').filter({ hasText: '保存失败测试' }).waitFor()
  assert.equal(await background.inputValue(), JSON.stringify(front))
  fail = false; config.foregroundModel = other
  await page.evaluate(() => window.nativeChange())
  await page.waitForFunction(() => document.querySelector('[aria-label="本局前台模型"]').value.includes('custom'))
  await page.getByText('新游戏与卡片工作台默认模型', { exact: true }).click()
  await page.getByRole('button', { name: '新游戏与工作台统一使用当前前台模型', exact: true }).click()
  await page.getByText('已保存新游戏默认模型，已有游戏保持当前配置', { exact: true }).waitFor()
  assert.deepEqual(config.defaults.defaultWorkbenchModel, other)
  const css = await readFile(new URL('../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')
  await page.addStyleTag({ content: css })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  assert.deepEqual(errors, [])
})
