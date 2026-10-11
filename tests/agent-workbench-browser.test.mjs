import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { browserReactScript } from './fixtures/browser-react.mjs'

async function fixture(t) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch(process.platform === 'win32' ? { channel: 'msedge' } : {})
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } })
  await page.route('http://workbench.test/**', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
  await page.goto('http://workbench.test/')
  await page.addStyleTag({ content: await readFile(new URL('../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8') + '\nbody{margin:0;background:#e4eae4;font-family:"Segoe UI",sans-serif}#root{margin:32px auto;width:1120px;height:850px;border:1px solid #d7e0d8;border-radius:16px;overflow:hidden}@media(max-width:600px){#root{width:100%;height:100dvh;margin:0;border:0;border-radius:0}}.test-module{padding:22px}.test-module h3{margin:0 0 8px;font-size:18px}.test-module p{color:#68716c;line-height:1.7}.test-module input{width:100%;max-width:450px;padding:10px;border:1px solid #d7e0d8;border-radius:7px;font:inherit}.test-module .test-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px}.test-module article{padding:18px;border:1px solid #d7e0d8;border-radius:10px;background:#fff}.test-module article h4{margin:0 0 7px}.test-module article p{margin:0;font-size:12px}' })
  const extensionSource = (await readFile(new URL('../tavern-plugin/src/client/features/plugin-extensions.js', import.meta.url), 'utf8')).split('// Per-session index of turns')[0]
  await page.addScriptTag({ content: await browserReactScript() + `
    const React=modules.react;
    const tavernErrorHub={report(...args){window.errors.push(String(args[0]))}};
    window.errors=[];window.mounts=[];window.cleanups=[];window.visibility=[];window.openCalls=[];
    let currentMode='dream-sike-dsh';
    const useTavernSessionMode=()=> 'play',isPlayMode=mode=>mode==='play';
    const useLiveTavernView=()=>({view:{playPresetId:currentMode}});
    const useTavernCoordination=()=>({view:{activity:{busy:false}}}),describeTavernActivity=activity=>activity;
    const DreamSikeMainTurnStatus=()=>React.createElement('span',null,'正在撰写正文');
    const listListeners=new Set(),sessionListeners=new Set();let running=false,bindingAvailable=false;
    const binding={session:{subscribe:fn=>{sessionListeners.add(fn);return()=>sessionListeners.delete(fn)},getSnapshot:()=>({running})}};
    const ctx={sessions:{subagentAddress:id=>id==='child'?{parentSessionId:'first'}:null,list:{subscribe:fn=>{listListeners.add(fn);return()=>listListeners.delete(fn)}},binding:()=>bindingAvailable?binding:null}};
    window.setRunning=value=>{running=value;bindingAvailable=true;listListeners.forEach(fn=>fn());sessionListeners.forEach(fn=>fn())};
    const openTavernSidebarTab=(ctx,seed,scope)=>{window.openCalls.push({seed,scope});return Promise.resolve()};
    ${extensionSource}
    ${await readFile(new URL('../tavern-plugin/src/client/features/agent-workbench.js', import.meta.url), 'utf8')}
    function panel(id){return function(props){
      const [text,setText]=React.useState('');
      React.useEffect(()=>{window.mounts.push(id+':'+props.sessionId);return()=>window.cleanups.push(id+':'+props.sessionId)},[]);
      React.useEffect(()=>{window.visibility.push({id,visible:props.visible})},[props.visible]);
      if(id==='broken'&&window.breakModule)throw Error('plugin fault');
      return React.createElement('section',{className:'test-module','data-module':id},
       React.createElement('h3',null,props.sessionId+' · '+({settings:'创作设置',draft:'正文草稿',memory:'本局记忆',state:'人物状态',runtime:'扩展运行'}[id]||id)),
       React.createElement('p',null,'按照本局的角色、文风和剧情分支安排创作。工具运行记录保留在对应模块。'),
       id==='settings'?React.createElement('div',{className:'test-cards'},...['角色与场景','叙事与文风','写前决策','审稿与结算'].map(label=>React.createElement('article',{key:label},React.createElement('h4',null,label),React.createElement('p',null,'沿用作者规则 · 当前游戏')))):null,
       React.createElement('p',null,React.createElement('input',{'aria-label':id+'输入',value:text,onChange:e=>setText(e.target.value)})));
    }}
    const disposers={};
    window.addPanel=(id,label,keepAlive=false)=>{disposers[id]=tavernUiExtensions.service.registerWorkbenchPanel({id:'tavern/'+id,label,description:({settings:'角色与文风',draft:'草稿与修订',memory:'人物与线索',state:'变量与状态',runtime:'正则与脚本'}[id]||'自定义插件'),keepAlive,component:panel(id),order:Object.keys(disposers).length})};
    window.removePanel=id=>disposers[id]();
    window.addPanel('settings','创作设置',true);window.addPanel('draft','正文工作窗');window.addPanel('memory','本局记忆',true);window.addPanel('state','人物状态');window.addPanel('runtime','扩展运行',true);
    const root=modules['react-dom/client'].createRoot(document.getElementById('root'));
    let currentSession='first',visible=true;
    window.showSession=(sessionId=currentSession,show=visible,mode=currentMode)=>{currentSession=sessionId;visible=show;currentMode=mode;root.render(React.createElement(agentWorkbenchFeature.View,{ctx,sessionId,visible,tabId:'host-tab'}))};
    window.openPanel=(sessionId,panelId)=>agentWorkbenchFeature.open(ctx,sessionId,panelId);
    window.showSession();
  ` })
  await page.getByRole('tab', { name: '创作设置', exact: false }).waitFor()
  return page
}

const config = { skip: !process.env.TAVERN_BROWSER_TESTS, timeout: 30000 }

test('Agent 工作台按插件组合、动态卸载与错误隔离，保留访问过的编辑状态', config, async t => {
  const page = await fixture(t)
  await page.getByLabel('settings输入').fill('未保存的作者规则')
  await page.getByRole('tab', { name: '正文工作窗', exact: false }).click()
  assert.equal(await page.getByLabel('settings输入').isVisible(), false)
  await page.getByRole('tab', { name: '创作设置', exact: false }).click()
  assert.equal(await page.getByLabel('settings输入').inputValue(), '未保存的作者规则')
  assert.deepEqual(await page.evaluate(() => window.cleanups), ['draft:first'])
  await page.evaluate(() => window.addPanel('extra', '自定义面板'))
  await page.getByRole('tab', { name: '自定义面板', exact: false }).click()
  await page.getByLabel('extra输入').waitFor()
  await page.evaluate(() => window.removePanel('extra'))
  assert.equal(await page.getByRole('tab', { name: '自定义面板', exact: false }).count(), 0)
  await page.getByRole('tab', { name: '创作设置', exact: false }).waitFor()
  assert.equal(await page.getByRole('tab', { name: '创作设置', exact: false }).getAttribute('aria-selected'), 'true')
  await page.evaluate(() => { window.breakModule = true; window.addPanel('broken', '失效插件') })
  await page.getByRole('tab', { name: '失效插件', exact: false }).click()
  await page.getByRole('alert').filter({ hasText: '失效插件暂时无法显示' }).waitFor()
  await page.evaluate(() => { window.breakModule = false })
  await page.getByRole('button', { name: '重新打开模块' }).click()
  await page.getByLabel('broken输入').waitFor()
  await page.getByRole('tab', { name: '本局记忆', exact: false }).click()
  await page.getByLabel('memory输入').waitFor()
  assert.equal(await page.evaluate(() => window.errors.length), 1)
  await page.evaluate(() => window.showSession('first', true, 'tavern'))
  await page.getByText('在本局设置选择梦境思客DSH', { exact: false }).waitFor()
  assert.equal(await page.getByRole('tab').count(), 0)
  assert.equal(await page.getByLabel('settings输入').count(), 0)
})

test('工作台布局偏好按游戏保存，隐藏只影响显示，打开指定插件与子会话正确定位', config, async t => {
  const page = await fixture(t)
  await page.evaluate(() => window.setRunning(true))
  await page.getByText('正在撰写正文', { exact: true }).waitFor()
  await page.evaluate(() => window.setRunning(false))
  await page.getByText('等待你的行动', { exact: true }).waitFor()
  await page.getByRole('tab', { name: '本局记忆', exact: false }).click()
  await page.getByRole('button', { name: '管理模块' }).click()
  await page.getByRole('checkbox', { name: '人物状态', exact: false }).uncheck()
  assert.equal(await page.getByRole('tab', { name: '人物状态', exact: false }).count(), 0)
  await page.evaluate(() => window.showSession('second'))
  await page.getByRole('tab', { name: '人物状态', exact: false }).waitFor()
  assert.equal(await page.getByRole('tab', { name: '创作设置', exact: false }).getAttribute('aria-selected'), 'true')
  await page.evaluate(() => window.showSession('first'))
  assert.equal(await page.getByRole('tab', { name: '人物状态', exact: false }).count(), 0)
  assert.equal(await page.getByRole('tab', { name: '本局记忆', exact: false }).getAttribute('aria-selected'), 'true')
  await page.evaluate(() => window.openPanel('child', 'tavern/state'))
  await page.getByRole('tab', { name: '人物状态', exact: false }).waitFor()
  assert.equal(await page.getByRole('tab', { name: '人物状态', exact: false }).getAttribute('aria-selected'), 'true')
  assert.deepEqual(await page.evaluate(() => window.openCalls.at(-1)), { seed: { type: 'dsh-tavern:agent-workbench' }, scope: { sessionId: 'first' } })
  await page.evaluate(() => window.showSession('first', false))
  assert.equal(await page.getByLabel('state输入').count(), 0)
  assert.equal(await page.evaluate(() => window.visibility.filter(item => item.id === 'memory').at(-1).visible), false)
  await page.evaluate(() => window.showSession('first', true))
  await page.getByLabel('state输入').waitFor()
})

test('工作台键盘导航、模块恢复和宽窄屏无横向溢出', config, async t => {
  const page = await fixture(t)
  const first = page.getByRole('tab', { name: '创作设置', exact: false })
  await first.focus(); await page.keyboard.press('ArrowRight')
  assert.equal(await page.getByRole('tab', { name: '正文工作窗', exact: false }).getAttribute('aria-selected'), 'true')
  await page.keyboard.press('End')
  assert.equal(await page.getByRole('tab', { name: '扩展运行', exact: false }).getAttribute('aria-selected'), 'true')
  await page.keyboard.press('Home')
  assert.equal(await first.getAttribute('aria-selected'), 'true')
  await page.getByRole('button', { name: '管理模块' }).click()
  await page.getByRole('checkbox', { name: '创作设置', exact: false }).uncheck()
  for (const label of ['正文工作窗', '本局记忆', '人物状态', '扩展运行']) await page.getByRole('checkbox', { name: label, exact: false }).uncheck()
  await page.getByText('模块已收起。打开“管理模块”可恢复显示。', { exact: true }).waitFor()
  await page.getByRole('button', { name: '显示全部' }).click()
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('button', { name: '管理模块' }).evaluate(element => element === document.activeElement), true)
  assert.equal(await page.getByRole('tab').count(), 5)
  await first.click()
  if (process.env.TAVERN_WORKBENCH_SCREENSHOT_DIR) await mkdir(process.env.TAVERN_WORKBENCH_SCREENSHOT_DIR, { recursive: true })
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 950 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.equal(await page.locator('.dsh-agent-workbench').evaluate(element => element.scrollWidth <= element.clientWidth), true)
    if (process.env.TAVERN_WORKBENCH_SCREENSHOT_DIR) await page.screenshot({ path: process.env.TAVERN_WORKBENCH_SCREENSHOT_DIR + '/agent-workbench-' + width + '.png', fullPage: true })
  }
})
