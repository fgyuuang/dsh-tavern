import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// The optional source card is read only. No chat, profile setting, worldbook,
// model or desktop process is touched. All helper writes stay in page memory.
// The editable seat implements the native input API contract, not the desktop
// conversation component. This does not verify parent-offline/read-only seats.
test('救赎之理真实开局和状态前端将输入桥接至可编辑正文输入框', {
  skip: !process.env.TAVERN_BROWSER_TESTS || !process.env.TAVERN_REDEMPTION_CARD,
  timeout: 90000
}, async t => {
  const { chromium } = await import('playwright')
  const card = JSON.parse(await readFile(process.env.TAVERN_REDEMPTION_CARD, 'utf8'))
  const raw = card.raw || card
  const scripts = raw.data?.extensions?.regex_scripts || raw.extensions?.regex_scripts
  function originalHtml(name) {
    const script = scripts.find(item => item.scriptName === name && !item.disabled)
    assert.ok(script, '原卡保留启用的 ' + name + ' 正则')
    return script.replaceString.replace(/^\s*```html\s*/i, '').replace(/\s*```\s*$/, '')
  }
  const [clientSource, jquery, lodash] = await Promise.all([
    readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8'),
    readFile(new URL('../tavern-plugin/lib/vendor/runtime-assets/jquery/jquery.min.js', import.meta.url), 'utf8'),
    readFile(new URL('../tavern-plugin/lib/vendor/runtime-assets/lodash/lodash.min.js', import.meta.url), 'utf8')
  ])
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
    : process.platform === 'win32' ? { channel: 'msedge' } : {})
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(10000)
  // Packaged jQuery/lodash replace only the external assets, not card handlers.
  await page.route('https://**/*', route => route.abort())
  await page.route('http://tavern.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>隔离的酒馆输入回归</title>' }))
  await page.goto('http://tavern.test/')
  const errors = []
  page.on('pageerror', error => { errors.push(error.message); t.diagnostic('browser error: ' + error.message) })
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
    iframe{width:650px;height:650px} [contenteditable]{min-height:60px;border:1px solid #666;white-space:pre-wrap}
    </style><section data-composer-card><div id="editor-A" role="textbox" contenteditable="true" data-composer-input="true" aria-label="A 的消息"></div><button id="send-A">发送 A</button></section>
    <section data-composer-card><div id="editor-B" role="textbox" contenteditable="true" data-composer-input="true" aria-label="B 的消息"></div><button id="send-B">发送 B</button></section>
    <script>window.__ModuleLoader__={load(value){window.clientDescriptor=value}};</script>`)
  await page.addScriptTag({ content: clientSource })
  await page.evaluate(() => {
    const client = window.clientDescriptor.factory(() => ({}))
    window.client = client
    window.calls = []; window.drafts = {}; window.bridgeErrors = []; window.releases = {}
    const live = new Set(['A', 'B'])
    const inputs = new Map(['A', 'B'].map(id => [id, {
      setDraft(value) {
        window.drafts[id] = value
        document.getElementById('editor-' + id).textContent = value
      },
      submit() {
        window.calls.push({ id, text: window.drafts[id] || '', source: 'native' })
        return Promise.resolve()
      }
    }]))
    const ctx = {
      sessions: {
        scope(id) { return live.has(id) ? id : null },
        binding(id) { return live.has(id) ? { session: { prompt(content) { window.calls.push({ id, text: content[0].text, source: 'legacy' }); return Promise.resolve({ ok: true }) } } } : null }
      },
      get(name) { return name === 'conversation' ? { input: { for(id) { return inputs.get(id) } } } : null }
    }
    const slash = client.createTavernFrameSlashExecutor(ctx, window)
    window.mountBridge = (frame, id) => {
      window.releases[frame.id] = client.installFrameHostComposer(document, node => node === frame,
        text => slash('', id, { inputText: text }),
        error => window.bridgeErrors.push(error.message),
        text => slash('/setinput ' + text, id))
    }
    window.removeSession = id => live.delete(id)
    for (const id of ['A', 'B']) {
      const editor = document.getElementById('editor-' + id)
      editor.addEventListener('input', () => { window.drafts[id] = editor.textContent })
      document.getElementById('send-' + id).onclick = () => inputs.get(id).submit()
    }
  })
  const state = { stat_data: {
    '环境与剧情': { '基础世界': '回归测试世界', '启示': { '激进': '沿街寻找线索', '保守': '询问门口的守卫', '忍耐': '等待来信', '享受': '观察窗外景色' } },
    '待赎者状态': { '基本信息': { '名字': '测试角色', '年龄': '成年' }, '物品与助力': { '物品栏': { '信封': { '数量': 1, '描述': '寻找收信人' } } } }
  } }
  const helperBootstrap = `<script>
    window.helperWrites=[]; window.worldbookWrites=[];
    window.updateVariable=async(path,value)=>{helperWrites.push({path,value});return true};
    window.getWorldbookNames=async()=>['救赎之理'];
    window.getWorldbookEntries=async()=>[];
    window.setWorldbookEntries=async(name,entries)=>{worldbookWrites.push({name,count:entries.length})};
    window.getAllVariables=()=>(${JSON.stringify(state)});
    window.eventOn=()=>()=>{};window.waitGlobalInitialized=async()=>{};window.errorCatched=fn=>fn;
    window.Mvu={events:{VARIABLE_UPDATE_ENDED:'VARIABLE_UPDATE_ENDED'}};
    </script>`
  function withHelpers(html) {
    return html.replace(/<script\b[^>]*\bsrc="https:\/\/code\.jquery\.com\/[^"\n]+"[^>]*><\/script>/i,
      () => '<script>' + jquery.replace(/<\/script/gi, '<\\/script') + '</script>')
      .replace(/<script\b[^>]*\bsrc="https:\/\/cdn\.jsdelivr\.net\/npm\/lodash[^"\n]+"[^>]*><\/script>/i,
        () => '<script>' + lodash.replace(/<\/script/gi, '<\\/script') + '</script>')
      .replace(/<head>/i, '<head>' + helperBootstrap)
  }
  async function mount(name, frameId, sessionId) {
    await page.evaluate(({ html, frameId, sessionId }) => {
      const frame = document.createElement('iframe'); frame.id = frameId
      document.body.append(frame); window.mountBridge(frame, sessionId); frame.srcdoc = html
    }, { html: withHelpers(originalHtml(name)), frameId, sessionId })
    return page.frameLocator('#' + frameId)
  }
  const opening = await mount('开局', 'opening', 'A')
  await opening.locator('#enter').click()
  await opening.locator('#go').click()
  await page.waitForFunction(() => (window.drafts.A || '').startsWith('【救赎之理】'))
  t.diagnostic('开局填入后的父文档焦点：' + await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName))
  assert.ok(await opening.locator('#log').innerText().then(text => text.includes('已写入输入框')))
  assert.equal(await page.evaluate(() => window.calls.length), 0, '开始降临只填入，不自动调用模型')
  const editorA = page.getByRole('textbox', { name: 'A 的消息' })
  await editorA.fill('我先观察入口。')
  assert.equal(await editorA.innerText(), '我先观察入口。', '开局交互后仍能手工编辑')
  await page.locator('#send-A').click()
  assert.deepEqual(await page.evaluate(() => window.calls.map(({ id, text }) => ({ id, text }))), [{ id: 'A', text: '我先观察入口。' }])

  const status = await mount('前端', 'status', 'B')
  await status.locator('#btn-sug-con').click()
  await page.waitForFunction(() => window.drafts.B === '询问门口的守卫')
  assert.equal(await editorA.innerText(), '我先观察入口。', 'B 的建议不会覆盖 A 的草稿')
  assert.equal(await page.evaluate(() => window.calls.length), 1, '建议按钮只填入')
  await status.locator('.tab-btn[data-target="sec-exec"]').click()
  await status.locator('.inv-item').click()
  await status.locator('#inv-use').click()
  await page.waitForFunction(() => (window.drafts.B || '').includes('信封'))
  assert.equal(await status.locator('#inv-modal').isVisible(), false, '道具确认后遮罩关闭')
  const editorB = page.getByRole('textbox', { name: 'B 的消息' })
  await editorB.fill('我打开信封，查看署名。')
  await page.locator('#send-B').click()
  assert.equal(await page.evaluate(() => window.calls.length), 2, '各自发送按钮产生一次调用')

  // A and B remain mounted: focused-frame routing must select exactly B.
  await status.locator('.tab-btn[data-target="sec-env"]').click()
  await status.locator('#btn-sug-con').click()
  await page.evaluate(() => {
    const button = document.getElementById('send_but'); button.click(); button.click()
  })
  await page.waitForFunction(() => window.calls.length === 3)
  assert.equal(await page.evaluate(() => window.calls[2].id), 'B', '隐藏发送桥按所属 iframe 发送')
  assert.equal(await page.evaluate(() => window.calls[2].text), '询问门口的守卫')

  // Capture an input, then retire that owner before the Promise microtask runs.
  await page.evaluate(() => {
    document.getElementById('status').focus()
    const area = document.getElementById('send_textarea')
    area.value = '应拒绝的过期填入'
    area.dispatchEvent(new Event('input', { bubbles: true }))
    window.releases.status(); document.getElementById('status').remove()
  })
  await page.waitForFunction(() => window.bridgeErrors.length > 0)
  assert.equal(await editorB.innerText(), '询问门口的守卫', '卸载后拒绝已经排队的填入')
  assert.equal(await page.evaluate(() => window.calls.length), 3, '卸载不补发消息')
  assert.deepEqual(errors, [])
  t.diagnostic('原卡开局、建议、道具、手工编辑、双帧隔离、重复发送和过期回调均通过；2 次用户发送、1 次兼容按钮发送；没有模型调用。')
})
