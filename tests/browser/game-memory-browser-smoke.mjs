// Real shipped React components and HTTP client; all hosted data is synthetic.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { browserReactScript } from '../fixtures/browser-react.mjs'

export async function runGameMemoryBrowserSmoke({ outputRoot = 'D:/pro/DSH-Tavern/temp/agent-memory-browser-qa' } = {}) {
  await mkdir(outputRoot, { recursive: true })
  const output = await mkdtemp(join(outputRoot, 'run-'))
  const [bundle, client, css] = await Promise.all([
    browserReactScript(),
    readFile(new URL('../../tavern-plugin/lib/client.js', import.meta.url), 'utf8'),
    readFile(new URL('../../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8')
  ])
  assert.match(client, /exports\.registerGameMemoryFeature =/, 'build the shipped client before this browser test')
  const longPath = 'memory/' + '漫长世界中仍然需要保留的事件出处与人物线索'.repeat(3) + '.md'
  const longText = '# 灯塔记忆\n<script>window.memoryScriptRan=true</script>\n' + '合成资料。'.repeat(1190) + '\n第二页标记\n' + '已确认事件。'.repeat(1190) + '\n第三页标记'
  const filesA = [{ path: longPath, text: longText }, ...Array.from({ length: 22 }, (_, index) => ({ path: 'characters/人物-' + String(index).padStart(2, '0') + '.md', text: '角色资料：合成角色 ' + index + '。已知灯塔位置，未得知密信。' }))]
  const filesB = [{ path: 'memory/独立分支.md', text: '# 独立分支\n这里是 B 局的记忆，尚未进入灯塔。' }]
  const calls = [], errors = [], checks = []
  let hold = null, failNextRead = false
  function memory(args) {
    const source = args.sessionId === 'game-b' ? filesB : filesA
    const head = args.sessionId === 'game-b' ? 'b'.repeat(64) : 'a'.repeat(64)
    const base = { head, branchId: 'branch-' + args.sessionId, revision: 12, enabled: args.sessionId !== 'game-b' }
    const describe = file => ({ path: file.path, hash: 'c'.repeat(64), bytes: Buffer.byteLength(file.text) })
    if (args.action === 'read') {
      const file = source.find(file => file.path === args.path)
      if (!file) return { ...base, path: args.path, status: 'not-found' }
      const offset = args.offset || 0, limit = args.limit || 6000
      return { ...base, ...describe(file), status: 'found', text: file.text.slice(offset, offset + limit), offset, total: file.text.length, nextOffset: offset + limit < file.text.length ? offset + limit : null }
    }
    if (args.action === 'search') {
      const matches = source.filter(file => (file.path + file.text).includes(args.query)).map(file => ({ ...describe(file), excerpt: file.text.slice(0, 100), offset: 0, score: 1 }))
      return { ...base, matches: matches.slice(0, args.limit), total: matches.length }
    }
    const offset = args.offset || 0, limit = args.limit || 20
    return { ...base, files: source.slice(offset, offset + limit).map(describe), total: source.length, offset, nextOffset: offset + limit < source.length ? offset + limit : null }
  }
  const assets = {
    '/bundle.js': bundle,
    '/client.js': client,
    '/style.css': css + ':root{--dsw-alias-border-l2:#d7dce2;--dsw-specific-input-major:#fff;--dsw-alias-label-primary:#222;--dsw-alias-label-secondary:#666;--dsw-alias-bg-base:#fff}body{margin:0;font:15px sans-serif;background:#fafafa}#sidebar{display:none}#app{height:100vh;width:100%}button{cursor:pointer}*{box-sizing:border-box}',
    '/runner.js': `
window.__tabs={};window.__slots={};window.__disposers=[];let captureMemory=false;
const state={current:'game-a',byId:{}};
const ctx={inject(){return {dispose(){}}},get(){},effect(run,label){if(label==='dsh-tavern: Tavern workspace browser'||captureMemory&&label.startsWith('dsh-tavern: game memory')){const stop=run();if(typeof stop==='function')__disposers.push(stop);return stop;}return ()=>{};},
 slots:{inject(name,run){return run()},register(spec,component){__slots[spec.id||spec.name]=component;return ()=>{};}},
 sessions:{subagentAddress:()=>null,refresh:async()=>{},list:{getSnapshot:()=>state},binding:()=>null},workspaces:{},
 betterSidebar:{registerTab(spec){__tabs[spec.id]=spec;return ()=>{};}},tavernSessionSignals:{subscribe:()=>()=>{}}};
client.apply(ctx);captureMemory=true;client.registerGameMemoryFeature({ctx,slots:ctx.slots});
const React=modules.react;
modules['react-dom/client'].createRoot(document.querySelector('#sidebar')).render(React.createElement(__slots['sidebar.workspaces'],{wide:true,useSessions:select=>select(state),useWorkspaces:select=>select({items:[]})}));
const root=modules['react-dom/client'].createRoot(document.querySelector('#app'));
window.mountMemory=(sessionId='game-a',visible=true)=>{state.current=sessionId;root.render(React.createElement(__tabs['dsh-tavern:game-memory'].component,{scope:{sessionId},visible}));};
mountMemory();`
  }
  const server = createServer(async (request, response) => {
    try {
      if (request.method === 'POST') {
        let body = ''; for await (const chunk of request) body += chunk
        const args = JSON.parse(body || '{}')
        const method = request.url.split('/').at(-1)
        calls.push({ method, args })
        const responses = {
          listCards: { cards: [] }, getCardOrganization: { organization: { groups: [], assignments: {} } },
          listSessions: { sessions: ['game-a', 'game-b'].map(sessionId => ({ sessionId, chatId: sessionId, mode: 'story', cardName: '合成验收卡' })) },
          getUpdateStatus: { status: { phase: 'idle', host: 'cli' } }, getHostCompatibility: {}, confirmSessionPatch: {},
          syncSession: { sync: { activity: { busy: false }, tasks: {} } },
          getSession: { view: { mode: 'story', activity: { busy: false }, tavernHelper: { messages: [] } } }
        }
        if (method === 'getGameMemory') {
          if (failNextRead && args.action === 'read') { failNextRead = false; throw Error('合成离线错误') }
          const data = memory(args)
          if (hold && hold.matches(args)) { const gate = hold; hold = null; gate.started(); await gate.promise }
          response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ ok: true, memory: data })); return
        }
        if (!(method in responses)) throw Error('Unexpected fake-host RPC: ' + method)
        response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ ok: true, ...responses[method] })); return
      }
      if (request.url in assets) { response.writeHead(200, { 'content-type': request.url.endsWith('.css') ? 'text/css' : 'text/javascript' }); response.end(assets[request.url]); return }
      if (request.url !== '/') { response.writeHead(404); response.end(); return }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end('<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>合成记忆组件验收</title><link rel="stylesheet" href="/style.css"><div id="sidebar"></div><main id="app"></main><script src="/bundle.js"></script><script>window.__ModuleLoader__={load(d){window.client=d.factory(name=>name===\'react\'?modules.react:{});}};</script><script src="/client.js"></script><script src="/runner.js"></script></html>')
    } catch (error) { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ ok: false, error: error.message })) }
  })
  const gate = matches => {
    let release, start
    const started = new Promise(resolve => { start = resolve })
    hold = { matches, started: start, promise: new Promise(resolve => { release = resolve }) }
    return { started, release }
  }
  const browser = await chromium.launch({ headless: true })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const page = await browser.newPage({ viewport: { width: 780, height: 900 } })
  page.setDefaultTimeout(7000)
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.goto('http://127.0.0.1:' + server.address().port)
    const panel = page.getByRole('complementary', { name: '本局记忆' })
    await panel.getByRole('button', { name: longPath }).waitFor()
    assert.equal(await panel.locator('.dsh-game-memory-file').count(), 20)
    await panel.getByRole('button', { name: '下一页', exact: true }).click()
    await page.waitForFunction(() => document.querySelectorAll('.dsh-game-memory-file').length === 3)
    await panel.getByRole('button', { name: '上一页', exact: true }).click()
    await panel.getByRole('button', { name: longPath }).click()
    await panel.locator('pre').filter({ hasText: '灯塔记忆' }).waitFor()
    assert.ok(await panel.locator('pre').innerText())
    await panel.getByRole('button', { name: '下一页', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.dsh-game-memory-pages')?.textContent.includes('6001'))
    await panel.locator('pre').filter({ hasText: '第二页标记' }).waitFor()
    checks.push('真实 list 20/3 分页与 read 6000 字符分页')
    assert.equal(await page.evaluate(() => window.memoryScriptRan), undefined)
    checks.push('文档 HTML/script 作为原文展示，未执行')
    await panel.getByRole('button', { name: '← 返回文档列表' }).click()
    await panel.getByRole('searchbox').fill('密信')
    await panel.getByRole('button', { name: '搜索', exact: true }).click()
    await panel.getByText(/“密信”匹配 22 份文档/).waitFor()
    assert.equal(await panel.locator('.dsh-game-memory-file').count(), 8)
    checks.push('中文搜索与前 8 项结果说明')
    const oldSearch = gate(args => args.action === 'search' && args.query === '旧线索')
    await panel.getByRole('searchbox').fill('旧线索'); await panel.getByRole('button', { name: '搜索', exact: true }).click()
    await oldSearch.started
    await panel.getByRole('searchbox').fill('灯塔'); await panel.getByRole('button', { name: '搜索', exact: true }).click()
    await panel.getByText(/“灯塔”匹配/).waitFor()
    const releasedSearch = page.waitForResponse(response => response.url().endsWith('/getGameMemory') && response.request().postDataJSON()?.query === '旧线索')
    oldSearch.release(); await releasedSearch
    await panel.getByText(/“灯塔”匹配/).waitFor()
    assert.equal(await panel.getByText('没有匹配的记忆文档。').count(), 0)
    checks.push('旧搜索迟到响应未覆盖新搜索')
    await panel.getByRole('button', { name: '全部文档', exact: true }).click()
    const oldRead = gate(args => args.sessionId === 'game-a' && args.action === 'read')
    await panel.getByRole('button', { name: longPath }).click(); await oldRead.started
    await page.evaluate(() => mountMemory('game-b'))
    await panel.getByRole('button', { name: /memory\/独立分支.md/ }).waitFor()
    const releasedRead = page.waitForResponse(response => response.url().endsWith('/getGameMemory') && response.request().postDataJSON()?.action === 'read')
    oldRead.release(); await releasedRead
    await panel.getByRole('button', { name: /memory\/独立分支.md/ }).waitFor()
    assert.equal(await panel.locator('.dsh-game-memory-document').count(), 0)
    checks.push('切 session 后旧文档响应未泄漏到新分支')
    failNextRead = true
    await panel.getByRole('button', { name: /memory\/独立分支.md/ }).click()
    await panel.getByRole('alert').filter({ hasText: '合成离线错误' }).waitFor()
    await panel.getByRole('button', { name: '重试', exact: true }).click()
    await panel.locator('pre').filter({ hasText: '这里是 B 局的记忆' }).waitFor()
    checks.push('真实 HTTP 读取错误显示并可重试恢复')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(() => mountMemory('game-a'))
    await panel.getByRole('button', { name: longPath }).waitFor()
    await panel.getByRole('button', { name: longPath }).click()
    await panel.locator('pre').waitFor()
    const widths = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, panel: document.querySelector('.dsh-game-memory').scrollWidth }))
    assert.ok(widths.document <= widths.viewport && widths.panel <= widths.viewport, 'narrow-screen horizontal overflow: ' + JSON.stringify(widths))
    await page.screenshot({ path: join(output, 'memory-document-390.png'), fullPage: true })
    await panel.getByRole('button', { name: '← 返回文档列表' }).click()
    await panel.getByRole('button', { name: longPath }).waitFor()
    await page.screenshot({ path: join(output, 'memory-list-390.png'), fullPage: true })
    const listWidths = await panel.locator('.dsh-game-memory-file').first().evaluate(element => ({ width: element.clientWidth, contentWidth: element.scrollWidth, height: element.clientHeight, contentHeight: element.scrollHeight, whiteSpace: getComputedStyle(element).whiteSpace }))
    assert.ok(listWidths.contentWidth <= listWidths.width + 1, 'long document filename is clipped: ' + JSON.stringify(listWidths))
    assert.ok(listWidths.contentHeight <= listWidths.height + 1, 'document metadata overlaps the next row: ' + JSON.stringify(listWidths))
    checks.push('390px 长中文文件名、长文档无横向溢出')
    assert.deepEqual(errors, [])
    assert.ok(calls.filter(call => call.method === 'getGameMemory').every(call => ['list', 'read', 'search'].includes(call.args.action)))
    const report = { ok: true, syntheticDataOnly: true, checks, errors, widths, listWidths, memoryCalls: calls.filter(call => call.method === 'getGameMemory').map(call => call.args), output }
    await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2), 'utf8')
    return report
  } catch (error) {
    await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
    await writeFile(join(output, 'failure.json'), JSON.stringify({ error: error.message, errors, calls }, null, 2), 'utf8')
    throw error
  } finally { if (hold) hold.started(); await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
}
