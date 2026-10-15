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
  const start = source.indexOf('function TavernPausedReplyFrame(')
  const end = source.indexOf('\n\t\t\t// While a picture is being made', start)
  assert.ok(start >= 0 && end > start, 'transcript recovery must remain alongside the native user row renderer')
  const component = source.slice(start, end)
  await page.addScriptTag({ content: await browserReactScript() + `
    const React=modules.react; window.rpcCalls=[];window.replayError=${JSON.stringify(options.replayError || '')};window.reply=${JSON.stringify(options.reply === undefined ? {turn:8,digest:'resume-digest',preview:'<script>window.unsafe=true</script>保留正文',characters:7} : options.reply)};
    window.view={generationMode:'sillytavern-once',canReplayFailedTurn:true,replayFailedTurn:8,timeline:{branchId:'branch'},interruptedReplyArchive:[
      {branchId:'branch',turn:8,seq:2,preview:'上一版中断正文',characters:6,status:'interrupted'},
      {branchId:'branch',turn:8,seq:3,preview:'<script>window.unsafe=true</script>保留正文',characters:7,status:'interrupted'}
    ]};
    const rpc=async(method,args,id)=>{window.rpcCalls.push({method,args,id});if(method==='getInterruptedReply')return {draft:window.reply};if(method==='getInterruptedReplyDisplay')return {projection:{parts:[{kind:'markdown',text:'保留正文'},{kind:'html',content:'<style>.panel{color:rgb(20, 90, 110)}</style><div class="panel">状态前端</div><button>修改变量</button><script>window.unsafe=true;parent.unsafe=true</script>'}]}};if(method==='replayTurn'){if(window.replayError)throw Error(window.replayError);return {view:window.view}}return {}};
    const liveTavernView={invalidate:id=>window.invalidated=(window.invalidated||[]).concat(id),setView:(id,value)=>window.updatedView=value};
    const notifyTavernDataChanged=()=>{};const tavernCoordination={invalidate:()=>{}};
    const useScopedLiveTavernView=()=>({view:window.view});
    const userContentParts=()=>({images:[],rest:[]});const tavernUserTextForTurn=()=> '玩家原始输入';
    const isWritingAgentView=view=>['dream-sike-dsh','hushen-dsh'].includes(view.playPresetId)&&view.generationMode!=='sillytavern-once';
    const TavernColoredMarkdown=props=>React.createElement('p',null,props.text);
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
  await page.getByRole('button', { name: '接着补完保留正文' }).click()
  const error = page.locator('[data-chat-flow-kind="user"] [role="alert"]')
  await error.waitFor()
  assert.equal(await error.textContent(), '续写失败演示')
  assert.equal(await page.locator('#composer-dock [role="alert"]').count(), 0)
  assert.deepEqual(await page.evaluate(() => window.rpcCalls.filter(row=>row.method!=='getInterruptedReplyDisplay').map(row => row.method)), ['getInterruptedReply','getInterruptedReply','replayTurn'])
  assert.deepEqual(await page.evaluate(() => window.rpcCalls.at(-1)), { method:'replayTurn', args:{continueReply:{turn:8,digest:'resume-digest'}}, id:'session' })
  assert.equal(await page.locator('#player-input').inputValue(), '尚未发送的新行动')
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
})

test('正文虽已留在聊天里但没有可验证续写点时，不会静默丢正文重放', config, async t => {
  const page = await fixture(t, { reply: null })
  await page.getByText('正文已保存在对话中，但当前会话没有可校验的续写点。').waitFor()
  assert.match(await page.locator('[data-chat-flow-kind="user"]').textContent(), /保留正文/)
  assert.equal(await page.locator('#composer-dock').textContent(), '')
  await page.getByRole('button', { name: '从头重新生成本轮' }).click()
  assert.deepEqual(await page.evaluate(() => window.rpcCalls.at(-1)), { method:'replayTurn', args:{}, id:'session' })
  assert.equal(await page.locator('#player-input').inputValue(), '尚未发送的新行动')
})

test('暂停正文恢复状态前端外观，隔离脚本与变量写入，折叠版本不重复读取', config, async t => {
  const page = await fixture(t)
  const frame = page.frameLocator('iframe[title="暂停正文前端预览"]')
  await frame.getByText('状态前端').waitFor()
  assert.equal(await frame.locator('.panel').evaluate(node => getComputedStyle(node).color), 'rgb(20, 90, 110)')
  assert.equal(await frame.getByRole('button').isDisabled(), true)
  assert.equal(await frame.locator('body').evaluate(() => window.unsafe), undefined)
  assert.equal(await page.evaluate(() => window.unsafe), undefined)
  assert.equal(await page.locator('iframe').getAttribute('sandbox'), 'allow-same-origin')
  assert.equal(await page.evaluate(() => window.rpcCalls.filter(row=>row.method==='getInterruptedReplyDisplay'&&row.args.seq===2).length), 0)
})
