import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { browserReactScript } from './fixtures/browser-react.mjs'

const config = { skip: !process.env.TAVERN_BROWSER_TESTS, timeout: 30000 }
async function fixture(t) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch(process.platform === 'win32' ? { channel: 'msedge' } : {})
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 900, height: 800 } })
  page.setDefaultTimeout(8000)
  page.on('pageerror', error => console.error('opening worldbook fixture:', error.message))
  await page.setContent('<form id="form"><div id="root"></div></form>')
  await page.addStyleTag({ content: await readFile(new URL('../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8') + '\nbody{margin:0;font-family:Arial,sans-serif}#root{padding:12px;box-sizing:border-box}form{margin:0}' })
  await page.addScriptTag({ content: await browserReactScript() + `
    const React=modules.react;
    window.calls=[];window.events=[];window.intervals=new Map();window.timerId=0;window.pending=[];
    window.delayGet=false;window.delaySave=false;window.failGet=false;window.submits=0;
    document.getElementById('form').onsubmit=event=>{event.preventDefault();window.submits++};
    window.setInterval=callback=>{const id=++window.timerId;window.intervals.set(id,callback);return id};
    window.clearInterval=id=>window.intervals.delete(id);
    window.poll=()=>Promise.all([...window.intervals.values()].map(fn=>fn()));
    const snapshots=new Map();
    function make(id){return {name:id+' · 救赎之理',source:'test-source',revision:'r1',counts:{total:109,enabled:17,constant:14,dynamic:0,mvuRules:3},entries:Array.from({length:109},(_,index)=>({ref:'entry-'+index,title:'剧情设定 '+index,enabled:index<17,constant:true,mvuRule:index>=14&&index<17}))}}
    function get(id){if(!snapshots.has(id))snapshots.set(id,make(id));return structuredClone(snapshots.get(id))}
    function mutate(id,ref,enabled){const value=get(id);value.entries.find(item=>item.ref===ref).enabled=enabled;value.revision+='-saved';value.counts.enabled=value.entries.filter(item=>item.enabled).length;snapshots.set(id,value);return structuredClone(value)}
    window.scriptEnable=(id,ref)=>mutate(id,ref,true);
    async function call(method,args){window.calls.push({method,args});if(method==='createOpeningPreparation')return {id:'prep-'+args.path};if(method==='getOpeningWorldBook'){if(window.delayGet)return new Promise((resolve,reject)=>window.pending.push({method,resolve:()=>resolve(get(args.id)),reject}));if(window.failGet)throw Error('世界书读取失败');return get(args.id)}if(method==='setOpeningWorldBookEntryEnabled'){const value=get(args.id);if(value.revision!==args.revision)throw Error('revision conflict');const perform=()=>mutate(args.id,args.ref,args.enabled);if(window.delaySave)return new Promise(resolve=>window.pending.push({method,resolve:()=>resolve(perform())}));return perform()}throw Error('unknown method')}
    ${await readFile(new URL('../tavern-plugin/src/client/features/opening-worldbook.js', import.meta.url), 'utf8')}
    let update;
    function App(){const [card,setCard]=React.useState('first'),[id,setId]=React.useState(''),[ready,setReady]=React.useState(false),[visible,setVisible]=React.useState(true);update={switchCard(next){setCard(next);setId('');setReady(false)},setVisible};return React.createElement(React.Fragment,null,
      React.createElement('output',{'aria-label':'准备状态'},ready?'可以开始':'暂不可开始'),
      React.createElement(TavernOpeningWorldbook,{cardPath:card,userName:'测试玩家',preparationId:id,visible,busy:false,call,onReady:next=>{window.events.push('ready:'+next);setId(next);setReady(true)},onPending:()=>{window.events.push('pending');setReady(false)},onError:()=>{window.events.push('error');setReady(false)},openLibrary:source=>window.events.push('library:'+source)}));}
    window.switchCard=next=>update.switchCard(next);window.show=value=>update.setVisible(value);
    const root=modules['react-dom/client'].createRoot(document.getElementById('root'));root.render(React.createElement(App));
  ` })
  await page.getByText('17/109 条启用', { exact: false }).waitFor()
  await page.getByLabel('准备状态').filter({ hasText: '可以开始' }).waitFor()
  return page
}

