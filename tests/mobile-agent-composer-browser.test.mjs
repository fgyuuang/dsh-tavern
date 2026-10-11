import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'

test('手机 Agent 工具、候选、输入器和软键盘同时出现时仍可点击发送', {
  skip: !process.env.TAVERN_BROWSER_TESTS, timeout: 60000,
}, async t => {
  const { chromium } = await import('playwright')
  const { install, viewport, nativeComposer } = await import('./fixtures/mobile-layout-browser.mjs')
  const browser = await chromium.launch(process.platform === 'win32' ? { channel: 'msedge' } : {})
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await install(page)
  await nativeComposer(page)
  const source = await readFile(new URL('../tavern-plugin/src/client/features/play-controls.js', import.meta.url), 'utf8')
  const dock = source.slice(source.indexOf('function DreamSikeInteractionDock('), source.indexOf('function CandidateDockActions('))
  await page.addScriptTag({ content: `
    const useTavernCoordination=()=>({view:{activity:{busy:false}}}), describeTavernActivity=x=>x;
    function DreamSikeMainTurnStatus(){return React.createElement('span',null,'检查正文')}
    function CandidateAction(){return React.createElement('button',null,'行动灵感')}
    function TavernMoreActions(){return React.createElement('button',null,'更多')}
    ${dock}
    const oldDock=document.querySelector('.dsh-tavern-dock-actions');
    const mobileDock=document.createElement('div'); mobileDock.style.display='contents'; oldDock.replaceWith(mobileDock);
    ReactDOM.createRoot(mobileDock).render(React.createElement(DreamSikeInteractionDock,{
      sessionId:'fixture',messageId:'m',running:false,openAgentSettings(){},openDraft(){}
    }));
    window.sentDrafts=[];
    document.querySelector('[aria-label="发送"]').onclick=()=>window.sentDrafts.push(document.querySelector('[contenteditable]').innerText);
  ` })
  await page.getByRole('button', { name: '展开创作工具' }).waitFor()
  await mkdir('output/playwright/mobile', { recursive: true })
  for (const width of [320, 390, 430, 844]) {
    await page.setViewportSize({ width, height: width === 844 ? 390 : 844 })
    await viewport(page, { height: width === 844 ? 390 : 844, offsetTop: 0 })
    await page.getByRole('textbox', { name: '消息' }).fill('手机草稿：检查角色后，再回应眼前的人。')
    await page.getByRole('button', { name: '展开创作工具' }).click()
    assert.equal(await page.getByRole('button', { name: '创作设置' }).isVisible(), true)
    if (width === 390) await page.screenshot({ path: 'output/playwright/mobile/agent-tools-390.png' })
    await page.getByRole('textbox', { name: '消息' }).click()
    assert.equal(await page.getByRole('button', { name: '创作设置' }).isVisible(), false)
    if (width === 390) await page.screenshot({ path: 'output/playwright/mobile/agent-idle-390.png' })
    for (const height of [400, 280, 220]) {
      await viewport(page, { height, offsetTop: 20 })
      const send = page.getByRole('button', { name: '发送', exact: true })
      const bounds = await send.boundingBox()
      assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width, '发送按钮不被横向挤出')
      assert.ok(bounds.y >= 20 && bounds.y + bounds.height <= height + 21, '发送按钮在键盘上方')
      assert.ok(bounds.width >= 40 && bounds.height >= 40)
      assert.equal(await send.evaluate(el => { const b = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)) }), true, '发送区域没有被工具栏遮挡')
      await send.click()
      assert.equal(await page.evaluate(() => window.sentDrafts.at(-1)), '手机草稿：检查角色后，再回应眼前的人。')
      await page.getByRole('textbox', { name: '消息' }).focus()
      if (width === 390 && height === 280) await page.screenshot({ path: 'output/playwright/mobile/agent-typing-390.png' })
    }
  }
  assert.deepEqual(errors, [])
})
