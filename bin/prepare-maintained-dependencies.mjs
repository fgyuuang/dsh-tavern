import { spawn } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [phase, app, anchor, pnpm] = process.argv.slice(2)
if (!['prepare', 'relink'].includes(phase) || ![app, anchor, pnpm].every(value => value && path.isAbsolute(value))) throw Error('需要 prepare/relink 和三个绝对路径')
const offline = phase === 'relink'
async function run(_command, args, { cwd }) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [pnpm, ...args, ...(offline ? ['--offline'] : []), '--ignore-scripts', '--reporter=append-only'], {
      cwd, windowsHide: true, stdio: 'inherit', env: { ...process.env, CI: 'true', pnpm_config_update_notifier: 'false' }
    })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve() : reject(Error('维护版依赖安装失败：' + code)))
  })
}
await run('pnpm', ['install', '--frozen-lockfile'], { cwd: app })
// A clean release has no yaml dependency until the first install completes.
// Resolve this module from the prepared app, even when this helper is invoked
// from an otherwise dependency-free source archive.
const { installPluginDependencies } = await import(pathToFileURL(path.join(app, 'bin/plugin-dependencies.mjs')).href)
await installPluginDependencies({ pluginDirectory: path.join(app, 'tavern-plugin'), host: 'desktop',
  env: { ...process.env, DSH_TAVERN_HOST_DEPENDENCY_ANCHOR: anchor }, execPath: process.execPath, run })
await import(pathToFileURL(path.join(app, 'tavern-plugin/lib/index.js')).href)
console.log('维护版依赖与插件导入检查通过：' + phase)
