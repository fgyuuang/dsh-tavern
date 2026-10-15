import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { browserReactScript } from './fixtures/browser-react.mjs'

const config = { skip: !process.env.TAVERN_BROWSER_TESTS, timeout: 30000 }

async function fixture(t, options = {}) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch(process.platform === 'win32' ? { channel: 'msedge' } : {})
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 390, height: 700 } })
  page.setDefaultTimeout(8000)
  await page.setContent('<textarea id="player-input">尚未发送的新行动</textarea><div id="chat"></div><div id="composer-dock"></div>')
  await page.addStyleTag({ content: await readFile(new URL('../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8') })
  const source = await readFile(new URL('../tavern-plugin/src/client/features/assistant-renderer.js', import.meta.url), 'utf8')
  const start = source.indexOf('function TavernInterruptedReplyTranscript(')
  const end = source.indexOf('\n\t\t\t// While a picture is being made', start)
  assert.ok(start >= 0 && end > start, 'transcript recovery must remain alongside the native user row renderer')
  const component = source.slice(start, end)
  await page.addScriptTag({ content: await browserReactScript() + `
    const React=modules.react; window.rpcCalls=[];window.replayError=${JSON.stringify(options.replayError || '')};window.reply=${JSON.stringify(options.reply === undefined ? {turn:8,digest:'resume-digest',preview:'<script>window.unsafe=true</script>保留正文',characters:7} : options.reply)};
    window.view={generationMode:'sillytavern-once',canReplayFailedTurn:true,replayFailedTurn:8,timeline:{branchId:'branch'},interruptedReplyArchive:[
      {branchId:'branch',turn:8,seq:2,preview:'上一版中断正文',characters:6,status:'interrupted'},
      {branchId:'branch',turn:8,seq:3,preview:'<script>window.unsafe=true</script>保留正文',characters:7,status:'interrupted'}
    ]};
    const rpc=async(method,args,id)=>{window.rpcCalls.push({method,args,id});if(method==='getInterruptedReply')return {draft:window.reply};if(method==='replayTurn'){if(window.replayError)throw Error(window.replayError);return {view:window.view}}return {}};
    const liveTavernView={invalidate:id=>window.invalidated=(window.invalidated||[]).concat(id),setView:(id,value)=>window.updatedView=value};
    const notifyTavernDataChanged=()=>{};const tavernCoordination={invalidate:()=>{}};
    const useScopedLiveTavernView=()=>({view:window.view});
    const userContentParts=()=>({images:[],rest:[]});const tavernUserTextForTurn=()=> '玩家原始输入';
    const DshUi={writeClipboard:async()=>true,Tooltip:props=>props.children,JsonBlock:()=>null,IconCheckOutline16:()=>null,IconCopyOutline16:()=>null};
    ${component}
    const root=modules['react-dom/client'].createRoot(document.getElementById('chat'));
    window.renderUser=()=>root.render(React.createElement('div',{'data-chat-flow-kind':'user','data-chat-turn':8},React.createElement(TavernUserNodeView,{sessionId:'session',node:{data:{time:1,content:[{type:'text',text:'玩家原始输入'}]},location:{kind:'turn',turn:{turn:8}}},renderMessageImages:()=>null})));
    window.renderUser();
  ` })
  return page
}

test('恢复的正文和续写错误显示在对应聊天回合，续写保持摘要绑定并保留玩家输入', config, async t => {
  const page = await fixture(t, { replayError: '续写失败演示' })
  await page.locator('[data-chat-flow-kind="user"] .dsh-tavern-interrupted-transcript').waitFor()
  assert.match(await page.locator('[data-chat-flow-kind="user"]').textContent(), /保留正文/)
  assert.equal(await page.locator('#composer-dock').textContent(), '')
  assert.equal(await page.evaluate(() => window.unsafe), undefined)
  await page.getByRole('button', { name: '接着补完' }).click()
  const error = page.locator('[data-chat-flow-kind="user"] [role="alert"]')
  await error.waitFor()
  assert.equal(await error.textContent(), '续写失败演示')
  assert.equal(await page.locator('#composer-dock [role="alert"]').count(), 0)
  assert.deepEqual(await page.evaluate(() => window.rpcCalls.map(row => row.method)), ['getInterruptedReply','getInterruptedReply','replayTurn'])
  assert.deepEqual(await page.evaluate(() => window.rpcCalls.at(-1)), { method:'replayTurn', args:{continueReply:{turn:8,digest:'resume-digest'}}, id:'session' })
  assert.equal(await page.locator('#player-input').inputValue(), '尚未发送的新行动')
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
})

test('正文虽已留在聊天里但没有可验证续写点时，不会静默丢正文重放', config, async t => {
  const page = await fixture(t, { reply: null })
  await page.getByText('这段正文已保存在对话中，但当前原生会话没有可验证的续写点。').waitFor()
  assert.match(await page.locator('[data-chat-flow-kind="user"]').textContent(), /上一版中断正文/)
  assert.equal(await page.locator('#composer-dock').textContent(), '')
  await page.getByRole('button', { name: '从头重新生成本轮' }).click()
  assert.deepEqual(await page.evaluate(() => window.rpcCalls.at(-1)), { method:'replayTurn', args:{}, id:'session' })
  assert.equal(await page.locator('#player-input').inputValue(), '尚未发送的新行动')
})
