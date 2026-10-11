import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { browserReactScript } from './fixtures/browser-react.mjs'

const config = { skip: !process.env.TAVERN_BROWSER_TESTS, timeout: 30000 }
async function fixture(t) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch(process.platform === 'win32' ? { channel: 'msedge' } : {})
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 700, height: 800 } })
  page.on('pageerror', error => console.error('worldbook fixture:', error.message))
  page.setDefaultTimeout(8000)
  await page.route('http://worldbook.test/**', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
  await page.goto('http://worldbook.test/')
  await page.addStyleTag({ content: await readFile(new URL('../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8') + '\nbody{margin:0;font-family:Arial,sans-serif}#root{height:100vh}' })
  await page.addScriptTag({ content: await browserReactScript() + `
    const React=modules.react;
    window.calls=[];window.openCalls=[];window.confirmCalls=[];window.invalidations=[];window.pending=[];
    window.failBook=false;window.delayBook=false;window.logRequested=false;
    const useTavernSessionMode=()=> 'play',isPlayMode=value=>value==='play';
    let running=false,busy=false;const listeners=new Set();
    const binding={session:{subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},getSnapshot:()=>({running})}};
    const ctx={sessions:{list:{subscribe:()=>()=>{}},binding:()=>binding}};
    const useTavernCoordination=()=>({view:{activity:{busy}}}),describeTavernActivity=value=>value;
    const useTavernConfirm=()=>async message=>{window.confirmCalls.push(message);return true};
    const liveTavernView={invalidate:id=>window.invalidations.push(id)};
    const tavernDataChangeAffects=()=>true,tavernSessionSignals={subscribe:()=>()=>{}};
    const openTavernSidebarTab=(ctx,seed,scope)=>{window.openCalls.push({seed,scope});return Promise.resolve()};
    function book(id){return {name:id+' 世界书',source:'primary',scope:'snapshot',counts:{total:3,enabled:2,constant:1,dynamic:0,mvuRules:1},library:{name:'库中世界书',source:'primary',counts:{total:3,enabled:2}},update:{digest:'verified-digest',worldbookChanged:true},entries:[{ref:'setting',title:'场景约束',content:'<img src=x onerror="window.untrusted=true">'+ '长文本'.repeat(30),enabled:true,constant:true,mvuRule:false},{ref:'disabled',title:'禁用事件',content:'禁用正文',enabled:false,constant:false,mvuRule:false},{ref:'mvu',title:'变量结算',content:'变量规则',enabled:true,constant:true,mvuRule:true}]}}
    function respond(method,args,id){if(method==='getGameWorldBook'){if(window.failBook)throw Error('暂时离线');return book(id)}if(method==='getWorldBookRecallLog')return args.turn===1?{log:null,availableTurns:[1,2],message:'这一轮没有保存详细召回日志；旧轮次不从当前世界书反推。'}:{availableTurns:[1,2],log:{turn:2,status:window.logRequested?'requested':'prepared',counts:{selected:1,disabled:1},entries:[{ref:'setting',title:'场景约束',reason:'selected',reasonLabel:'已选中',rendering:'rendered',outputOrder:1}],outputs:[{ref:'setting',location:'foreground',text:'模板正文',requestContainsText:window.logRequested?true:null}]}};return {ok:true}}
    async function request(method,args,id){window.calls.push({method,args,id});if(method==='getGameWorldBook'&&window.delayBook)return new Promise(resolve=>window.pending.push(()=>resolve(book(id))));return respond(method,args,id)}
    const rpcWithTimeout=request,rpc=request;
    ${await readFile(new URL('../tavern-plugin/src/client/features/game-worldbook.js', import.meta.url), 'utf8')}
    let current='first',visible=true;const root=modules['react-dom/client'].createRoot(document.getElementById('root'));
    window.show=(id=current,show=visible)=>{current=id;visible=show;root.render(React.createElement(gameWorldbookFeature.View,{ctx,sessionId:id,visible:show}))};
    window.setBusy=(foreground,background=false)=>{running=foreground;busy=background;listeners.forEach(fn=>fn());window.show()};
    window.show();
  ` })
  await page.getByRole('heading', { name: 'first 世界书' }).waitFor()
  return page
}

test('世界书区分本局快照与资源库，条目筛选安全显示，空闲后显式同步', config, async t => {
  const page = await fixture(t)
  await page.getByText('当前展示本局保存的世界书快照', { exact: false }).waitFor()
  assert.equal(await page.getByText('启用 2', { exact: true }).count(), 1)
  await page.getByLabel('筛选', { exact: true }).selectOption('disabled')
  assert.equal(await page.locator('.dsh-game-worldbook-entry').count(), 1)
  await page.getByText('禁用事件', { exact: true }).click()
  await page.getByText('禁用正文', { exact: true }).waitFor()
  await page.getByLabel('筛选', { exact: true }).selectOption('all')
  await page.getByLabel('搜索条目', { exact: true }).fill('场景')
  assert.equal(await page.locator('.dsh-game-worldbook-entry').count(), 1)
  await page.getByText('场景约束', { exact: true }).click()
  assert.equal(await page.locator('.dsh-game-worldbook-entry img').count(), 0)
  assert.equal(await page.evaluate(() => window.untrusted), undefined)
  await page.getByRole('button', { name: '打开资源库世界书' }).click()
  assert.deepEqual(await page.evaluate(() => window.openCalls[0]), { seed: { type: 'dsh-tavern:worldbooks', meta: { worldBookSource: 'primary' } }, scope: { sessionId: 'first' } })
  await page.evaluate(() => window.setBusy(true))
  assert.equal(await page.getByRole('button', { name: '同步人物卡和世界书' }).isDisabled(), true)
  await page.evaluate(() => window.setBusy(false, true))
  assert.equal(await page.getByRole('button', { name: '同步人物卡和世界书' }).isDisabled(), true)
  await page.evaluate(() => window.setBusy(false, false))
  await page.getByRole('button', { name: '同步人物卡和世界书' }).click()
  await page.getByText('已同步人物卡和世界书', { exact: false }).waitFor()
  assert.match(await page.evaluate(() => window.confirmCalls[0]), /保留聊天历史和游戏变量/)
  assert.deepEqual(await page.evaluate(() => window.calls.find(call => call.method === 'applyUpdatedCard')), { method: 'applyUpdatedCard', args: { digest: 'verified-digest' }, id: 'first' })
  assert.deepEqual(await page.evaluate(() => window.invalidations), ['first'])
  await page.setViewportSize({ width: 320, height: 600 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
})

test('回合日志如实区分准备与请求证据，缺失历史不以当前条目冒充', config, async t => {
  const page = await fixture(t)
  await page.getByRole('button', { name: '回合接入记录' }).click()
  await page.getByText('已准备，尚无发送记录', { exact: false }).waitFor()
  await page.getByText('没有请求正文匹配证据', { exact: false }).waitFor()
  await page.evaluate(() => { window.logRequested = true })
  await page.getByRole('button', { name: '刷新世界书' }).click()
  await page.getByText('已关联模型请求', { exact: false }).waitFor()
  await page.getByText('请求正文已匹配', { exact: false }).waitFor()
  await page.getByLabel('回合', { exact: true }).selectOption('1')
  await page.getByText('旧轮次不从当前世界书反推', { exact: false }).waitFor()
  assert.equal(await page.getByText('请求正文已匹配', { exact: false }).count(), 0)
  assert.equal(await page.evaluate(() => window.calls.some(call => call.method === 'getWorldBookRecallLog' && call.args.turn === 1)), true)
})

test('隐藏与切换游戏取消旧请求，读取失败可重试，隐藏面板不监听刷新', config, async t => {
  const page = await fixture(t)
  await page.evaluate(() => { window.delayBook = true; window.show('second') })
  await page.getByText('正在读取本局世界书', { exact: false }).waitFor()
  await page.evaluate(() => { window.delayBook = false; window.show('third') })
  await page.getByRole('heading', { name: 'third 世界书' }).waitFor()
  await page.evaluate(() => window.pending.forEach(resolve => resolve()))
  assert.equal(await page.getByRole('heading', { name: 'second 世界书' }).count(), 0)
  await page.evaluate(() => window.show('third', false))
  const before = await page.evaluate(() => window.calls.length)
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('dsh-tavern-data-changed')))
  assert.equal(await page.evaluate(() => window.calls.length), before)
  await page.evaluate(() => { window.failBook = true; window.show('third', true) })
  await page.getByRole('alert').filter({ hasText: '暂时离线' }).waitFor()
  await page.evaluate(() => { window.failBook = false })
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await page.getByRole('heading', { name: 'third 世界书' }).waitFor()
})
