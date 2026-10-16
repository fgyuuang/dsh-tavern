import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { browserReactScript } from './fixtures/browser-react.mjs'
import { PROJECT_AGENT_MODES } from '../tavern-plugin/lib/domain/project-agent-workspace.js'

test('independent Agent panel selects native mode before registering, without sending a story or touching defaults', { skip: !process.env.TAVERN_BROWSER_TESTS, timeout: 30000 }, async t => {
  const { chromium } = await import('playwright'), browser = await chromium.launch(process.platform === 'win32' ? { channel: 'msedge' } : {})
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 390, height: 800 } })
  await page.setContent('<div id="root"></div>')
  await page.addStyleTag({ content: await readFile(new URL('../plugins/dsh-tavern-project-agent/assets/workspace.css', import.meta.url), 'utf8') })
  await page.addScriptTag({ content: await browserReactScript() + `
    window.calls=[];let records=[];let view={byId:{},current:''};
    window.__ModuleLoader__={load(descriptor){window.plugin=descriptor.factory(name=>modules[name])}};
    ${await readFile(new URL('../plugins/dsh-tavern-project-agent/client.js', import.meta.url), 'utf8')}
    const info={root:'D:/tavern/project',modes:${JSON.stringify(PROJECT_AGENT_MODES)}};
    const ctx={tavernUi:{callHost:async(name,{method,args})=>{window.calls.push({method,args});if(method==='info')return info;if(method==='list')return {sessions:records};if(method==='register'){records=[{sessionId:args.sessionId,nativePresetId:args.presetId,title:'创造模式',path:info.root}];return {session:records[0]}}},registerSidebarWorkspace:entry=>window.workspace=entry,assetUrl:()=> 'data:text/css,'},
      sessions:{list:{subscribe:()=>()=>{},getSnapshot:()=>view},create:async()=>{window.calls.push({method:'native-create'});return 'new-native'},refresh:async()=>{},open:async id=>{window.calls.push({method:'native-open',id})}},
      workspaces:{create:async args=>{window.calls.push({method:'workspace-create',args});return {workspaceId:'w'}}},
      remote:{agentPresets:{select:async(id,preset)=>{window.calls.push({method:'native-preset',id,preset});return {ok:true}}}},effect:fn=>fn()};
    plugin.apply(ctx);
    modules['react-dom/client'].createRoot(document.getElementById('root')).render(modules.react.createElement(workspace.component,{onSessionsChanged:()=>{},onOpen:()=>{}}));
  ` })
  await page.getByRole('combobox', { name: '新对话的原生模式' }).selectOption('cordis')
  await page.getByRole('button', { name: '新建 Agent 对话', exact: true }).click()
  await page.waitForFunction(() => window.calls.some(row => row.method === 'native-open'))
  const calls = await page.evaluate(() => window.calls.filter(row => ['native-create', 'native-preset', 'register', 'native-open'].includes(row.method)))
  assert.deepEqual(calls.map(row => row.method), ['native-create', 'native-preset', 'register', 'native-open'])
  assert.equal(calls[1].preset, 'cordis')
  assert.equal(await page.evaluate(() => window.calls.some(row => /startChat|prompt|Default/.test(row.method))), false)
  assert.equal(await page.getByRole('combobox', { name: '新对话的原生模式' }).locator('option').count(), 4)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
})
