[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$InstallationRoot = 'D:\pro\DSH-Tavern',
    [Parameter(Mandatory = $true)][string]$RuntimeRoot
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$utf8 = [System.Text.UTF8Encoding]::new($false)
$cmp = [StringComparison]::OrdinalIgnoreCase
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$install = (Resolve-Path -LiteralPath $InstallationRoot).Path.TrimEnd('\')
function Contained([string]$relative) {
    if (-not $relative -or $relative -match '(^|/)\.\.?(/|$)|[\\:\r\n]' -or $relative.StartsWith('/')) { throw '相对路径无效' }
    $full = [IO.Path]::GetFullPath((Join-Path $install $relative.Replace('/', '\')))
    if (-not $full.StartsWith($install + '\', $cmp)) { throw '目标路径越界' }
    $cursor = $full
    while ($cursor -and $cursor.StartsWith($install, $cmp)) {
        if ((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "拒绝重解析路径：$cursor" }
        $cursor = [IO.Path]::GetDirectoryName($cursor)
    }
    return $full
}
function Stopped {
    if (@(Get-NetTCPConnection -LocalPort 43120 -State Listen -ErrorAction SilentlyContinue | Where-Object { $null -ne $_ }).Count) { throw 'DSH 仍在监听，请结束当前回合并退出后部署' }
    if (@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($runtime + '\', $cmp) -and $_.CommandLine -and $_.CommandLine.IndexOf($app, $cmp) -ge 0 }).Count) { throw '本安装的宿主仍在运行' }
}
function RunNode([string[]]$arguments) { & $node @arguments; if ($LASTEXITCODE -ne 0) { throw "Node 操作失败：$($arguments[0])" } }
$runtime = [IO.Path]::GetFullPath($RuntimeRoot).TrimEnd('\')
if (-not $runtime.StartsWith($install + '\runtime-', $cmp)) { throw '宿主必须来自此安装的 runtime 目录' }
$app = Contained 'data/harness/apps/dsh-tavern'
$staging = Contained 'data/harness/apps/dsh-tavern.staging'
$previous = Contained 'data/harness/apps/dsh-tavern.previous'
$data = Contained 'data/harness/profile-data/tavern'
$profile = Contained 'data/harness/profiles/tavern'
$node = Contained 'data/updater-node/node.exe'
$anchor = Join-Path $runtime 'resources/app/package.json'
$pnpm = Join-Path $runtime 'resources/app/node_modules/pnpm/bin/pnpm.cjs'
$kernel = Get-Content -LiteralPath (Join-Path $runtime 'resources/app/node_modules/@deepseek-ai/dsh-agent-loop/package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($kernel.version -ne '0.1.5-rc.2') { throw '此发布只适配 DSH 0.1.5-rc.2' }
$sourceVersion = (Get-Content -LiteralPath (Join-Path $repo 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$installedVersion = (Get-Content -LiteralPath (Join-Path $app 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
if ($sourceVersion -ne '2.7.0' -or $installedVersion -notin @('2.5.0', '2.7.0')) { throw '版本不在本次迁移范围内' }
$branch = [string](& git -C $repo branch --show-current)
$head = [string](& git -C $repo rev-parse HEAD)
if ($branch -ne 'codex/upstream-v27-plugin-adaptation' -or $head -notmatch '^[a-f0-9]{40}$') { throw '请使用已审核的 2.7 适配分支' }
if (@(& git -C $repo status --porcelain --untracked-files=all -- bin config patches presets plugins tavern-plugin package.json pnpm-lock.yaml pnpm-workspace.yaml plugin.patch.yml cordis.patch.yml).Count) { throw '部署源有未提交变更' }
foreach ($path in @($staging, $previous)) { if (Test-Path -LiteralPath $path) { throw "发现待审查的旧部署目录，保留并停止：$path" } }
Stopped
$pluginTarget = Contained 'data/harness/profile-data/tavern/data/plugins/dsh-tavern-writing-presets'
if (Test-Path -LiteralPath $pluginTarget) { throw '持久预设插件已存在，需要单独审核升级，未覆盖' }
$backup = Contained ('temp/maintained-release-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N'))
Write-Output "维护版：$installedVersion -> $sourceVersion；提交：$head；DSH：$($kernel.version)"
Write-Output "程序、数据与回滚记录：$backup"
if (-not $PSCmdlet.ShouldProcess($install, '备份 Tavern 存档与配置，安装 2.7 维护版和持久预设插件')) { return }
New-Item -ItemType Directory -Path $backup | Out-Null
$archive = Join-Path $backup 'source.zip'
$source = Join-Path $backup 'source'
& git -C $repo archive --format=zip "--output=$archive" $head
if ($LASTEXITCODE -ne 0) { throw '源码归档失败' }
Expand-Archive -LiteralPath $archive -DestinationPath $source
$helper = Join-Path $source 'bin/prepare-maintained-dependencies.mjs'
$stager = Join-Path $source 'bin/staged-app-install.mjs'
RunNode @($stager, 'prepare', '--app', $app, '--source', $source, '--commit', $head)
RunNode @($helper, 'prepare', $staging, $anchor, $pnpm)
Stopped
if (@(Get-ChildItem -LiteralPath $data -Recurse -Force -Attributes ReparsePoint).Count) { throw '数据目录存在重解析项，需要先审核备份范围' }
Copy-Item -LiteralPath $data -Destination (Join-Path $backup 'tavern-data') -Recurse
$profileBackup = Join-Path $backup 'tavern-profile'
New-Item -ItemType Directory -Path $profileBackup | Out-Null
foreach ($entry in Get-ChildItem -LiteralPath $profile -Force | Where-Object Name -NE 'node_modules') {
    Copy-Item -LiteralPath $entry.FullName -Destination $profileBackup -Recurse
}
$manifest = [ordered]@{ version = 1; installation = $install; runtime = $runtime; app = $app; data = $data; profile = $profile;
    previous = $previous; backup = $backup; sourceCommit = $head; sourceVersion = $sourceVersion; previousVersion = $installedVersion; status = 'prepared' }
$manifestPath = Join-Path $backup 'deployment.json'
[IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json) + "`n", $utf8)
$rollback = @'
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$m = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'deployment.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$root = [IO.Path]::GetFullPath($m.installation).TrimEnd('\')
function Checked([string]$path) {
  $full = [IO.Path]::GetFullPath($path)
  if (-not $full.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) { throw '回滚路径越界' }
  return $full
}
$app = Checked $m.app; $previous = Checked $m.previous; $backup = Checked $m.backup
if ($backup -ine [IO.Path]::GetFullPath($PSScriptRoot) -or $app -ine (Join-Path $root 'data/harness/apps/dsh-tavern') -or $previous -ine ($app + '.previous')) { throw '回滚清单归属无效' }
if ($m.version -ne 1 -or $m.data -ine (Join-Path $root 'data/harness/profile-data/tavern') -or $m.profile -ine (Join-Path $root 'data/harness/profiles/tavern')) { throw '回滚数据目录归属无效' }
if (@(Get-NetTCPConnection -LocalPort 43120 -State Listen -ErrorAction SilentlyContinue | Where-Object { $null -ne $_ }).Count) { throw '请先退出 DSH' }
if (-not (Test-Path -LiteralPath $previous -PathType Container)) { throw '原程序备份不存在，未执行回滚' }
foreach ($name in @('tavern-data','tavern-profile')) { if (-not (Test-Path -LiteralPath (Join-Path $backup $name) -PathType Container)) { throw '升级前数据备份缺失' } }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$record = Get-Content -LiteralPath (Join-Path $app '.dsh-tavern-swap.json') -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($relative in $record.moved) {
  if ($relative -match '(^|/)\.\.?(/|$)|[\\:]' -or $relative.StartsWith('/')) { throw '用户文件回滚路径无效' }
  $from = Checked (Join-Path $app $relative); $to = Checked (Join-Path $previous $relative)
  if (Test-Path -LiteralPath $to) { throw '用户文件恢复目标已存在' }
  New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($to)) -Force | Out-Null
  Move-Item -LiteralPath $from -Destination $to
}
Move-Item -LiteralPath $app -Destination (Checked (Join-Path $backup ('post-upgrade-app-' + $stamp)))
Move-Item -LiteralPath $previous -Destination $app
foreach ($entry in @(@{path=$m.data;name='tavern-data'},@{path=$m.profile;name='tavern-profile'})) {
  $live = Checked $entry.path
  $displaced = Checked (Join-Path $backup ('post-upgrade-' + $entry.name + '-' + $stamp))
  Move-Item -LiteralPath $live -Destination $displaced
  Copy-Item -LiteralPath (Join-Path $backup $entry.name) -Destination $live -Recurse
  if ($entry.name -eq 'tavern-profile' -and (Test-Path -LiteralPath (Join-Path $displaced 'node_modules'))) {
    Move-Item -LiteralPath (Checked (Join-Path $displaced 'node_modules')) -Destination (Checked (Join-Path $live 'node_modules'))
  }
}
Write-Output '已恢复升级前程序与配套存档，升级后文件完整保留在备份目录。'
'@
$rollbackPath = Join-Path $backup 'rollback.ps1'
[IO.File]::WriteAllText($rollbackPath, $rollback, $utf8)
try {
    Stopped
    RunNode @($stager, 'swap', '--app', $app)
    RunNode @((Join-Path $app 'bin/prepare-maintained-dependencies.mjs'), 'relink', $app, $anchor, $pnpm)
    $pluginsRoot = Contained 'data/harness/profile-data/tavern/data/plugins'
    if (-not (Test-Path -LiteralPath $pluginsRoot)) { New-Item -ItemType Directory -Path $pluginsRoot | Out-Null }
    Copy-Item -LiteralPath (Join-Path $app 'plugins/dsh-tavern-writing-presets') -Destination $pluginTarget -Recurse
    $manifest.status = 'deployed'
    [IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json) + "`n", $utf8)
    Write-Output "部署完成，原程序与完整存档备份已保留。回滚：& '$rollbackPath'"
} catch {
    $failure = $_
    $manifest.status = 'failed'
    [IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json) + "`n", $utf8)
    if (Test-Path -LiteralPath $previous) { & $rollbackPath }
    throw $failure
}
