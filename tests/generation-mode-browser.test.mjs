import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { browserReactScript } from './fixtures/browser-react.mjs'

test('the reply mode switch keeps the selected author preset and its settings visible', {
  skip: !process.env.TAVERN_BROWSER_TESTS, timeout: 30000
}, async t => {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch(process.platform === 'win32' ? { channel: 'msedge' } : {})
  t.after(() => browser.close())
  const page = await browser.newPage()
  const errors = [], writes = []
  page.on('pageerror', error => errors.push(error.message))
  let generationMode = 'agent'
  await page.exposeFunction('testRpc', async (method, args) => {
    if (method === 'listPresets') return { presets: [{ path: 'author.json', title: 'Original author', valid: true, recognized: true }] }
    if (method === 'getSession') return { view: { runtimePreset: { id: 'author.json', name: 'Original author' }, generationMode } }
    if (method === 'listPlayPresets') return { currentPlayPresetId: 'dream-sike-dsh', defaultPlayPresetId: 'tavern',
      presets: [{ id: 'tavern', name: 'DSH 原版' }, { id: 'dream-sike-dsh', name: '梦境思客DSH' }] }
    if (method === 'getGenerationMode') return { generationMode }
    if (method === 'setGenerationMode') {
      writes.push(args)
      generationMode = args.generationMode
      return { generationMode }
    }
    throw new Error('Unexpected RPC ' + method)
  })
  const source = await readFile(new URL('../tavern-plugin/src/client/features/play-controls.js', import.meta.url), 'utf8')
  const component = source.slice(source.indexOf('function TavernConversationPreset('), source.indexOf('function TavernLocalPlayerName('))
  await page.setContent('<div id="root"></div>')
  await page.addScriptTag({ content: await browserReactScript() + `
    const React=modules.react, rpc=window.testRpc;
    const liveTavernView={invalidate(){}},tavernCoordination={invalidate(){}};
    const notifyTavernDataChanged=()=>{},setCandidatePanel=()=>{},setCandidateGuidePanel=()=>{};
    const TavernPresetSettings=()=>React.createElement('p',{'data-author-settings':true},'Original author options');
    ${component}
    modules['react-dom/client'].createRoot(document.getElementById('root')).render(React.createElement(TavernConversationPreset,{sessionId:'game'}));
  ` })
  const choice = page.getByRole('combobox', { name: '本局回复方式', exact: true })
  await page.waitForFunction(() => document.querySelector('[aria-label="本局回复方式"]')?.disabled === false)
  await choice.selectOption('sillytavern-once')
  await page.getByRole('status').getByText('回复方式已切换，从下一回合生效').waitFor()
  assert.equal(await page.getByRole('combobox', { name: '本局 Agent 预设', exact: true }).inputValue(), 'dream-sike-dsh')
  assert.equal(await page.getByRole('combobox', { name: '本局写作规则来源', exact: true }).inputValue(), 'author.json')
  assert.equal(await page.locator('[data-author-settings]').textContent(), 'Original author options')
  await choice.selectOption('agent')
  await page.waitForFunction(() => document.querySelector('[aria-label="本局回复方式"]')?.value === 'agent' && document.querySelector('[aria-label="本局回复方式"]')?.disabled === false)
  assert.deepEqual(writes, [{ sessionId: 'game', generationMode: 'sillytavern-once' }, { sessionId: 'game', generationMode: 'agent' }])
  assert.deepEqual(errors, [])
})
