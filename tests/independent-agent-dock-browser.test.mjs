import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { browserReactScript } from './fixtures/browser-react.mjs'

test('independent Agent dock preserves original candidates and opens writing tools without losing regeneration', {
  skip: !process.env.TAVERN_BROWSER_TESTS, timeout: 30000,
}, async t => {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch(process.platform === 'win32' ? { channel: 'msedge' } : {})
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const source = await readFile(new URL('../tavern-plugin/src/client/features/play-controls.js', import.meta.url), 'utf8')
  const candidate = source.slice(source.indexOf('function CandidateAction('), source.indexOf('function TavernRollbackAction('))
  const dock = source.slice(source.indexOf('function DreamSikeInteractionDock('), source.indexOf('function observeTurnErrorProjection('))
  await page.setContent('<div id="root"></div>')
  await page.addStyleTag({ content: await readFile(new URL('../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8') })
  await page.addScriptTag({ content: await browserReactScript() + `
    const React=modules.react, h=React.createElement;
    window.calls=[]; window.mode='tavern'; window.running=false; window.failed=false;
    const isPlayMode=()=>true, useTavernSessionMode=()=> 'story', latestTavernAssistantMessageId=()=> 'reply';
    const useLiveTavernView=()=>({view:{playPresetId:window.mode, canRegenerate:true, canReplayFailedTurn:window.failed, latestAssistantTurn:1,releaseCapabilities:{sceneImages:true}}});
    const useCandidatePanel=()=>null, useRegenPanel=()=>null;
    const useTavernCoordination=()=>({view:{activity:{busy:false,role:'',phase:'idle'}}}), describeTavernActivity=x=>x;
    const liveTavernView={invalidate(){}},tavernCoordination={invalidate(){}};
    const setCandidatePanel=x=>window.calls.push(['candidates',x]),setCandidateGuidePanel=()=>{},setRegenPanel=x=>window.calls.push(['regeneration',x]);
    const submitCandidateTask=async()=>window.calls.push(['generate']),submitFailedTurnReplay=async()=>window.calls.push(['replay']);
    const tavernErrorHub={report(source,error){throw error}};
    function TavernMoreActions(){return h('button',null,'更多')}
    function TavernCompactionAction(){return h('button',null,'压缩')}
    function TavernStopBackgroundAction(){return h('button',null,'停止后台')}
    function TavernPluginComposerActions(){return h('button',null,'卡片工具')}
    function SceneImageAction(){return h('button',null,'生图')}
    function DreamSikeMainTurnStatus(){return h('span',{role:'status'},'检查正文')}
    ${candidate}
    ${dock}
    const root=modules['react-dom/client'].createRoot(document.getElementById('root'));
    window.render=()=>root.render(h(CandidateDockActions,{sessionId:'one',sessions:{subagentAddress:()=>null},
      useChat:fn=>fn({}),useSession:fn=>fn({running:window.running}),
      openAgentSettings:id=>window.calls.push(['settings',id]),openDraft:id=>window.calls.push(['draft',id])}));
    window.render();
  ` })
  await page.getByRole('button', { name: '生成候选项', exact: true }).waitFor()
  assert.equal(await page.getByLabel('梦境思客 Agent 工作台').count(), 0)
  assert.equal(await page.getByRole('button', { name: '卡片工具' }).count(), 1)
  await page.evaluate(() => { window.mode='dream-sike-dsh'; window.render() })
  await page.getByLabel('梦境思客 Agent 工作台').waitFor()
  assert.equal(await page.getByRole('button', { name: '生成候选项', exact: true }).isVisible(), false)
  assert.equal(await page.getByRole('button', { name: '重新生成正文' }).isVisible(), true)
  await page.getByRole('button', { name: '创作设置' }).click()
  await page.getByRole('button', { name: '正文工作窗', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.calls), [['settings', 'one'], ['draft', 'one']])
  if (process.env.TAVERN_AGENT_DOCK_SCREENSHOT) {
    await page.screenshot({ path: process.env.TAVERN_AGENT_DOCK_SCREENSHOT, fullPage: true })
  }
  await page.getByText('行动灵感', { exact: true }).click()
  await page.getByRole('button', { name: '生成候选项', exact: true }).click()
  assert.equal(await page.evaluate(() => window.calls.filter(x=>x[0]==='generate').length), 1)
  await page.getByRole('button', { name: '重新生成正文' }).click()
  assert.equal(await page.evaluate(() => window.calls.filter(x=>x[0]==='regeneration' && x[1]?.phase==='input').length), 1)
  await page.evaluate(() => { window.failed=true; window.render() })
  await page.getByRole('button', { name: '重新生成本轮' }).click()
  assert.equal(await page.evaluate(() => window.calls.filter(x=>x[0]==='replay').length), 1)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  await page.evaluate(() => { window.running=true; window.render() })
  await page.getByRole('status').filter({ hasText: '检查正文' }).waitFor()
  assert.equal(await page.getByRole('button', { name: '重新生成本轮' }).isDisabled(), true)
  await page.evaluate(() => { window.mode='tavern'; window.render() })
  await page.getByRole('button', { name: '生成候选项', exact: true }).waitFor()
  assert.equal(await page.getByLabel('梦境思客 Agent 工作台').count(), 0)
})

test('independent settings synchronize saved rules across pages and preserve unsaved edits', {
  skip: !process.env.TAVERN_BROWSER_TESTS, timeout: 30000,
}, async t => {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch(process.platform === 'win32' ? { channel: 'msedge' } : {})
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.setContent('<div id="root"></div>')
  await page.addScriptTag({ content: await browserReactScript() + `
    const React=modules.react,h=React.createElement;
    let settings={digest:'v1',presetName:'原文',entries:[{key:'style',name:'文风',enabled:true,content:'作者原文'}],regexScripts:[],helperScripts:[]};
    const rpc=async(method,args)=>{if(method==='updateConversationPresetSettings'){if(args.digest!==settings.digest) throw Error('版本已变化');settings={...settings,digest:settings.digest+'x',entries:settings.entries.map(entry=>({...entry,...args.changes.entries.find(change=>change.key===entry.key)}))};}return {settings:structuredClone(settings)}};
    const liveTavernView={invalidate(){}};
    const notifyTavernDataChanged=(kinds,source)=>window.dispatchEvent(new CustomEvent('dsh-tavern-data-changed',{detail:{kinds,source}}));
    ${await readFile(new URL('../tavern-plugin/src/client/features/preset-settings.js', import.meta.url), 'utf8')}
    modules['react-dom/client'].createRoot(document.getElementById('root')).render(h(React.Fragment,null,
      h('div',{id:'general'},h(TavernPresetSettings,{sessionId:'one'})),
      h('div',{id:'independent'},h(TavernPresetSettings,{sessionId:'one'}))));
  ` })
  const first = page.locator('#general'), second = page.locator('#independent')
  for (const root of [first, second]) {
    await root.getByText('文风与叙事（1/1）', { exact: true }).click()
    await root.getByText('文风 · 启用', { exact: true }).click()
  }
  await first.getByLabel('文风规则内容').fill('第一次修改')
  await first.getByRole('button', { name: '保存本局预设设置' }).click()
  await page.waitForFunction(() => document.querySelector('#independent textarea').value === '第一次修改')
  await second.getByLabel('文风规则内容').fill('尚未保存的本地编辑')
  await first.getByLabel('文风规则内容').fill('第二次修改')
  await first.getByRole('button', { name: '保存本局预设设置' }).click()
  await second.getByRole('button', { name: '重新载入（放弃未保存修改）' }).waitFor()
  assert.equal(await second.getByLabel('文风规则内容').inputValue(), '尚未保存的本地编辑')
  await second.getByRole('button', { name: '重新载入（放弃未保存修改）' }).click()
  await page.waitForFunction(() => document.querySelector('#independent textarea')?.value === '第二次修改')
  assert.equal(await second.getByLabel('文风规则内容').inputValue(), '第二次修改')
})
