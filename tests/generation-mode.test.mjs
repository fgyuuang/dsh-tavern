import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { normalizeGenerationMode, isSingleReplyMode, isDreamSikeAgentExecution, selectGenerationMode } from '../tavern-plugin/lib/domain/generation-mode.js'
import { initializationFixture } from './fixtures/conversation-initialization.mjs'

test('reply execution is independent of the author preset and defaults to Agent', () => {
  assert.equal(normalizeGenerationMode(undefined), 'agent')
  assert.equal(normalizeGenerationMode('unknown'), 'agent')
  assert.equal(normalizeGenerationMode('sillytavern-once'), 'sillytavern-once')
  assert.equal(isSingleReplyMode({ mode: 'card', generationMode: 'sillytavern-once' }), false)
  assert.equal(isDreamSikeAgentExecution({ playPresetId: 'dream-sike-dsh', mode: 'story' }), true)
  assert.equal(isDreamSikeAgentExecution({ playPresetId: 'dream-sike-dsh', mode: 'story', generationMode: 'sillytavern-once' }), false)
  assert.equal(isSingleReplyMode({ playPresetId: 'tavern', generationMode: 'sillytavern-once' }), true)
})

test('switching and returning preserve source options, scripts, variables, history and saved drafts', () => {
  const chat = { id: 'game', mode: 'story', _storageRevision: 7, playPresetId: 'dream-sike-dsh',
    tavernHelperLifecycleRevision: 3, runtimePresetPath: 'presets/author.json',
    runtimePresetSnapshot: { digest: 'author', front: { entries: [{ id: 'style', content: 'Original author text' }] },
      compatibilityPresetDocument: { extensions: { tavern_helper: { scripts: [{ enabled: true, content: 'original()' }] } } } },
    playPresetConfigurations: { tavern: { runtimePresetSnapshot: { digest: 'other' } } },
    dreamSikeDraft: { version: 2, text: 'draft' }, dreamSikeResume: { failedTurn: 3 }, variables: { counter: 4 }, messages: [{ role: 'assistant', text: 'history' }] }
  const original = structuredClone(chat)
  const readiness = { foregroundIdle: true, backgroundIdle: true, replayIdle: true }
  const change = selectGenerationMode(chat, 'sillytavern-once', readiness)
  assert.deepEqual(chat, original)
  assert.equal(change.expectedChatId, 'game')
  assert.equal(change.expectedStorageRevision, 7)
  assert.deepEqual(Object.keys(change.patch).sort(), ['dreamSikeResume', 'generationMode', 'generationModeRevision', 'playPresetSettingsIndependent', 'tavernHelperLifecycleRevision'])
  assert.equal(change.patch.playPresetSettingsIndependent, true)
  Object.assign(chat, change.patch)
  assert.equal(chat.generationMode, 'sillytavern-once')
  assert.equal(chat.tavernHelperLifecycleRevision, 4)
  assert.equal(chat.dreamSikeResume, null)
  assert.deepEqual(selectGenerationMode(chat, 'sillytavern-once', readiness).patch, {})
  Object.assign(chat, selectGenerationMode(chat, 'agent', readiness).patch)
  for (const field of ['playPresetId', 'runtimePresetPath', 'runtimePresetSnapshot', 'playPresetConfigurations', 'dreamSikeDraft', 'variables', 'messages']) {
    assert.deepEqual(chat[field], original[field])
  }
  assert.equal(chat.generationModeRevision, 2)
  assert.equal(chat.tavernHelperLifecycleRevision, 5)
})

test('mode switching rejects busy and unsupported targets without touching the source', () => {
  const ready = { foregroundIdle: true, backgroundIdle: true, replayIdle: true }
  for (const readiness of [{}, { ...ready, foregroundIdle: false }, { ...ready, backgroundIdle: false }, { ...ready, replayIdle: false }]) {
    assert.throws(() => selectGenerationMode({ mode: 'story' }, 'sillytavern-once', readiness), /等待/)
  }
  assert.throws(() => selectGenerationMode({ mode: 'card' }, 'sillytavern-once', ready), /游玩/)
  assert.throws(() => selectGenerationMode({ mode: 'story' }, 'invalid', ready), /未知/)
})

test('a new single reply game retains the selected source, and reentry retains its execution mode', async () => {
  const source = { presetPath: 'presets/author.json', presetName: 'Author', regexScripts: [], customOption: true }
  const fixture = initializationFixture({ presets: { fullSnapshotForPlayPreset: async () => structuredClone(source) } })
  const game = await fixture.make().start({ ...fixture.input, playPresetId: 'dream-sike-dsh', generationMode: 'sillytavern-once' })
  assert.equal(game.requestMode, 'dsh')
  assert.equal(game.playPresetId, 'dream-sike-dsh')
  assert.equal(game.generationMode, 'sillytavern-once')
  assert.deepEqual(game.runtimePresetSnapshot, source)
  const reopened = await fixture.make().start({ ...fixture.input, generationMode: 'agent' })
  assert.equal(reopened.generationMode, 'sillytavern-once')
  assert.deepEqual(reopened.runtimePresetSnapshot, source)
  const another = await fixture.make().start({ ...fixture.input, sessionId: 'another' })
  assert.equal(another.generationMode, 'agent')
})

test('launch retries preserve the selected execution mode and opposite modes create separate games', async () => {
  const source = await readFile(new URL('../tavern-plugin/src/client/runtime/conversation-lifecycle.js', import.meta.url), 'utf8')
  const context = vm.createContext({ console })
  vm.runInContext(source + '\nthis.createLifecycle = createConversationLifecycleModule;', context)
  const attempts = new Map(), created = []
  let fail = true, session = 0
  const lifecycle = context.createLifecycle({ attempts,
    archiveCurrent: async () => {}, resolveWorkspace: async () => 'workspace',
    connectWorkspace: async () => 'session-' + (++session), waitForSession: async () => {},
    ensurePreset: async () => {}, createChat: async request => {
      created.push(request.generationMode)
      if (fail) { fail = false; throw new Error('temporary') }
    }, rememberPending: () => {}, finishOpen: async () => {}
  })
  const launch = generationMode => lifecycle.start({ kind: 'play', targetMode: 'story', card: { path: 'card' }, playPresetId: 'dream-sike-dsh', generationMode })
  await assert.rejects(launch('sillytavern-once'), /temporary/)
  assert.equal([...attempts.values()][0].generationMode, 'sillytavern-once')
  await launch('sillytavern-once')
  await launch('agent')
  assert.deepEqual(created, ['sillytavern-once', 'sillytavern-once', 'agent'])
  assert.equal(session, 2)
})
