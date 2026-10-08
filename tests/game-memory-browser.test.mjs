import test from 'node:test'
import { runGameMemoryBrowserSmoke } from './browser/game-memory-browser-smoke.mjs'

test('本局记忆实际 React 界面：分页、中文搜索、session 竞争和窄屏', { timeout: 45000 }, async () => {
  const report = await runGameMemoryBrowserSmoke()
  console.log(JSON.stringify({ ok: report.ok, checks: report.checks, output: report.output }))
})
