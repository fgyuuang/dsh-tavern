// Immutable identifiers from the user's V19.7.3 source; no authored prompt bodies.
import { resolveRuntimePresetMacros } from './runtime-presets.js'

export const HUSHEN_PRESET_ID = 'hushen-dsh'
export const HUSHEN_IDS = Object.freeze({
  "random": "237926d9-4a99-4802-8571-aa7fb1b5c9ad",
  "initialize": "a00fb1fe-9907-4709-b230-43ae0d236529",
  "mvuExternal": "281906e8-523d-4684-93c3-3341dcc94cc8",
  "statusPanel": "c479d5cd-3b6d-4cef-99b3-eaee9eecbd42",
  "mvuInline": "1128f30b-87c0-4fb2-8e31-e39b5dce3bf8",
  "mvuCustom": "03a46969-3dc3-4169-92e8-51ea60f46f55",
  "image": "7f73104d-56ee-4f70-9274-b64a915e46a1",
  "decentralizePlayer": "a8dab467-b628-4522-b9dc-10a4dfae7e16",
  "commentary": "48863da8-9556-4f14-b5bf-1816e4d4207b",
  "actions": "046af93d-0c63-4561-b0b2-052cd265fecd",
  "draftParagraph": "6e42794b-2c68-4a6a-a7ff-cde439117edf",
  "draftFull": "4d0eeee3-e95c-4971-9e48-8ff1ed57790b",
  "outline": "198eb649-8237-4629-b0d3-d0e534ffff0a",
  "frontend": "7f2d95bf-9ed9-403d-9247-0df4fe9fc94f",
  "bodyTag": "9b2200d1-e8d6-4be5-9850-80a3102bc018",
  "sceneClock": "cb2d2f0a-35a7-470a-a940-6b3a264ef18d",
  "summary": "3867af9e-9bad-4fdf-9ef8-83ca07d8c68e",
  "paraphraseDirect": "4f61e589-c05e-4e14-a660-26a876782a60",
  "paraphraseSegmented": "698ff428-578f-4196-a759-566408d31272",
  "paraphraseNone": "ed3b6119-cb78-47b4-beab-6d109beb9e38",
  "agencyFull": "eea28e30-4e6e-47a7-812a-8ad148a69969",
  "agencyNormal": "abfb6591-5493-4cc1-aede-229c26027ff8",
  "agencyDialogue": "43c7b131-93e3-40b9-ab80-d1e596f8c10a",
  "agencyNone": "630b20d3-2d85-4b20-85ce-cc5e483e14b8",
  "styleRealism": "d6292de5-e1a1-4f94-93eb-bda00453020c",
  "chainCharacters": "3bc2611f-4370-492c-9f4f-14601a6558c7",
  "chainDirector": "1eb0b72d-e4f0-4507-b18d-d44ef51d5af6",
  "chainNatural": "475e4fe5-eac9-4347-8be9-d3b05732f5f2",
  "chainFox": "42303fec-82ae-4ec4-96a8-4cd424d782e5",
  "chainWorldbook": "d4e26531-a99a-47b8-9629-89e6d4b89dfd",
  "chainNovel": "8334f7d4-8470-4038-b034-786667e90b58",
  "chainCustom": "bd0cd878-4443-478e-a27d-02d7e91773cc",
  "chainNone": "7406460f-7ee2-43cf-8a88-f1eb4302b4f2",
  "effortDefault": "2a7e29d8-0162-4a68-a733-68914349f121",
  "effortHigh": "1d72c92b-3aa8-43f3-b9ad-69509ac08d28",
  "effortMedium": "3f087674-153f-42e7-aa25-bafab147f1e9",
  "effortLow": "72a4289f-5e61-4c3e-8577-fd00ca52ed6b",
  "formatFox": "38c27ac7-27d9-4201-848a-eb2040da87cb",
  "formatShort": "6b19605f-010e-40cf-b695-270a60177a28",
  "formatContext": "f4a9dcbf-91e6-4a1d-ad70-f5697e5d8fe6",
  "formatDefault": "d363c7c0-1771-45be-94e4-5c097220f101",
  "formatDialogue": "1747693b-1d34-455e-aedb-6a4fc03080b4",
  "lengthSmart": "4d12676f-7055-45b8-96be-706c7f714969",
  "lengthMicro": "7d4666be-5f94-45e4-8a40-7740918e65ec",
  "lengthShort": "3414690d-9045-47aa-94bc-96847390c900",
  "lengthMedium": "e64c6833-a29e-476c-b2b1-db0dd452778e",
  "lengthLong": "39b5cf79-dd5e-4dfb-846d-58d842d5bb50",
  "lengthEpic": "e0ef4386-3784-4076-bda2-3f2378b0510e",
  "lengthCustom": "50d6bafe-9b0a-4138-8c8e-aef27b506d26",
  "styleCustom": "05bc6f39-d186-4535-9266-d1e9abb74102",
  "baseRequirements": "jailbreak",
  "contextStart": "2f2729f4-5d93-4268-a242-165a9c894e60",
  "novelText": "4f7d0be4-939b-47e3-af19-62f460a66427",
  "historySummary": "1f2c1af6-cd5d-4416-b990-cf84d67c4854",
  "contextEnd": "e8a8bf57-2573-4130-a000-ee7b9ad49b41",
  "preferencesStart": "8945b7fc-70f3-41d9-842f-3daa7795f858",
  "preferencesTone": "3422ec86-2a1c-454e-9fdc-11d895bbd744",
  "preferencesStyle": "c7ddbd17-f4d0-4a77-8c11-190082481ab0",
  "preferencesPace": "dea9c60f-0317-497e-8dc4-868befa6ccb2",
  "preferencesCharacters": "a50140be-6399-4454-9926-79ec233da2f9",
  "preferencesTheme": "f16d756e-e34a-4043-87e0-e9bb26b110a7",
  "preferencesInteraction": "238a199b-1ebb-4b0c-9941-5a604c098e56",
  "preferencesWorld": "7f8fcef1-8385-41ba-a963-fe57bed0c3d4",
  "preferencesAvoid": "1455cd12-2848-47b3-a4d1-539f042cd392",
  "preferencesAvatar": "d26954c8-4cdc-42e4-a551-98e4a34a30ce",
  "preferencesEnd": "ca9630f4-b212-4810-ad8e-bef8fb03d612",
  "nativePlanningSlot": "daedd89f-2643-4688-8018-30bf61295b12",
  "preOutputCheck": "7a3c853f-88ff-48ff-8c6a-020d9bbeb3d8",
  "extraStart": "2af310ac-ec8a-449d-b2fc-7e890150729f",
  "searchResults": "charPersonality",
  "searchEnd": "dbea3248-2abc-4fdb-b486-016ba58ce0d8",
  "novelStyle": "0bade50a-c5d6-43ee-a59d-17d910b4554b",
  "novelDetails": "41734733-d160-4b8c-975b-7cec7842b59b",
  "novelCharacters": "03f71f4b-b156-46e5-a1e2-7ce5e7b71337",
  "novelWorkflow": "2101bbc3-3edf-4e18-aaa8-b691198cfdbe",
  "novelPolish": "78a2bec3-0f3a-49cc-94f6-5a697a87656f",
  "legacyMemory": "a765deed-a057-436a-9239-a7863f87460a",
  "outlineMaterial": "bb070488-18e3-411f-b8c8-58c58a944342",
  "longTermCorrections": "f6dd0866-519c-4ce1-a389-f1eca01a45c4",
  "longTermLikes": "0bd07884-8289-453d-a1e8-f3e57dd15094",
  "extraEnd": "5bdc640c-ef58-4bcb-9113-cc7f19179a19",
  "latestRequest": "b316b983-fea0-4252-a37b-a0667af95e92",
  "prefillThinking": "8b7ac605-f910-4ad9-9dd8-51004b464fab",
  "prefillDirect": "24f365ac-10a4-4dc8-b102-1b0e34e6e02a",
  "prefillNative": "a41ca26c-2873-458e-8a25-ce735d73e21e",
  "prefillUser": "64e85203-8b52-4538-ab1a-55207dc2da2a",
  "transportWorkaround": "70f4b19a-fc29-4d2a-9a93-6c9175048283",
  "noTruncation": "d6b4f6ab-db6a-49cc-8803-0ed18be4c077",
  "versionMetadata": "6fd22f5b-553e-4951-a3ee-c600b2a26348",
  "settingsMetadata": "SPresetSettings",
  "unOrderedPolicyText": "86eb6e46-a8fe-4f46-a7a7-5ad69ef416be"
})

