import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { browserReactScript } from './fixtures/browser-react.mjs'
const config = { skip: !process.env.TAVERN_BROWSER_TESTS, timeout: 30000 }
async function fixture(t) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch(process.platform === 'win32' ? { channel: 'msedge' } : {})
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 390, height: 700 } })
  page.setDefaultTimeout(8000)
  await page.setContent('<textarea id="player-input">尚未发送的新行动</textarea><div id="root"></div>')
  await page.addStyleTag({ content: await readFile(new URL('../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8') })
  const source = await readFile(new URL('../tavern-plugin/src/client/features/play-controls.js', import.meta.url), 'utf8')
  const component = source.slice(source.indexOf('async function continueInterruptedTavernTurn('), source.indexOf('function CandidateAction('))
  await page.addScriptTag({ content: await browserReactScript() + `
    const React=modules.react; window.calls=[];window.replays=[];window.applied=[];window.invalidated=[];
    let view={playPresetId:'dream-sike-dsh',canReplayFailedTurn:true,replayFailedTurn:8,dreamSikeDraftState:{turn:8,status:'draft',version:5}};
    window.savedDraft={turn:8,status:'draft',version:5,operationId:'op-8',resumable:true};
    const liveTavernView={getSnapshot:()=>({view}),invalidate:id=>window.invalidated.push(id)};
    const historyProjection={};const setRegenPanel=()=>{};const setCandidatePanel=()=>{};const setCandidateGuidePanel=()=>{};
    const notifyTavernDataChanged=()=>{};const tavernCoordination={invalidate:()=>{}};
    const applyBodyRegenerationResult=result=>window.applied.push(result);
    const submitFailedTurnReplay=async id=>{window.replays.push(id);return {ok:true}};
    const rpc=async(method,args,id)=>{window.calls.push({method,args,id});if(method==='getDraftView')return {draft:window.savedDraft};return new Promise(resolve=>window.resolveResume=resolve)};
    ${component}
    const root=modules['react-dom/client'].createRoot(document.getElementById('root'));
    window.show=(patch={},running=false)=>{view={...view,...patch};root.render(React.createElement(TavernInterruptedContinuation,{sessionId:'session',view,running}))};
    window.show();
  ` })
  return page
}
test('中断提示直接继续现有草稿，防止双击重复排队并保持玩家输入', config, async t => {
  const page = await fixture(t)
  const button = page.getByRole('button', { name: '继续本回合' })
  await button.waitFor()
  await page.evaluate(() => { const button=document.querySelector('button');button.click();button.click() })
  await page.waitForFunction(() => window.calls.length === 2)
  assert.deepEqual(await page.evaluate(() => window.calls.map(call=>call.method)), ['getDraftView', 'resumeDreamSikeDraft'])
  assert.deepEqual(await page.evaluate(() => window.calls[1].args), { sessionId: 'session', expectedOperationId: 'op-8', expectedVersion: 5 })
  assert.equal(await page.getByRole('button', { name: '正在继续…' }).isDisabled(), true)
  await page.evaluate(() => window.resolveResume({ view: { mode: 'story' } }))
  await page.waitForFunction(() => window.applied.length === 1)
  assert.equal(await page.locator('#player-input').inputValue(), '尚未发送的新行动')
  assert.deepEqual(await page.evaluate(() => window.replays), [])
})
test('手动停止没有错误节点时也显示继续入口；没有草稿则重放原输入', config, async t => {
  const page = await fixture(t)
  await page.evaluate(() => window.show({ playPresetId: 'tavern', dreamSikeDraftState: null }))
  await page.getByRole('button', { name: '继续本回合' }).click()
  await page.waitForFunction(() => window.replays.length === 1)
  assert.equal(await page.locator('[data-chat-flow-kind="turn-error"]').count(), 0)
  assert.equal(await page.locator('#player-input').inputValue(), '尚未发送的新行动')
  assert.deepEqual(await page.evaluate(() => window.calls), [])
  await page.evaluate(() => window.show({canReplayFailedTurn:false}))
  await page.waitForFunction(() => !document.querySelector('button'))
})
test('不可恢复的已有草稿显示原因，不能降级成丢弃草稿重生成；运行时隐藏入口', config, async t => {
  const page = await fixture(t)
  await page.evaluate(() => {window.savedDraft.resumable=false})
  await page.getByRole('button', { name: '继续本回合' }).click()
  await page.getByRole('alert').waitFor()
  assert.match(await page.getByRole('alert').textContent(), /暂时不可继续/)
  assert.equal(await page.evaluate(() => window.replays.length), 0)
  assert.equal(await page.evaluate(() => window.calls.filter(c=>c.method==='resumeDreamSikeDraft').length), 0)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth<=window.innerWidth), true)
  await page.evaluate(() => window.show({},true))
  await page.waitForFunction(() => !document.querySelector('button'))
})
