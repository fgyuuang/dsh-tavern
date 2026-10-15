import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { browserReactScript } from './fixtures/browser-react.mjs'

for (const standalone of [false, true]) test('composer selects author and reply mode without losing author options, handles errors and narrow viewports; standalone=' + standalone, {
  skip: !process.env.TAVERN_BROWSER_TESTS, timeout: 30000
}, async t => {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ channel: 'msedge' })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const calls = [], errors = []
  let reply = 'agent', preset = 'dream-sike-dsh', source = 'author.json', fail = false, running = false
  page.on('pageerror', e => errors.push(e.message))
  await page.exposeFunction('fixtureRpc', async (method, args) => {
    calls.push({ method, args })
    if (method === 'listPlayPresets') return { currentPlayPresetId: preset, presets: [
      { id: 'tavern', name: 'DSH 原版' }, { id: 'dream-sike-dsh', name: '梦境思客DSH' }, { id: 'hushen-dsh', name: '狐神抚DSH' }] }
    if (method === 'listPresets') return { presets: [
      { path: 'author.json', title: '作者原预设', valid: true, recognized: true }, { path: 'other.json', title: '其他预设', valid: true, recognized: true }] }
    if (method === 'getSession') return { view: { mode: 'story', playPresetId: preset, generationMode: reply, runtimePreset: { id: source, name: '作者原预设' } } }
    if (method === 'getGenerationMode') return { generationMode: reply, busy: running }
    if (fail) throw Error('模拟保存失败')
    if (method === 'setGenerationMode') reply = args.generationMode
    else if (method === 'applyPlayPreset') preset = args.presetId
    else if (method === 'applyConversationPreset') source = args.path
    else throw Error('unexpected RPC '+method)
    return { generationMode: reply }
  })
  await page.setContent('<div style="position:fixed;bottom:20px;left:12px" id="root"></div>')
  await page.addStyleTag({ content: await readFile(new URL('../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8') })
  await page.addScriptTag({ content: await browserReactScript() + `
    const React=modules.react,ReactDom=modules['react-dom'],rpc=window.fixtureRpc;
    const useTavernSessionMode=()=> 'story';
    const useLiveTavernView=()=>({view:{playPresetId:'dream-sike-dsh',generationMode:'agent'}});
    const isPlayMode=mode=>mode==='story',isWritingAgentPresetId=id=>['dream-sike-dsh','hushen-dsh'].includes(id);
    const liveTavernView={invalidate(){}},tavernCoordination={invalidate(){}},notifyTavernDataChanged=()=>{};
    const tavernErrorHub={report:(source,error)=>{throw error}};
    const agentWorkbenchFeature={open:async(ctx,sessionId,panelId)=>{window.opened={sessionId,panelId}}};
    const openTavernSidebarTab=async()=>{};
    const root=modules['react-dom/client'].createRoot(document.getElementById('root'));
    ${standalone ? `
      window.__ModuleLoader__={load:module=>window.plugin=module.factory(id=>modules[id])};
      ${await readFile(new URL('../plugins/dsh-tavern-writing-presets/client.js', import.meta.url), 'utf8')}
      const ctx={sessions:{subagentAddress:()=>null},effect:register=>register(),
        slots:{inject:(_name,register)=>register(),register:(_descriptor,component)=>{window.Menu=component;return()=>{}}},
        tavernUi:{writingPresets:{version:1,openSettings:async sessionId=>{window.opened={sessionId,panelId:'tavern/author-settings'}}},
          callHost:(_name,input)=>window.fixtureRpc(input.method,input.args),assetUrl:()=> 'data:text/css,',watchTurnState:()=>()=>{}}};
      window.plugin.apply(ctx);
      window.renderSession=id=>root.render(React.createElement(window.Menu,{sessionId:id}));
    ` : `
      ${await readFile(new URL('../tavern-plugin/src/client/features/composer-preset.js', import.meta.url), 'utf8')}
      window.renderSession=id=>root.render(React.createElement(TavernComposerPreset,{sessionId:id,ctx:{sessions:{subagentAddress:()=>null}}}));
    `}
    window.renderSession('game-one');
  ` })
  const trigger = page.getByRole('button', { name: '选择预设与回复方式', exact: true })
  const menu = page.getByRole('dialog', { name: '本局预设与回复方式', exact: true })
  await trigger.click()
  const mode = page.getByRole('switch', { name: '酒馆直接回复模式', exact: true })
  await page.waitForFunction(() => document.querySelector('[aria-label="酒馆直接回复模式"]')?.disabled === false)
  await mode.click()
  await page.waitForFunction(() => document.querySelector('[aria-label="酒馆直接回复模式"]')?.checked && !document.querySelector('[aria-label="酒馆直接回复模式"]')?.disabled)
  assert.equal(await page.getByLabel('输入区酒馆预设').inputValue(), 'author.json')
  await page.getByRole('button', { name: '配置作者选项', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.opened), { sessionId: 'game-one', panelId: 'tavern/author-settings' })
  await trigger.click()
  await page.getByLabel('输入区 Agent 预设').selectOption('hushen-dsh')
  await page.waitForFunction(() => document.querySelector('[aria-label="输入区 Agent 预设"]')?.value==='hushen-dsh'&&!document.querySelector('[aria-label="输入区 Agent 预设"]')?.disabled)
  await page.getByLabel('输入区酒馆预设').selectOption('other.json')
  await page.waitForFunction(() => document.querySelector('[aria-label="输入区酒馆预设"]')?.value==='other.json'&&!document.querySelector('[aria-label="输入区酒馆预设"]')?.disabled)
  fail = true
  await mode.click()
  await page.getByRole('alert').filter({ hasText: '模拟保存失败' }).waitFor()
  assert.equal(await mode.isChecked(), true)
  fail = false
  await mode.click()
  await page.waitForFunction(() => !document.querySelector('[aria-label="酒馆直接回复模式"]')?.checked&&!document.querySelector('[aria-label="酒馆直接回复模式"]')?.disabled)
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 })
    const rect = await menu.boundingBox()
    assert.ok(rect && rect.x>=0 && rect.y>=0 && rect.x+rect.width<=width+1 && rect.y+rect.height<=844)
  }
  await mkdir('output/playwright/composer-preset', { recursive: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'output/playwright/composer-preset/menu-390' + (standalone ? '-plugin' : '') + '.png' })
  await page.keyboard.press('Escape')
  assert.equal(await menu.count(), 0)
  assert.equal(await trigger.evaluate(el=>el===document.activeElement), true)
  running = true
  await trigger.click()
  await page.getByRole('status').filter({ hasText: '当前回合仍在处理' }).waitFor()
  assert.equal(await mode.isDisabled(), true)
  await page.evaluate(() => window.renderSession('game-two'))
  await menu.waitFor({ state: 'detached' })
  assert.deepEqual(errors, [])
  assert.equal(calls.filter(call=>call.method==='setDefaultPlayPreset').length, 0)
  assert.equal(calls.filter(call=>call.method==='getConversationReasoningConfig').length, 0)
})
