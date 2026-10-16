import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { browserReactScript } from './fixtures/browser-react.mjs'

test('Agent tool-only prose streams inside the chat and yields to exactly one final body', {
  skip: !process.env.TAVERN_BROWSER_TESTS, timeout: 30000
}, async t => {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch(process.platform === 'win32' ? { channel: 'msedge' } : {})
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 390, height: 760 } })
  page.setDefaultTimeout(8000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const preview = await readFile(new URL('../tavern-plugin/src/client/modules/dream-sike-preview.js', import.meta.url), 'utf8')
  const renderer = await readFile(new URL('../tavern-plugin/src/client/features/assistant-renderer.js', import.meta.url), 'utf8')
  const start = renderer.indexOf('function TavernWritingTurnPreview(')
  const end = renderer.indexOf('function TavernForkAssistantAction(', start)
  assert.ok(start > 0 && end > start)
  await page.setContent('<main id="chat" data-chat-flow></main><div id="composer-dock"></div>')
  await page.addScriptTag({ content: await browserReactScript() + `
    const React=modules.react;
    const listeners=new Set(), chatListeners=new Set();
    let currentData={blocks:[]};
    const assistant={subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener)},getSnapshot:()=>currentData};
    function step(number){return {step:number,start:{seq:number},data:{source:()=>assistant}}}
    let turn={turn:8,status:'open',start:{seq:8},steps:[step(1)]};
    let snapshot={timeline:{turnOrder:[8],turns:new Map([[8,turn]])}};
    window.savedDraft=null;window.rpcCalls=[];
    const rpcWithTimeout=async(method,args,id)=>{window.rpcCalls.push({method,args,id});return {draft:window.savedDraft}};
    const useLiveTavernView=()=>({view:{playPresetId:'dream-sike-dsh',generationMode:'agent'}});
    const isWritingAgentView=view=>view.generationMode==='agent';
    function useChat(selector){return React.useSyncExternalStore(listener=>{chatListeners.add(listener);return()=>chatListeners.delete(listener)},()=>selector(snapshot))}
    ${preview}
    ${renderer.slice(start,end)}
    const root=modules['react-dom/client'].createRoot(document.getElementById('chat'));
    function render(){root.render(turn.status==='open'?React.createElement('div',{'data-chat-flow-kind':'turn-tail'},React.createElement(TavernWritingTurnPreview,{sessionId:'game',turn,useChat})):React.createElement('article',{'data-final-body':true},'最终正文'))}
    window.updateBlocks=blocks=>{currentData={blocks};listeners.forEach(listener=>listener())};
    window.advance=()=>{turn={...turn,steps:[...turn.steps,step(turn.steps.length+1)]};snapshot={timeline:{turnOrder:[8],turns:new Map([[8,turn]])}};chatListeners.forEach(listener=>listener());render()};
    window.finish=()=>{turn={...turn,status:'closed'};snapshot={timeline:{turnOrder:[8],turns:new Map([[8,turn]])}};chatListeners.forEach(listener=>listener());render()};
    render();
  ` })
  await page.waitForFunction(() => window.rpcCalls.length === 1)
  const body = page.locator('[data-chat-flow] [data-dsh-draft-preview] pre')
  await page.evaluate(() => window.updateBlocks([{kind:'reasoning',text:'私有推理不能显示'},{kind:'text',text:'<think>私有规划</think>先到达窗边。'}]))
  await body.waitFor()
  assert.equal(await body.textContent(), '先到达窗边。')
  await page.evaluate(() => window.updateBlocks([
    {kind:'reasoning',text:'私有推理不能显示'},
    {kind:'tool-call',name:'other_tool',callId:'other',argsRaw:'{"text":"别的工具文本"}'},
    {kind:'tool-call',name:'sike_put_draft',callId:'draft',argsRaw:'{"review":{"text":"审稿不得显示"},"text":"<dream_body>月光'}
  ]))
  await page.waitForFunction(() => document.querySelector('[data-dsh-draft-preview] pre')?.textContent === '月光')
  await page.evaluate(() => window.updateBlocks([{kind:'tool-call',name:'sike_put_draft',callId:'draft',argsRaw:JSON.stringify({text:'<think>私有内容</think><dream_body>月光落在窗边。</dream_body><script>window.unsafe=true</script>',review:{text:'审稿不得显示'}})}]))
  await page.waitForFunction(() => document.querySelector('[data-dsh-draft-preview] pre')?.textContent === '月光落在窗边。')
  assert.equal(await page.locator('#composer-dock').textContent(), '')
  assert.equal(await page.locator('iframe').count(), 0)
  assert.equal(await page.evaluate(() => window.unsafe), undefined)
  assert.doesNotMatch(await page.locator('#chat').textContent(), /私有|审稿|别的工具/)
  assert.match(await page.locator('#chat').textContent(), /正文预览 · 未提交/)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  await page.evaluate(() => {window.savedDraft={turn:8,status:'draft',version:2,text:'已保存的修订正文'};window.updateBlocks([]);window.advance()})
  await page.waitForFunction(() => document.querySelector('[data-dsh-draft-preview] pre')?.textContent === '已保存的修订正文')
  assert.equal(await page.evaluate(() => window.rpcCalls.length), 2)
  await page.evaluate(() => window.finish())
  await page.locator('[data-final-body]').waitFor()
  assert.equal(await page.locator('[data-dsh-draft-preview]').count(), 0)
  assert.equal(await page.locator('[data-final-body]').count(), 1)
  assert.deepEqual(errors, [])
})