export const HUSHEN_CHAIN_IDS = Object.freeze(['chainCharacters', 'chainDirector', 'chainNatural', 'chainFox', 'chainWorldbook', 'chainNovel', 'chainCustom', 'chainNone'].map(key => HUSHEN_IDS[key]))
export const HUSHEN_PREFILL_IDS = Object.freeze(['prefillThinking', 'prefillDirect', 'prefillNative', 'prefillUser'].map(key => HUSHEN_IDS[key]))
export const HUSHEN_DYNAMIC_IDS = Object.freeze(['novelText', 'historySummary', 'preferencesTone', 'preferencesStyle', 'preferencesPace', 'preferencesCharacters', 'preferencesTheme', 'preferencesInteraction', 'preferencesWorld', 'preferencesAvoid', 'preferencesAvatar', 'nativePlanningSlot', 'searchResults', 'novelStyle', 'novelDetails', 'novelCharacters', 'novelWorkflow', 'novelPolish', 'legacyMemory', 'outlineMaterial', 'longTermCorrections', 'longTermLikes'].map(key => HUSHEN_IDS[key]))
export const HUSHEN_BOUNDARY_IDS = Object.freeze(['contextStart', 'contextEnd', 'preferencesStart', 'preferencesEnd', 'extraStart', 'extraEnd'].map(key => HUSHEN_IDS[key]))
export const HUSHEN_ARCHIVE_IDS = Object.freeze(['transportWorkaround', 'noTruncation', 'versionMetadata', 'settingsMetadata', 'unOrderedPolicyText'].map(key => HUSHEN_IDS[key]))

