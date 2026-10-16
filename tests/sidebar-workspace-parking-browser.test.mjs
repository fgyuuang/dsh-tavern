import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { browserReactScript } from './fixtures/browser-react.mjs'

test('mode switches preserve the hidden opening parking node and keep the brand at the top', { skip: !process.env.TAVERN_BROWSER_TESTS, timeout: 40000 }, async t => {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch(process.platform === 'win32' ? { channel: 'msedge' } : {})
  t.after(() => browser.close())
  const bundle = (await readFile(process.env.DSH_CLIENT_SOURCE || new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')).replace('const tavernUiExtensions = createTavernUiExtensions();', 'const tavernUiExtensions = createTavernUiExtensions(); window.fixtureExtensions=tavernUiExtensions;')
  const css = await readFile(new URL('../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')
  const script = `${await browserReactScript()}
    modules['@deepseek-ai/dsh-client-ui-primitives']={MarkdownText:props=>modules.react.createElement('div',null,props.text)};
    window.__ModuleLoader__={load(d){window.client=d.factory(name=>modules[name]||{})}};
    ${bundle}
    const React=modules.react, root=modules['react-dom/client'].createRoot(document.querySelector('#app'));
    const state={current:'',byId:{}}; let Slot, MainSlot,activePanel=null;
    const sessions={list:{getSnapshot:()=>state,subscribe:()=>()=>{}},binding:()=>null,clear(){state.current=''},open(id){state.current=id;render()},refresh:async()=>{}};
    const workspaces={list:{getSnapshot:()=>({byId:{}})}};
    fixtureExtensions.service.registerSidebarWorkspace({id:'agent',label:'Agent',sessions:{getSnapshot:()=>[],subscribe:()=>()=>{}},component:()=>React.createElement('section',null,'项目对话')});
    client.createTavernShellFeatureModule().register({ctx:{effect:(fn,label)=>label==='dsh-tavern: shell marker'?()=>{}:fn(),get:()=>({}),sessions,workspaces,layout:{selectPanel(id){activePanel=id;render()},toggleSidebar(){}},betterSidebar:{}},slots:{inject:(_,fn)=>fn(),register:(o,c)=>{if(o.name==='sidebar.workspaces')Slot=c;if(o.name==='main')MainSlot=c;return()=>{}}}});
    function render(){root.render(React.createElement(React.Fragment,null,React.createElement('aside',null,React.createElement(Slot,{wide:true,useSessions:f=>f(state),useWorkspaces:f=>f({byId:{}})})),React.createElement('main',null,activePanel&&MainSlot?React.createElement(MainSlot):'主窗口')))}render();
  `
  const server = createServer(async (req, res) => {
    if (req.url === '/script.js') return res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(script)
    if (req.url.startsWith('/api/')) {
      const method = req.url.split('/').pop()
      const result = method === 'listSessions' ? { sessions: [] } : method === 'listCards' ? { cards: [] } : method === 'getUpdateStatus' ? { status: { phase: 'idle' } } : {}
      return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, ...result }))
    }
    res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' }).end(`<!doctype html><style>${css} body{margin:0}#app{display:flex;height:100vh}aside{width:280px;height:100%;flex:none}main{flex:1}</style><div id="app"></div><script src="/script.js"></script>`)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.locator('.dsh-opening-main-host').waitFor({ state: 'attached' })
  await page.evaluate(() => { window.initialOpening=document.querySelector('.dsh-opening-main-host');window.initialParking=window.initialOpening.parentElement })
  for (let i = 0; i < 4; i++) {
    await page.getByRole('button', { name: 'Agent', exact: true }).click()
    const geometry = await page.evaluate(() => ({ top: document.querySelector('.dsh-tavern-side-head').getBoundingClientRect().top, parked: window.initialOpening.parentElement===window.initialParking, sameParking: document.querySelector('.dsh-opening-parking')===window.initialParking, stray: !!document.querySelector('.dsh-tavern-sidebar .dsh-opening-main-host') }))
    assert.ok(geometry.top < 30, JSON.stringify(geometry))
    assert.equal(geometry.parked, true); assert.equal(geometry.sameParking, true); assert.equal(geometry.stray, false)
    await page.getByRole('button', { name: '卡片', exact: true }).click()
    await page.getByRole('button', { name: '关闭', exact: true }).last().click()
  }
  await mkdir('output/playwright/project-agent', { recursive: true })
  await page.getByRole('button', { name: 'Agent', exact: true }).click()
  await page.screenshot({ path: 'output/playwright/project-agent/sidebar-top-after-switches.png' })
})
