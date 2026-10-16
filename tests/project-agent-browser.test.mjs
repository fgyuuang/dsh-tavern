import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { browserReactScript } from './fixtures/browser-react.mjs'
import { PROJECT_AGENT_MODES } from '../tavern-plugin/lib/domain/project-agent-workspace.js'

test('Agent workspace opens a native conversation and puts the four-mode selector beside its composer', { skip: !process.env.TAVERN_BROWSER_TESTS, timeout: 30000 }, async t => {
  const { chromium } = await import('playwright'), browser = await chromium.launch(process.platform === 'win32' ? { channel: 'msedge' } : {})
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 390, height: 800 } })
  await page.setContent('<div id="agent-root"></div><div style="position:fixed;left:12px;right:12px;bottom:16px;display:flex;align-items:center;gap:8px;padding:10px;border:1px solid #8885;border-radius:16px;background:#8881"><div style="flex:1;min-height:42px;padding:12px;border:1px solid #8884;border-radius:10px">给 Agent 发送消息…</div><div id="root"></div><button type="button" style="min-height:32px">发送</button></div>')
  await page.addStyleTag({ content: await readFile(new URL('../plugins/dsh-tavern-project-agent/assets/workspace.css', import.meta.url), 'utf8') })
  await page.addScriptTag({ content: await browserReactScript() + `
    window.calls=[];let records=[];let nativeListeners=new Set();let view={byId:{'previous-story':{blank:false}},current:'previous-story'};
    window.__ModuleLoader__={load(descriptor){window.plugin=descriptor.factory(name=>modules[name])}};
    ${await readFile(new URL('../plugins/dsh-tavern-project-agent/client.js', import.meta.url), 'utf8')}
    const info={root:'D:/tavern/project',modes:${JSON.stringify(PROJECT_AGENT_MODES)}};
    const ctx={tavernUi:{callHost:async(name,{method,args})=>{window.calls.push({method,args});if(method==='info')return info;if(method==='list')return {sessions:records};if(method==='register'){records=[{sessionId:args.sessionId,nativePresetId:args.presetId,title:info.modes.find(row=>row.id===args.presetId).name,path:info.root}];return {session:records[0]}}},registerSidebarWorkspace:entry=>window.workspace=entry,assetUrl:()=> 'data:text/css,'},
      slots:{inject:(_name,register)=>register(),register:(_descriptor,component)=>{window.agentModeSlot=component;return()=>{}}},
      sessions:{list:{subscribe:listener=>{nativeListeners.add(listener);return()=>nativeListeners.delete(listener)},getSnapshot:()=>view},subagentAddress:()=>undefined,
        create:async()=>{window.calls.push({method:'native-create'});view={...view,current:'new-native',byId:{...view.byId,'new-native':{blank:true}}};nativeListeners.forEach(listener=>listener());return 'new-native'},
        refresh:async()=>{},open:async id=>{window.calls.push({method:'native-open',id});view={...view,current:id};nativeListeners.forEach(listener=>listener())}},
      workspaces:{create:async args=>{window.calls.push({method:'workspace-create',args});return {workspaceId:'w'}}},
      remote:{agentPresets:{select:async(id,preset)=>{window.calls.push({method:'native-preset',id,preset});return {ok:true}}}},effect:fn=>fn()};
    plugin.apply(ctx);
    window.root=modules['react-dom/client'].createRoot(document.getElementById('agent-root'));
    window.root.render(modules.react.createElement(workspace.component,{onSessionsChanged:()=>{},onOpen:()=>{}}));
    window.composerRoot=modules['react-dom/client'].createRoot(document.getElementById('root'));
    window.renderAgentComposer=()=>window.composerRoot.render(window.agentModeSlot({sessionId:'new-native'}));
    window.setAgentSessionBlank=blank=>{view={...view,byId:{...view.byId,'new-native':{blank}}};nativeListeners.forEach(listener=>listener())};
  ` })
  await page.waitForFunction(() => window.calls.some(row => row.method === 'native-open'))
  assert.equal(await page.getByRole('combobox', { name: '新对话的原生模式' }).count(), 0)
  assert.equal(await page.getByText('模式在聊天输入框旁选择；发送第一条消息后固定为本局模式。').count(), 1)
  const calls = await page.evaluate(() => window.calls.filter(row => ['native-create', 'native-preset', 'register', 'native-open'].includes(row.method)))
  assert.deepEqual(calls.map(row => row.method), ['native-create', 'native-preset', 'register', 'native-open'])
  assert.equal(calls[1].preset, 'standard')
  assert.equal(await page.evaluate(() => window.calls.some(row => /startChat|prompt|Default/.test(row.method))), false)
  await page.evaluate(() => window.renderAgentComposer())
  const selector = page.getByRole('combobox', { name: 'Agent 模式', exact: true })
  assert.equal(await selector.locator('option').count(), 4)
  await selector.selectOption('cordis')
  await page.waitForFunction(() => window.calls.some(row => row.method === 'native-preset' && row.preset === 'cordis'))
  await page.waitForFunction(() => window.calls.some(row => row.method === 'register' && row.args.presetId === 'cordis'))
  await mkdir('output/playwright/project-agent', { recursive: true })
  await page.screenshot({ path: 'output/playwright/project-agent/composer-mode-390.png' })
  await page.evaluate(() => window.setAgentSessionBlank(false))
  await page.getByLabel('Agent 模式已锁定').filter({ hasText: '创造模式' }).waitFor()
  assert.equal(await page.getByRole('combobox', { name: 'Agent 模式', exact: true }).count(), 0)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
})
