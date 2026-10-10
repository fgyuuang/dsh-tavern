import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import {
  BASE_PLAY_PRESET,
  DREAM_SIKE_AGENT_PRESET,
  listPlayPresets,
  projectPlayPresetSnapshot,
  resolvePlayPresetRuntime,
  resolvePresetHelperScripts,
  selectPlayPreset,
  setDefaultPlayPreset
} from '../tavern-plugin/lib/domain/dream-sike-mode.js'
import { projectTavernHelperScripts } from '../tavern-plugin/lib/domain/tavern-helper-scripts.js'

test('native Dream Sike persona declares the fields required by the installed DSH loader', async () => {
  const preset = await readFile(new URL('../presets/dream-sike-dsh/agent.cordis.yml', import.meta.url), 'utf8')
  assert.match(preset, /name: '@deepseek-ai\/dsh-persona'[\s\S]*?\n    prefix: \|/)
  assert.match(preset, /\n    suffix: ''/)
})

test('switching a play chat returns a revisioned patch without changing its history', () => {
  const chat = { id: 'chat-1', mode: 'story', _storageRevision: 7, runtimePresetPath: 'presets/old.json', messages: [{ text: 'existing' }], tavernHelperLifecycleRevision: 2 }
  const result = selectPlayPreset(chat, DREAM_SIKE_AGENT_PRESET, { foregroundIdle: true, backgroundIdle: true })
  assert.equal(result.expectedStorageRevision, 7)
  assert.deepEqual(result.patch, { playPresetId: DREAM_SIKE_AGENT_PRESET, playPresetRevision: 1, tavernHelperLifecycleRevision: 3 })
  assert.equal(chat.messages[0].text, 'existing')
  assert.equal(chat.runtimePresetPath, 'presets/old.json')
  assert.throws(() => selectPlayPreset(chat, DREAM_SIKE_AGENT_PRESET, { foregroundIdle: false, backgroundIdle: true }), /等待/)
  assert.throws(() => selectPlayPreset({ ...chat, mode: 'card' }, DREAM_SIKE_AGENT_PRESET, { foregroundIdle: true, backgroundIdle: true }), /游玩/)
})

test('Agent mode preserves imported writing rules with a versioned contract and regex source', () => {
  const original = { presetPath: 'presets/old.json', digest: 'old', front: { entries: [{ content: 'old prompt' }], text: 'old prompt' }, regexScripts: [{ id: 'display-rule' }] }
  const projected = projectPlayPresetSnapshot(original, DREAM_SIKE_AGENT_PRESET)
  assert.equal(projected.front.text, 'old prompt')
  assert.equal(projected.text, 'old prompt')
  assert.equal(projected.agentContract.version, 2)
  assert.equal(projected.agentContract.entries[0].action, 'preserved')
  assert.deepEqual(projected.regexScripts, original.regexScripts)
  assert.equal(projected.presetPath, original.presetPath)
  assert.equal(original.front.text, 'old prompt')
  assert.equal(projectPlayPresetSnapshot(original, BASE_PLAY_PRESET), original)
  assert.equal(resolvePlayPresetRuntime({ playPresetId: DREAM_SIKE_AGENT_PRESET, runtimePresetSnapshot: original }).helperScriptPolicy, 'card-and-agent')
})

test('the default is separate from the active chat selection', () => {
  const settings = { defaultPlayPresetId: BASE_PLAY_PRESET }
  assert.deepEqual(setDefaultPlayPreset(settings, DREAM_SIKE_AGENT_PRESET), { defaultPlayPresetId: DREAM_SIKE_AGENT_PRESET })
  assert.equal(settings.defaultPlayPresetId, BASE_PLAY_PRESET)
  const rows = listPlayPresets({ chat: { playPresetId: DREAM_SIKE_AGENT_PRESET }, settings, legacyPresetTitle: '梦鲸思客V4-0915' })
  assert.equal(rows[0].name, '梦鲸思客V4-0915')
  assert.equal(rows[0].isDefault, true)
  assert.equal(rows[1].selected, true)
})

test('switching modes changes preset script ownership without changing card scripts', () => {
  const snapshot = { presetPath: 'presets/old.json', compatibilityPresetDocument: { extensions: { tavern_helper: { scripts: [
    { id: 'one', name: 'enabled', type: 'script', content: 'run()', enabled: true },
    { id: 'two', name: 'disabled', type: 'script', content: 'skip()', enabled: false }
  ] } } } }
  assert.deepEqual(resolvePresetHelperScripts(snapshot, DREAM_SIKE_AGENT_PRESET), [])
  const ids = resolvePresetHelperScripts(snapshot, BASE_PLAY_PRESET).map(script => script.id)
  assert.equal(ids.length, 1)
  assert.match(ids[0], /^preset-[a-f0-9]{16}-one$/)
  assert.equal(resolvePresetHelperScripts(snapshot, BASE_PLAY_PRESET)[0].sourceId, 'one')
  assert.equal(resolvePlayPresetRuntime({ playPresetId: BASE_PLAY_PRESET, runtimePresetSnapshot: snapshot }).presetHelperScripts[0].owner, 'preset:presets/old.json')
})

test('card scripts survive mode switches while each imported preset owns only its active scripts', () => {
  const card = [{ id: 'shared-id', name: 'card script', type: 'script', enabled: true, content: 'card()' }]
  const snapshot = (path, content) => ({ presetPath: path, compatibilityPresetDocument: { extensions: { tavern_helper: { scripts: [
    { id: 'shared-id', name: 'preset script', type: 'script', enabled: true, content }
  ] } } } })
  const first = snapshot('presets/first.json', 'first()')
  const second = snapshot('presets/second.json', 'second()')
  const ids = (preset, mode) => projectTavernHelperScripts([...card, ...resolvePresetHelperScripts(preset, mode)]).scripts.map(script => script.id)
  const originalIds = ids(first, BASE_PLAY_PRESET)
  const agentIds = ids(first, DREAM_SIKE_AGENT_PRESET)
  const nextIds = ids(second, BASE_PLAY_PRESET)
  assert.equal(originalIds.length, 2)
  assert.equal(new Set(originalIds).size, 2)
  assert.deepEqual(agentIds, ['shared-id'])
  assert.equal(nextIds.length, 2)
  assert.equal(nextIds[0], 'shared-id')
  assert.notEqual(nextIds[1], originalIds[1])
})
