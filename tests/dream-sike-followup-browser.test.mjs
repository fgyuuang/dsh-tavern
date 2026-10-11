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
  await page.goto('about:blank')
  await page.setContent('<div id="root"></div>')
  await page.addStyleTag({ content: await readFile(new URL('../tavern-plugin/lib/client-assets/tavern.css', import.meta.url), 'utf8') })
  const frames = await readFile(new URL('../tavern-plugin/src/client/ui/message-frame.js', import.meta.url), 'utf8')
  const projectionRenderer = frames.slice(frames.indexOf('function renderTavernProjection('), frames.indexOf('function TavernScriptLayerPart('))
  await page.addScriptTag({ content: await browserReactScript() + `
    const React=modules.react; window.calls=[];window.frames=[];window.invalidations=[];window.paths=[];
    let followup=null,latest=true,turn=2;
    const liveTavernView={getSnapshot:()=>({view:{dreamSikeFollowup:followup,tavernHelper:{revision:7},latestTurn:2}}),invalidate:id=>window.invalidations.push(id)};
    const useLiveTavernView=(id,revision,paths)=>{window.paths.push(paths);return liveTavernView.getSnapshot()};
    const tavernLatestProjectionTurn=view=>view.latestTurn;
    const rpc=async(method,args,id)=>{window.calls.push({method,args,id});if(window.delayRetry)return new Promise(resolve=>window.resolveRetry=resolve);if(window.failRetry)throw Error('请求失败');return {ok:true}};
    const projectionPartsOf=value=>value.parts||[{kind:'markdown',text:value.text}];
    const parseTavernInlineFragment=()=>false;
    const TavernColoredMarkdown=props=>React.createElement('p',null,props.text);
    const TavernMessageFrame=props=>{window.frames.push(props);return React.createElement('button',{'data-part-index':props.partIndex,onClick:()=>Promise.resolve(props.executeSlash('/setinput 下一步')).then(()=>{},error=>window.staleError=error.message)},'原始作者选项按钮')};
    ${projectionRenderer}
    ${await readFile(new URL('../tavern-plugin/src/client/features/dream-sike-followup.js', import.meta.url), 'utf8')}
    const root=modules['react-dom/client'].createRoot(document.getElementById('root'));
    window.show=(value=followup,isLatest=latest,storyTurn=turn)=>{followup=value;latest=isLatest;turn=storyTurn;root.render(React.createElement(React.Fragment,null,React.createElement('article',null,'唯一正式正文'),React.createElement(DreamSikeFollowup,{sessionId:'session',turn,latest,executeSlash:line=>window.calls.push({line}),trustedCardMode:true})))};
    window.show();
  ` })
  return page
}
const record = status => ({ turn: 2, key: 'body-2', revision: 1, status, error: status === 'failed' ? '模型断网' : '', projection: { parts: [{ kind: 'html', content: '<button>作者选项</button>' }] } })

test('后续面板分阶段显示，可收起且不改动正式正文', config, async t => {
  const page = await fixture(t)
  assert.equal(await page.getByRole('region', { name: '梦境后续互动' }).count(), 0)
  await page.evaluate(value => window.show(value), record('queued'))
  await page.getByText('正文已提交，等待变量结算后生成').waitFor()
  await page.evaluate(value => window.show(value), record('running'))
  await page.getByText('正文与结算已完成，正在生成后续互动').waitFor()
  await page.evaluate(value => window.show(value), record('done'))
  await page.getByRole('button', { name: '原始作者选项按钮' }).waitFor()
  assert.equal(await page.getByText('唯一正式正文', { exact: true }).count(), 1)
  assert.equal(await page.locator('[data-part-index]').getAttribute('data-part-index'), 'dream-followup:body-2:0')
  await page.getByRole('button', { name: '原始作者选项按钮' }).click()
  assert.deepEqual(await page.evaluate(() => window.calls), [{ line: '/setinput 下一步' }])
  assert.equal(await page.evaluate(() => window.frames.at(-1).scriptLayer), undefined)
  assert.equal(await page.evaluate(() => window.frames.at(-1).helperContextReader().revision), 7)
  await page.getByRole('button', { name: '后续互动 剧情共创与行动选项 ⌃' }).click()
  assert.equal(await page.getByRole('button', { name: '原始作者选项按钮' }).count(), 0)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
})

test('失败仅重试后续任务，错误可见，旧回合与过期按钮不可提交', config, async t => {
  const page = await fixture(t)
  await page.evaluate(value => { window.failRetry=true; window.show(value) }, record('failed'))
  await page.getByRole('button', { name: '重试后续互动' }).click()
  await page.getByText('请求失败', { exact: true }).waitFor()
  assert.deepEqual(await page.evaluate(() => window.calls[0]), { method: 'retryDreamSikeFollowup', args: { sessionId: 'session', key: 'body-2', turn: 2 }, id: 'session' })
  await page.evaluate(value => window.show(value,false), record('done'))
  await page.getByText('历史回合，仅供查看。').waitFor()
  assert.equal(await page.locator('[inert]').count(), 1)
  await page.evaluate(async () => {try{await window.frames.at(-1).executeSlash('/setinput 过期')}catch(error){window.staleError=error.message}})
  assert.match(await page.evaluate(() => window.staleError), /已过期/)
  await page.evaluate(value => window.show(value,true,3), record('done'))
  assert.equal(await page.getByRole('region', { name: '梦境后续互动' }).count(), 0)
})

test('重试的迟到响应不污染新回合', config, async t => {
  const page = await fixture(t)
  await page.evaluate(value => { window.delayRetry=true; window.show(value) }, record('failed'))
  await page.getByRole('button', { name: '重试后续互动' }).click()
  await page.getByRole('button', { name: '正在重试…' }).waitFor()
  await page.evaluate(value => window.show({ ...value, turn:3, key:'body-3' },true,3), record('done'))
  await page.getByRole('button', { name: '原始作者选项按钮' }).waitFor()
  await page.evaluate(() => window.resolveRetry({ ok:true }))
  assert.deepEqual(await page.evaluate(() => window.invalidations), [])
  assert.equal(await page.getByText('唯一正式正文', { exact: true }).count(), 1)
})