export const HUSHEN_REVIEW_AXES = Object.freeze(['character', 'knowledge', 'style', 'continuity', 'playerAgency', 'format'])
export const HUSHEN_PHASES = Object.freeze(['front', 'middle', 'back'])
export const hushenIdentifier = entry => String(entry?.source?.identifier || entry?.identifier || entry?.id || entry?.entryKey || '').replace(/#\d+$/, '')

export function hushenSourceDocument(snapshot) {
  const document = snapshot?.compatibilityPresetDocument || snapshot
  return document?.preset || document || {}
}

export function isHushenSource(snapshot) {
  const source = hushenSourceDocument(snapshot)
  const identifiers = new Set([
    ...(source?.prompts || []).map(entry => entry.identifier),
    ...(snapshot?.compatibilityPreset?.entries || []).map(hushenIdentifier),
    ...HUSHEN_PHASES.flatMap(phase => (snapshot?.[phase]?.entries || []).map(hushenIdentifier))
  ])
  return identifiers.has(HUSHEN_IDS.initialize) && identifiers.has(HUSHEN_IDS.baseRequirements)
    && identifiers.has(HUSHEN_IDS.preOutputCheck)
}

export function isHushenAgentExecution(chat) {
  return chat?.playPresetId === HUSHEN_PRESET_ID && chat?.generationMode !== 'sillytavern-once'
    && ['story', 'script'].includes(chat.mode || 'story')
}

const stageMap = new Map([
  ...HUSHEN_CHAIN_IDS.map(id => [id, 'planning']),
  ...['effortDefault', 'effortHigh', 'effortMedium', 'effortLow', 'preOutputCheck'].map(key => [HUSHEN_IDS[key], 'planning']),
  ...['draftParagraph', 'draftFull', 'styleCustom'].map(key => [HUSHEN_IDS[key], 'review-state']),
  ...['mvuExternal', 'statusPanel', 'mvuInline', 'mvuCustom'].map(key => [HUSHEN_IDS[key], 'review-state']),
  ...['commentary', 'actions', 'outline', 'frontend', 'summary', 'image'].map(key => [HUSHEN_IDS[key], 'interaction']),
  ...HUSHEN_DYNAMIC_IDS.map(id => [id, 'memory-materials']),
  ...HUSHEN_PREFILL_IDS.map(id => [id, 'model']),
  ...['random', 'initialize', 'versionMetadata', 'settingsMetadata', 'unOrderedPolicyText'].map(key => [HUSHEN_IDS[key], 'model'])
])

export function hushenStageForIdentifier(id) {
  return stageMap.get(id) || 'narration'
}

/** Only reset macros owned by this source, never card variables or unrelated global state. */
export function hushenOwnedMacroKeys(snapshot) {
  const source = hushenSourceDocument(snapshot)
  const entries = Array.isArray(source?.prompts) ? source.prompts
    : HUSHEN_PHASES.flatMap(phase => snapshot?.[phase]?.entries || [])
  const local = new Set(['quuserzhongxin', 'hugou', 'huying', 'kill1', 'extra']), global = new Set()
  for (const entry of entries) {
    // Only original prompt strings are scanned. Script/config blobs are not executable macros.
    if (HUSHEN_ARCHIVE_IDS.includes(hushenIdentifier(entry))) continue
    for (const match of String(entry.content || '').matchAll(/{{\s*(setvar|getvar|addvar|setglobalvar|getglobalvar)\s*::\s*([^:{}]+)/g)) {
      const name = match[2].trim()
      if (name && !['__proto__', 'prototype', 'constructor'].includes(name)) (match[1].includes('global') ? global : local).add(name)
    }
  }
  return { local: [...local].sort(), global: [...global].sort() }
}

export function hushenMacroContext(snapshot, context = {}) {
  const keys = hushenOwnedMacroKeys(snapshot)
  const local = { ...(context.macroState?.local || {}) }, global = { ...(context.macroState?.global || {}) }
  keys.local.forEach(key => { local[key] = '' })
  keys.global.forEach(key => { global[key] = '' })
  return { ...context, macroState: { ...(context.macroState || {}), local, global } }
}

export function resolveHushenPresetMacros(snapshot, context = {}) {
  return resolveRuntimePresetMacros(snapshot, hushenMacroContext(snapshot, context))
}
