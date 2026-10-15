import { readFile, mkdir, writeFile, copyFile, constants } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { inspectPreset } from '../tavern-plugin/lib/domain/preset-reading.js'
import { previewPresetConversion } from '../tavern-plugin/lib/domain/preset-conversion-preview.js'
import { compileHushenContract } from '../tavern-plugin/lib/domain/hushen-contract.js'
import { isHushenSource } from '../tavern-plugin/lib/domain/hushen-source.js'
import { readHushenCapabilities } from '../tavern-plugin/lib/domain/hushen-capabilities.js'
import { buildHushenAgentProfile, readHushenAgentRules } from '../tavern-plugin/lib/domain/hushen-agent-profile.js'

// Produce a local, reviewable bundle. Never execute imported scripts, contact a
// model, install runtime files, change defaults, or write to an existing game.
const args = process.argv.slice(2), options = {}
for (let index = 0; index < args.length; index += 2) {
  if (!['--source', '--out'].includes(args[index]) || !args[index + 1] || options[args[index]]) {
    throw new Error('用法：node bin/prepare-hushen-agent.mjs --source <原始JSON> --out <新输出目录>')
  }
  options[args[index]] = path.resolve(args[index + 1])
}
if (!options['--source'] || !options['--out']) throw new Error('--source 与 --out 必填')
const sourcePath = options['--source'], out = options['--out']
const bytes = await readFile(sourcePath), text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
const source = JSON.parse(text.replace(/^\uFEFF/, ''))
if (!isHushenSource(source)) throw new Error('来源缺少狐神抚作者标识，未生成替代文案')
const hash = value => createHash('sha256').update(value).digest('hex')
const sourceHash = hash(bytes), name = path.basename(sourcePath)
const compatibilityPreset = inspectPreset(text, name)
const preview = previewPresetConversion(text, name)
compatibilityPreset.dshPreset = preview.dshPreset
const snapshot = { presetName: name.replace(/\.json$/i, ''), presetPath: 'presets/' + name,
  compatibilityPreset, compatibilityPresetDocument: source,
  regexScripts: (source.extensions?.regex_scripts || []).filter(script => script.disabled !== true) }
for (const phase of ['front', 'middle', 'back']) snapshot[phase] = {
  entries: preview.phases[phase].filter(row => row.enabled && !row.marker && row.content.trim()).map(row => ({
    id: row.entryKey, name: row.name, role: row.role, content: row.content,
    source: { identifier: row.identifier, sourcePromptIndex: row.sourceIndex } }))
}
const compiled = compileHushenContract(snapshot), capabilities = readHushenCapabilities(snapshot, { manifestOnly: true })
const profile = buildHushenAgentProfile(snapshot)
const authorPage = readHushenAgentRules({ runtimePresetSnapshot: snapshot, cardName: '角色', macroState: { userName: '玩家' } })
const manifest = { version: 1, presetId: 'hushen-dsh', name: '狐神抚DSH',
  source: { file: 'original/' + name, sha256: sourceHash, bytes: bytes.length,
    prompts: source.prompts.length, orderEntries: compatibilityPreset.entries.filter(entry => entry.ordered).length,
    regexes: source.extensions?.regex_scripts?.length || 0 },
  execution: { tools: 'sike_*', draft: 'unique-per-turn', settlement: 'native-timeline-background',
    optionalSingleReply: true, deploysRuntime: false, changesDefaults: false },
  contract: compiled.agentContract,
  settingsCoverage: profile.coverage,
  authorRuleRead: { total: authorPage.total, firstPageCharacters: authorPage.characters,
    firstPageHasMore: authorPage.hasMore, digest: authorPage.digest,
    entries: authorPage.rules.map(({ identifier, sourceHash, resolvedHash, resolvedCharacters }) => ({ identifier, sourceHash, resolvedHash, resolvedCharacters })) },
  capabilities: { nativeCapabilities: capabilities.nativeCapabilities || [],
    modules: capabilities.modules.map(({ id, name, enabled, configured, compatibility, source }) => ({
      id, name, enabled, configured, compatibility, source: { scriptId: source.scriptId, scriptHash: source.scriptHash, line: source.line } })) },
  verification: { kind: 'static-source-compilation', scriptsExecuted: false, modelCalls: 0, liveCardAccepted: false } }
await mkdir(out) // An existing output directory is deliberately an error.
await mkdir(path.join(out, 'original'))
await copyFile(sourcePath, path.join(out, 'original', name), constants.COPYFILE_EXCL)
await writeFile(path.join(out, 'agent-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' })
await writeFile(path.join(out, 'README.md'), '# 狐神抚DSH 本地改造包\n\n'
  + '原文件位于 original，逐字节保留；源脚本没有执行。将该原文件通过 DSH 预设库导入，使用包含 hushen-dsh 功能的维护版本，在新局或空闲旧局选择“狐神抚DSH”。\n\n'
  + 'Agent 工作流在插件中编译，不需篡改作者原文。agent-manifest.json 记录逐条适配、源哈希和模块接入状态。旧狐忆数据库、狐裁控制器等未迁移能力以清单为准；该包不自动部署、切换当前局或修改新游戏默认值。\n', { encoding: 'utf8', flag: 'wx' })
if (hash(await readFile(sourcePath)) !== sourceHash || hash(await readFile(path.join(out, 'original', name))) !== sourceHash) {
  throw new Error('源文件在准备期间变化，请保留输出并复查')
}
console.log(JSON.stringify({ output: out, sourceSha256: sourceHash, originalUnchanged: true,
  promptCount: source.prompts.length, compiledEntries: compiled.agentContract.entries.length,
  regexCount: manifest.source.regexes, modelCalls: 0 }))
