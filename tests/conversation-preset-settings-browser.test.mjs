import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { browserReactScript } from './fixtures/browser-react.mjs'
import { conversationPresetSettings, updateConversationPresetSettings } from '../tavern-plugin/lib/domain/conversation-preset-settings.js'
import { presetFixture } from './conversation-preset-settings.test.mjs'

test('预设设置真实 React 界面保存下一回合配置、失败保留编辑；后台返回父会话', {
  skip: !process.env.TAVERN_BROWSER_TESTS, timeout: 30000
}, async t => {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch(process.platform === 'win32' ? { channel: 'msedge' } : {})
  t.after(() => browser.close())
  const page = await browser.newPage()
  let snapshot = presetFixture(), fail = false
  const calls = []
  await page.exposeFunction('testRpc', async (method, args, sessionId) => {
    calls.push({ method, args, sessionId })
    if (method === 'getConversationPresetSettings') return { settings: conversationPresetSettings(snapshot, 'dream-sike-dsh') }
    if (fail) throw Error('保存失败测试')
    snapshot = updateConversationPresetSettings(snapshot, args.changes, args.digest)
    return { settings: conversationPresetSettings(snapshot, 'dream-sike-dsh') }
  })
  await page.setContent('<div id="root"></div>')
  await page.addScriptTag({ content: await browserReactScript() + `
    const React=modules.react, rpc=window.testRpc;
    const liveTavernView={invalidate(){}},notifyTavernDataChanged=()=>{};
    const tavernErrorHub={report(source,error){throw error}};
    ${await readFile(new URL('../tavern-plugin/src/client/features/preset-settings.js', import.meta.url), 'utf8')}
    ${await readFile(new URL('../tavern-plugin/src/client/modules/opening-input.js', import.meta.url), 'utf8')}
    function OpeningEditor(){const[picker,setPicker]=React.useState({openings:[{id:'prepared'}],index:0,preparedInputId:'prepared',preparedInput:'卡片填入的开局'});return React.createElement(TavernOpeningInput,{picker,openingId:'prepared',onChange:text=>setPicker(current=>updateOpeningPickerInput(current,'prepared',text))})}
    modules['react-dom/client'].createRoot(document.getElementById('root')).render(React.createElement(React.Fragment,null,
      React.createElement(OpeningEditor),
      React.createElement(TavernPresetSettings,{sessionId:'foreground'}),
      React.createElement(TavernReturnToStory,{sessionId:'background',sessions:{subagentAddress:()=>({parentSessionId:'foreground'}),open(id){window.opened=id}}})))
  ` })
  await page.getByText('剧情理解与角色（0/1）', { exact: true }).click()
  assert.equal(await page.getByLabel('开局指令', { exact: true }).inputValue(), '卡片填入的开局')
  await page.getByLabel('开局指令', { exact: true }).fill('核对后修改的开局指令')
  assert.equal(await page.getByLabel('开局指令', { exact: true }).inputValue(), '核对后修改的开局指令')
  await page.getByText('角色分析 · 关闭', { exact: true }).click()
  await page.getByLabel('启用 角色分析', { exact: true }).check()
  await page.getByLabel('角色分析规则内容', { exact: true }).fill('根据角色知识边界与历史推演本回合')
  await page.getByRole('button', { name: '保存本局预设设置' }).click()
  await page.getByText('已保存到本局，从下一回合生效', { exact: true }).waitFor()
  assert.equal(snapshot.front.entries.find(entry => entry.id === 'entry-1').content, '根据角色知识边界与历史推演本回合')
  assert.equal(calls.at(-1).sessionId, 'foreground')
  fail = true
  await page.getByLabel('角色分析规则内容', { exact: true }).fill('新的本局规则')
  await page.getByRole('button', { name: '保存本局预设设置' }).click()
  await page.getByRole('alert').filter({ hasText: '保存失败测试' }).waitFor()
  assert.equal(await page.getByLabel('角色分析规则内容', { exact: true }).inputValue(), '新的本局规则')
  fail = false
  await page.getByRole('button', { name: '保存本局预设设置' }).click()
  await page.getByText('已保存到本局，从下一回合生效', { exact: true }).waitFor()
  await page.getByRole('button', { name: '返回剧情对话' }).click()
  assert.equal(await page.evaluate(() => window.opened), 'foreground')
})
