import { applyTavernHelperVariableMacros } from './tavern-helper-variable-macros.js'
import { applyTavernRegexText } from './tavern-regex-display.js'
import { compileSillyTavernRequest, createCleanCompatibilityPreset, postProcessSillyTavernMessages } from './sillytavern-compatibility.js'
import { composeTavernRegexScripts } from './card-extension-reading.js'
import { lastTavernHelperVariables } from './tavern-helper-context.js'
import { resolveRuntimeMacroText } from './runtime-content-projection.js'
import { activateWorldBook, promptOrder } from './worldbook-activation.js'
import { prepareTemplateWorldbook } from './worldbook-recall.js'
import { scriptPromptScanText } from './tavern-script-prompts.js'

export function createCompatibilityTurnCompiler({
  promptTemplateRuntime,
  readCardExtensions,
  readChatCard,
  readPromptTemplateGlobalVariables,
  resolveChatRuntimePreset,
  str,
  worldBooks,
}) {
  async function compatibilityWorldInfo(chat, card, input, runtime, globals) {
    let worldBook = null
    worldBook = await worldBooks.bound(chat.cardPath, card, chat)
    worldBook = await prepareTemplateWorldbook(worldBook, runtime, chat, globals)
    const entries = Array.isArray(worldBook && worldBook.view && worldBook.view.entries) ? worldBook.view.entries : []
    function promptTemplateSpecial(entry) {
      const comment = str(entry && entry.comment)
      const content = str(entry && entry.content)
      return comment.startsWith('[InitialVariables]') || /^(?:@@[^\r\n]*\r?\n)*@@initial_variables(?:\s|$)/m.test(content)
    }
    const enabled = entries.filter(function (entry) { return entry && entry.enabled !== false && str(entry.content).trim() !== '' })
    // Compatibility generation uses the shared local activation engine, without
    // the Agent's ten-turn recall cooldown or filtering out MVU update rules.
    const activation = activateWorldBook({ worldBook, entries: enabled.filter(entry => !promptTemplateSpecial(entry)),
      chat, card, userText: input, scanText: scriptPromptScanText(chat), isCoolingDown: () => false,
      activationRequests: worldBook?.templateActivationRequests || [] })
    const active = promptOrder(activation.entries)
    const before = []
    const after = []
    const depthInjections = [], exampleBefore = [], exampleAfter = [], diagnostics = []
    for (const entry of enabled) {
      const unsupported = ['sticky', 'cooldown', 'delay'].filter(key => Number(entry[key]) > 0)
      if (entry.probabilityEnabled !== false && Number(entry.probability ?? 100) !== 100) unsupported.push('probability')
      if (unsupported.length) diagnostics.push({ kind: 'worldbook-compatibility', code: 'unsupported-activation-fields', ref: entry.ref, fields: unsupported })
    }
    for (const entry of active) {
      const position = entry.position
      const content = str(entry.content).trim()
      if (position === 4 || position === 'at_depth') depthInjections.push({ content, depth: entry.depth ?? 4,
        role: ['system', 'user', 'assistant'].includes(entry.role) ? entry.role : ['system', 'user', 'assistant'][Number(entry.role) || 0] || 'system',
        order: 100, source: { kind: 'worldbook', ref: entry.ref } })
      else if (position === 5) exampleBefore.push(content)
      else if (position === 6) exampleAfter.push(content)
      else if (position === 2 || position === 3) {
        // ST attaches these to Author's Note. Preserve the depth seam when this
        // host has no separate Author's Note resource instead of moving to ↑/↓Char.
        depthInjections.push({ content, depth: chat.authorNoteDepth ?? 4, role: chat.authorNoteRole || 'system',
          order: 100, source: { kind: 'worldbook-author-note', ref: entry.ref } })
      } else if (position === 7) diagnostics.push({ kind: 'worldbook-compatibility', code: 'outlet-only', ref: entry.ref })
      else (position === 0 || position === 'before_char' || position === 'before' ? before : after).push(content)
    }
    return {
      before: before.join('\n\n'),
      after: after.join('\n\n'),
      refs: active.map(function (entry) { return entry.ref }),
      depthInjections, exampleBefore, exampleAfter, diagnostics, activation,
      templateScopes: worldBook?.templateScopes,
      entries: entries.map(function (entry) {
        return {
          id: str(entry.sourceUid ?? entry.ref),
          uid: entry.sourceUid ?? entry.ref,
          ref: entry.ref,
          world: str(worldBook && worldBook.view && worldBook.view.displayName),
          name: str(entry.title),
          comment: str(entry.comment),
          content: str(entry.content),
          enabled: entry.enabled !== false,
          book: str(worldBook && worldBook.view && worldBook.view.displayName)
        }
      })
    }
  }

  async function compileCompatibilityTurn(chat, userText, attachments = []) {
    const snapshot = await resolveChatRuntimePreset(chat)
    const macroState = { userName: chat.macroState?.userName,
      local: { ...chat.macroState?.local, ...snapshot?.sourceMacroOverrides?.local },
      global: { ...chat.macroState?.global, ...snapshot?.sourceMacroOverrides?.global } }
    chat = { ...chat, macroState }
    const presetPath = str(snapshot && snapshot.presetPath)
    const preset = presetPath === '' ? createCleanCompatibilityPreset() : snapshot.compatibilityPreset
    const presetDocument = presetPath === '' ? {} : snapshot.compatibilityPresetDocument
    if (!preset || preset.valid !== true || preset.recognized !== true || !presetDocument) throw new Error('当前预设不存在或无法读取：' + presetPath)
    const card = await readChatCard(chat)
    const extensions = await readCardExtensions(chat.cardPath, chat)
    const regexScripts = composeTavernRegexScripts(extensions, snapshot?.regexScripts)
    const promptTemplates = await promptTemplateRuntime(chat.sessionId)
    const globals = await readPromptTemplateGlobalVariables()
    const worldInfo = await compatibilityWorldInfo(chat, card, userText, promptTemplates, globals)
    const compiled = compileSillyTavernRequest({
      card,
      preset,
      presetPath,
      presetDocument,
      history: (chat.messages || []).map(function (item) { return { role: item.role, text: str(item.text), sourceText: str(item.sourceText), inputAttachments: item.inputAttachments } }),
      input: userText,
      inputAttachments: attachments,
      userName: str(chat.macroState && chat.macroState.userName),
      macroState: chat.macroState,
      worldInfoBefore: worldInfo.before,
      worldInfoAfter: worldInfo.after,
      depthInjections: [...worldInfo.depthInjections, ...(chat.tavernScriptPrompts || []).filter(prompt => prompt.position === 'in_chat')
        .map(prompt => ({ content: prompt.content, depth: prompt.depth, role: prompt.role, order: 100, source: { kind: 'helper-injection', id: prompt.id } }))],
      exampleBefore: worldInfo.exampleBefore,
      exampleAfter: worldInfo.exampleAfter,
      resolveMacros: resolveRuntimeMacroText,
      projectPromptText: function (text, context) {
        return applyTavernRegexText(text, regexScripts, {
          placement: context.placement,
          isMarkdown: false,
          isEdit: false,
          depth: context.depth
        })
      }
    })
    compiled.trace.worldBookRefs = worldInfo.refs
    compiled.trace.worldBookActivation = { settings: worldInfo.activation.settings, budget: worldInfo.activation.budget, diagnostics: worldInfo.activation.diagnostics }
    compiled.diagnostics.push(...worldInfo.diagnostics)
    compiled.trace.presetPath = presetPath
    compiled.trace.presetTitle = preset.title
    compiled.trace.presetMode = presetPath === '' ? 'builtin-clean' : 'external'
    compiled.trace.regexCount = regexScripts.length
    compiled.trace.generationOptions = compiled.generationOptions
    compiled.trace.sourceGenerationOptions = compiled.sourceGenerationOptions
    const helperMacros = applyTavernHelperVariableMacros(compiled.messages, {
      message: lastTavernHelperVariables(chat.messages),
      chat: chat.variables,
      character: extensions && extensions.variables,
      preset: snapshot && snapshot.variables,
      global: chat.macroState && chat.macroState.global
    })
    compiled.messages = helperMacros.messages
    compiled.trace.tavernHelperVariableMacroCount = helperMacros.replacements
    const transcript = (chat.messages || []).map(function (item) {
      return { role: item.role === 'user' ? 'user' : 'assistant', content: str(item.sourceText || item.text) }
    })
    const templateContext = {
      charName: str(card.name),
      userName: str(chat.macroState && chat.macroState.userName) || '你',
      runType: 'generate',
      transcript,
      worldBookEntries: worldInfo.entries,
      scopes: {
        global: globals,
        initial: chat.promptTemplateInitialVariables,
        local: chat.variables,
        message: lastTavernHelperVariables(chat.messages)
      }
    }
    if (worldInfo.templateScopes) templateContext.scopes = worldInfo.templateScopes
    const initialized = await promptTemplates.initializeVariables(worldInfo.entries, templateContext)
    const templated = await promptTemplates.renderMessages(compiled.messages, Object.assign({}, templateContext, { scopes: initialized.scopes }))
    compiled.messages = templated.messages
    compiled.promptTemplateState = {
      scopes: templated.scopes,
      persist: initialized.evaluated + templated.evaluated > 0
    }
    compiled.diagnostics.push(...initialized.diagnostics, ...templated.diagnostics)
    compiled.trace.promptTemplateEvaluations = initialized.evaluated + templated.evaluated
    compiled.trace.promptTemplateDiagnostics = initialized.diagnostics.length + templated.diagnostics.length
    const sourceMessageCount = compiled.messages.length
    if (chat.userProfileEnabled === true) {
      const preferenceText = str(chat.userProfileContextSnapshot)
      if (preferenceText !== '') {
        compiled.messages.unshift({
          role: 'system',
          content: preferenceText,
          source: { kind: 'dsh-user-profile', revision: Number(chat.userProfileRevision) || 0 }
        })
        compiled.trace.userProfileRevision = Number(chat.userProfileRevision) || 0
      }
    }
    compiled.trace.assistantPrefill = str(compiled.messages.findLast(message => message.source?.kind === 'assistant-prefill')?.content)
    compiled.messages = postProcessSillyTavernMessages(compiled.messages, presetDocument, {
      charName: str(card.name),
      userName: str(chat.macroState && chat.macroState.userName)
    })
    compiled.trace.postProcessing = str(presetDocument.custom_prompt_post_processing) || 'none'
    compiled.trace.squashSystemMessages = presetDocument.squash_system_messages === true
    compiled.trace.sourceMessageCount = sourceMessageCount
    compiled.trace.finalMessageCount = compiled.messages.length
    return compiled
  }
  return compileCompatibilityTurn
}
