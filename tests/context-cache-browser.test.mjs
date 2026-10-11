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
  page.setDefaultTimeout(8000)
  await page.route('http://cache.test/**', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
  await page.goto('http://cache.test/')
  await page.addStyleTag({ content: await readFile(new URL('../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8') + '\nbody{margin:0;font-family:Arial,sans-serif}' })
  await page.addScriptTag({ content: await browserReactScript() + `
    const React=modules.react;const useTavernSessionMode=()=> 'play',isPlayMode=value=>value==='play';
    window.calls=[];window.pending=[];window.registrations=[];window.delay=false;window.fail=false;
    const tavernUiExtensions={service:{registerWorkbenchPanel:entry=>{window.registrations.push(entry);return()=>{}}}};
    function result(id,prefix){return {audit:{summary:{requests:2,requestsWithUsage:1,requestsWithoutUsage:1,cacheReadRatio:.9,totals:{inputTokens:100,cacheReadTokens:900,outputTokens:10}},requests:[{id:id+'-known',sessionId:id,scope:'foreground',task:'reply',provider:id,model:'<img src=x onerror="window.untrusted=true">',turn:2,step:1,usage:{inputTokens:100,cacheReadTokens:900,outputTokens:10,totalTokens:1010},promptTokens:1000,cacheReadRatio:.9,...prefix?{prefix:{serializedCharacters:3000,sharedPrefixCharacters:2800}}:{}},{id:id+'-unknown',sessionId:id,scope:'background',task:'dream-followup',provider:id,model:'model',turn:2,step:1,usage:null,promptTokens:null,cacheReadRatio:null}]}}}
    const rpcWithTimeout=async(method,args,id)=>{window.calls.push({method,args,id});if(window.delay)return new Promise(resolve=>window.pending.push(()=>resolve(result(id,args.includePrefix))));if(window.fail)throw Error('统计暂时离线');return result(id,args.includePrefix)};
    ${await readFile(new URL('../tavern-plugin/src/client/features/context-cache.js', import.meta.url), 'utf8')}
    contextCacheFeature.register({ctx:{effect:fn=>fn()}});
    const root=modules['react-dom/client'].createRoot(document.getElementById('root'));let current='first',visible=true;
    window.show=(id=current,show=visible)=>{current=id;visible=show;root.render(React.createElement(contextCacheFeature.View,{sessionId:id,visible:show}))};
    window.show();
  ` })
  await page.getByText('90.0%', { exact: true }).waitFor()
  return page
}

test('缓存面板使用真实互斥计数，未报告不冒充零，前缀字符不冒充token', config, async t => {
  const page = await fixture(t)
  assert.equal(await page.getByText('1 / 2', { exact: true }).count(), 1)
  assert.equal(await page.getByText('1,000', { exact: true }).count(), 1)
  await page.getByText('1 次请求未报告 usage', { exact: false }).waitFor()
  await page.locator('details').first().locator('summary').click()
  await page.getByText('输入 1,000 token · 缓存读取率 90.0%', { exact: true }).waitFor()
  assert.equal(await page.locator('.dsh-context-cache img').count(), 0)
  assert.equal(await page.evaluate(() => window.untrusted), undefined)
  await page.getByRole('button', { name: '检查最近请求前缀' }).click()
  await page.getByText('结构前缀：2,800 / 3,000 字符', { exact: false }).waitFor()
  assert.equal(await page.evaluate(() => window.calls[0].args.includePrefix), false)
  assert.equal(await page.evaluate(() => window.calls.at(-1).args.includePrefix), true)
  assert.equal(await page.evaluate(() => window.calls.every(call => call.method === 'getContextCacheAudit' && call.args.limit === 50)), true)
})

test('切局忽略旧请求，隐藏不轮询或监听刷新', config, async t => {
  const page = await fixture(t)
  await page.evaluate(() => { window.delay = true; window.show('second') })
  await page.getByText('正在读取缓存统计', { exact: false }).waitFor()
  await page.evaluate(() => { window.delay = false; window.show('third') })
  await page.getByText('third /', { exact: false }).first().waitFor()
  await page.evaluate(() => window.pending.forEach(resolve => resolve()))
  assert.equal(await page.getByText('second /', { exact: false }).count(), 0)
  await page.evaluate(() => window.show('third', false))
  await page.waitForFunction(() => document.querySelector('button').disabled)
  const before = await page.evaluate(() => window.calls.length)
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new CustomEvent('dsh-tavern-data-changed')) })
  await page.waitForTimeout(200)
  assert.equal(await page.evaluate(() => window.calls.length), before)
})

test('模块注册可独立隐藏，错误手动重试，窄屏保持面板宽度', config, async t => {
  const page = await fixture(t)
  assert.deepEqual(await page.evaluate(() => window.registrations.map(({ id, label, keepAlive }) => ({ id, label, keepAlive }))), [{ id: 'tavern/context-cache', label: '上下文缓存', keepAlive: true }])
  await page.evaluate(() => { window.fail = true })
  await page.getByRole('button', { name: '刷新缓存统计' }).click()
  await page.getByRole('alert').filter({ hasText: '统计暂时离线' }).waitFor()
  await page.evaluate(() => { window.fail = false })
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await page.getByText('90.0%', { exact: true }).waitFor()
  await page.setViewportSize({ width: 320, height: 600 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
})
