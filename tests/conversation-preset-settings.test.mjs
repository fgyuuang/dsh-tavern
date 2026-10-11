import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { conversationPresetSettings, updateConversationPresetSettings } from '../tavern-plugin/lib/domain/conversation-preset-settings.js'
import { compileDreamSikeContract } from '../tavern-plugin/lib/domain/dream-sike-contract.js'

export function presetFixture() {
  const entries = ['文风', '角色分析', '场景'].map((name, index) => ({ entryKey: 'entry-' + index, identifier: 'custom-' + index,
    name, content: name + '规则', role: 'system', injectable: true, ordered: true, enabled: index !== 1 }))
  const active = entries.filter(entry => entry.enabled).map(entry => ({ id: entry.entryKey, ...entry }))
  return { presetName: '验证预设', presetPath: 'presets/fixture.json', digest: 'original',
    front: { entries: active, text: '' }, middle: { entries: [], text: '' }, back: { entries: [], text: '' },
    compatibilityPreset: { entries, regexScripts: [] },
    compatibilityPresetDocument: { extensions: { regex_scripts: [
      { id: 'render', scriptName: '显示', findRegex: 'x', replaceString: 'y', placement: [2], markdownOnly: true, disabled: false },
      { id: 'request', scriptName: '请求', findRegex: 'a', replaceString: 'b', placement: [2], promptOnly: true, disabled: true }
    ], tavern_helper: { scripts: [{ type: 'script', name: '消息处理', enabled: true }, { type: 'script', name: '前缀适配', enabled: true, data: { enabled: false } }] } } },
    regexScripts: [{ id: 'render', regexKey: 'render#1', name: '显示', findRegex: 'x', replaceString: 'y', placement: [2], markdownOnly: true, enabled: true }]
  }
}
test('本局配置展示关闭的分析规则、原生正则和实际脚本内部开关', () => {
  const view = conversationPresetSettings(presetFixture(), 'dream-sike-dsh')
  assert.equal(view.entries.length, 3)
  assert.equal(view.entries[1].enabled, false)
  assert.equal(view.regexScripts.length, 2)
  assert.equal(view.regexScripts[1].enabled, false)
  assert.equal(view.helperScripts[1].configured, false)
  assert.match(view.helperScripts[0].execution, /Agent/)
})

const rpcSource = readFileSync(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
const rpcBody = rpcSource.split("case 'updateConversationPresetSettings': {")[1].split("case 'applyConversationPreset':")[0]
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const invoke = new AsyncFunction('args', 'str', 'chatForSession', 'groupOfMode', 'agentRegistry', 'backgroundTasks', 'tavernScriptDispatch',
  'replayFailedTurnActive', 'updateConversationPresetSettings', 'updateChat', 'conversationPresetSettings', '{' + rpcBody)
test('生产保存 RPC 只改本局快照，闲置限制和 CAS 阻止竞态，清理旧脚本', async () => {
  for (const failure of ['', 'busy', 'stale']) {
    let saved = { id: 'game', mode: 'story', _storageRevision: 3, playPresetId: 'dream-sike-dsh', runtimePresetSnapshot: presetFixture(),
      messages: [{ text: '已存在的历史' }], variables: { hp: 10 } }
    const before = structuredClone(saved)
    let disposed = 0
    const promise = invoke({ sessionId: 'front', digest: 'original', changes: { entries: [{ key: 'entry-1', enabled: true }], regexScripts: [] } }, String,
      async () => structuredClone(saved), () => 'play', new Map(), { activity: () => ({ busy: failure === 'busy' }) },
      { status: () => ({ busy: false }), dispose() { disposed++ } }, () => false, updateConversationPresetSettings,
      async (_id, updater) => { const copy = structuredClone(saved); if (failure === 'stale') copy._storageRevision++; saved = updater(copy); return saved }, conversationPresetSettings)
    if (failure) { await assert.rejects(promise, /等待|变化/); assert.deepEqual(saved, before); assert.equal(disposed, 0) }
    else {
      await promise; assert.equal(disposed, 1)
      assert.deepEqual(saved.messages, before.messages); assert.deepEqual(saved.variables, before.variables)
      assert.equal(conversationPresetSettings(saved.runtimePresetSnapshot).entries[1].enabled, true)
      assert.equal(saved.tavernHelperLifecycleRevision, 1)
    }
  }
})
test('本局规则与正则持久配置进入契约，二次保存保留前次设置，原件不变', () => {
  const source = presetFixture(), before = structuredClone(source)
  const first = updateConversationPresetSettings(source, { entries: [{ key: 'entry-1', enabled: true, content: '按角色认知推演事件' }],
    regexScripts: [{ key: 'request#1', enabled: true }] }, source.digest)
  assert.deepEqual(source, before)
  assert.match(compileDreamSikeContract(first).text, /按角色认知推演事件/)
  assert.equal(first.regexScripts.length, 2)
  const second = updateConversationPresetSettings(first, { entries: [{ key: 'entry-0', enabled: false }], regexScripts: [] }, first.digest)
  assert.equal(conversationPresetSettings(second).entries[0].enabled, false)
  assert.equal(conversationPresetSettings(second).entries[1].enabled, true)
  assert.equal(second.regexScripts.length, 2)
  assert.doesNotMatch(compileDreamSikeContract(second).text, /文风规则/)
})
test('失效版本、未知项目、重复项目和无效内容拒绝保存', () => {
  const source = presetFixture()
  assert.throws(() => updateConversationPresetSettings(source, { entries: [], regexScripts: [] }, 'stale'), /变化/)
  for (const entries of [[{ key: '__proto__', enabled: true }], [{ key: 'entry-0', enabled: true }, { key: 'entry-0', enabled: false }],
    [{ key: 'entry-0', enabled: true, content: 1 }]]) {
    assert.throws(() => updateConversationPresetSettings(source, { entries, regexScripts: [] }, source.digest), /格式|未知|重复/)
  }
})