test('准备页惰性创建、闭合摘要和条目 CAS 修改，不提交开局表单', config, async t => {
  const page = await fixture(t)
  assert.equal(await page.evaluate(() => window.calls.filter(call => call.method === 'createOpeningPreparation').length), 1)
  assert.equal(await page.locator('.dsh-opening-worldbook details').getAttribute('open'), null)
  await page.locator('.dsh-opening-worldbook summary').click()
  assert.equal(await page.getByRole('checkbox').count(), 109)
  await page.evaluate(() => { window.delaySave = true })
  await page.getByRole('checkbox').first().click()
  await page.getByLabel('准备状态').filter({ hasText: '暂不可开始' }).waitFor()
  assert.equal(await page.getByRole('checkbox').last().isDisabled(), true)
  const save = await page.evaluate(() => window.calls.find(call => call.method === 'setOpeningWorldBookEntryEnabled'))
  assert.deepEqual(save.args, { id: 'prep-first', ref: 'entry-0', enabled: false, revision: 'r1' })
  await page.evaluate(() => window.pending.find(task => task.method === 'setOpeningWorldBookEntryEnabled').resolve())
  await page.getByText('16/109 条启用', { exact: false }).waitFor()
  await page.getByLabel('准备状态').filter({ hasText: '可以开始' }).waitFor()
  assert.equal(await page.evaluate(() => window.submits), 0)
  await page.getByRole('button', { name: '管理资源库原件', exact: false }).click()
  assert.equal(await page.evaluate(() => window.events.includes('library:test-source')), true)
  await page.setViewportSize({ width: 390, height: 600 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
  assert.equal(await page.locator('.dsh-opening-worldbook-entries').evaluate(node => node.scrollHeight > node.clientHeight && node.clientHeight <= 231), true)
})

test('准备页轮询显示角色卡脚本选择，读取失败禁止开始并可恢复', config, async t => {
  const page = await fixture(t)
  await page.locator('.dsh-opening-worldbook summary').click()
  await page.getByLabel('搜索条目').fill('剧情设定 108')
  assert.equal(await page.getByRole('checkbox').isChecked(), false)
  await page.evaluate(async () => { window.scriptEnable('prep-first','entry-108');await window.poll() })
  await page.getByText('18/109 条启用', { exact: false }).waitFor()
  assert.equal(await page.getByRole('checkbox').isChecked(), true)
  await page.evaluate(async () => { window.failGet=true;await window.poll() })
  await page.getByRole('alert').filter({ hasText: '世界书读取失败' }).waitFor()
  await page.getByLabel('准备状态').filter({ hasText: '暂不可开始' }).waitFor()
  await page.evaluate(async () => { window.failGet=false;await window.poll() })
  await page.getByLabel('准备状态').filter({ hasText: '可以开始' }).waitFor()
  assert.equal(await page.getByRole('alert').count(), 0)
})

test('准备页切换人物卡拒绝过期读写回调，隐藏时停止轮询', config, async t => {
  const page = await fixture(t)
  await page.evaluate(async () => { window.delayGet=true;void window.poll() })
  await page.evaluate(() => { window.delayGet=false;window.switchCard('second') })
  await page.getByText('prep-second · 救赎之理', { exact: false }).waitFor()
  const readyCount = await page.evaluate(() => window.events.filter(item=>item==='ready:prep-first').length)
  await page.evaluate(() => window.pending.filter(task=>task.method==='getOpeningWorldBook').forEach(task=>task.resolve()))
  assert.equal(await page.evaluate(() => window.events.filter(item=>item==='ready:prep-first').length), readyCount)
  assert.equal(await page.getByText('prep-first · 救赎之理', { exact: false }).count(), 0)
  await page.locator('.dsh-opening-worldbook summary').click()
  await page.evaluate(() => { window.delaySave=true })
  await page.getByRole('checkbox').first().click()
  await page.getByLabel('准备状态').filter({ hasText: '暂不可开始' }).waitFor()
  await page.evaluate(() => window.switchCard('third'))
  await page.getByText('prep-third · 救赎之理', { exact: false }).waitFor()
  const secondReadyCount = await page.evaluate(() => window.events.filter(item=>item==='ready:prep-second').length)
  await page.evaluate(() => window.pending.filter(task=>task.method==='setOpeningWorldBookEntryEnabled').forEach(task=>task.resolve()))
  assert.equal(await page.evaluate(() => window.events.filter(item=>item==='ready:prep-second').length), secondReadyCount)
  await page.getByLabel('准备状态').filter({ hasText: '可以开始' }).waitFor()
  await page.evaluate(() => window.show(false))
  await page.waitForFunction(() => window.intervals.size === 0)
  assert.equal(await page.evaluate(() => window.intervals.size), 0)
  const calls = await page.evaluate(() => window.calls.length)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  assert.equal(await page.evaluate(() => window.calls.length), calls)
})
