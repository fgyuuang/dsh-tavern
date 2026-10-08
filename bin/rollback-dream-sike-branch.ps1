# Restore one exact Dream Sike branch deployment. The backup directory and all
# release files are retained for review; only files created by that deployment
# are removed. Run with -WhatIf first.
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [Parameter(Mandatory = $true)]
    [string]$BackupRoot,
    [string]$InstallationRoot = 'D:\pro\DSH-Tavern'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$baseCommit = '7f4a7484584459a54ec51834118742ba71ece3ae'
$expectedPaths = @(
    'presets/dream-sike-dsh/agent.cordis.yml'
    'presets/dream-sike-dsh/preset.yml'
    'presets/dream-sike-dsh/skills/dream-sike-continuity/SKILL.md'
    'presets/dream-sike-dsh/skills/dream-sike-director/SKILL.md'
    'presets/dream-sike-dsh/skills/dream-sike-format/SKILL.md'
    'presets/dream-sike-dsh/skills/dream-sike-knowledge/SKILL.md'
    'presets/dream-sike-dsh/skills/dream-sike-parallel/SKILL.md'
    'presets/dream-sike-dsh/skills/dream-sike-prose/SKILL.md'
    'tavern-plugin/lib/client-assets/tavern.css'
    'tavern-plugin/lib/client.js'
    'tavern-plugin/lib/domain/chat-history-import-service.js'
    'tavern-plugin/lib/domain/chat-session-state.js'
    'tavern-plugin/lib/domain/conversation-initialization.js'
    'tavern-plugin/lib/domain/dream-sike-draft.js'
    'tavern-plugin/lib/domain/dream-sike-mode.js'
    'tavern-plugin/lib/domain/foreground-orchestration-strategies.js'
    'tavern-plugin/lib/domain/round-history.js'
    'tavern-plugin/lib/domain/session-opening.js'
    'tavern-plugin/lib/domain/session-view-reader.js'
    'tavern-plugin/lib/domain/tavern-settings.js'
    'tavern-plugin/lib/domain/tavern-skills.js'
    'tavern-plugin/lib/domain/turn-orchestration.js'
    'tavern-plugin/lib/hooks/request.js'
    'tavern-plugin/lib/hooks/turn-lifecycle.js'
    'tavern-plugin/lib/index.js'
    'tavern-plugin/lib/tools/dream-sike.js'
)
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$comparison = [System.StringComparison]::OrdinalIgnoreCase

function Get-AbsoluteDirectory([string]$path) {
    $full = [System.IO.Path]::GetFullPath($path).TrimEnd('\')
    if (-not (Test-Path -LiteralPath $full -PathType Container)) { throw "目录不存在：$full" }
    $item = Get-Item -LiteralPath $full -Force
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw "不允许重解析目录：$full" }
    return $full
}

function Assert-ContainedPath([string]$root, [string]$target) {
    $full = [System.IO.Path]::GetFullPath($target)
    if (-not $full.StartsWith($root + '\', $comparison)) { throw "目标超出允许目录：$full" }
    $relative = [System.IO.Path]::GetRelativePath($root, $full)
    $cursor = $root
    foreach ($part in ($relative -split '[\\/]')) {
        if ($part -eq '' -or $part -eq '.' -or $part -eq '..') { throw "无效相对路径：$relative" }
        $cursor = Join-Path $cursor $part
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force
            if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw "目标经过重解析路径：$cursor" }
        }
    }
    return $full
}

function Get-Sha256([string]$path) {
    return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Assert-AppStopped([string]$appRoot) {
    $listeners = @(Get-NetTCPConnection -LocalPort 43120 -State Listen -ErrorAction SilentlyContinue)
    if ($listeners.Count -gt 0) { throw 'TCP 43120 仍在监听；请先关闭 DSH Tavern。' }
    $processes = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
        $_.Name -match '^DSH Tavern(?:\.exe)?$|^DSH Desktop(?:\.exe)?$' -or
        ($_.CommandLine -and $_.CommandLine.IndexOf($appRoot, [System.StringComparison]::OrdinalIgnoreCase) -ge 0)
    })
    if ($processes.Count -gt 0) { throw 'DSH Tavern 程序仍在运行；请先从界面退出。' }
}

$installRoot = Get-AbsoluteDirectory $InstallationRoot
$appRoot = Get-AbsoluteDirectory (Join-Path $installRoot 'data\harness\apps\dsh-tavern')
$tempRoot = Get-AbsoluteDirectory (Join-Path $installRoot 'temp')
$backupRoot = Get-AbsoluteDirectory $BackupRoot
$backupRoot = Assert-ContainedPath $tempRoot $backupRoot
if ([System.IO.Path]::GetPathRoot($appRoot) -ine [System.IO.Path]::GetPathRoot($backupRoot)) {
    throw '程序目录与备份目录必须位于同一卷，以便逐文件原子恢复。'
}
$manifestPath = Assert-ContainedPath $backupRoot (Join-Path $backupRoot 'deployment.json')
$inventoryPath = Assert-ContainedPath $appRoot (Join-Path $appRoot '.dsh-tavern-files.txt')
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw '指定备份没有 deployment.json。' }
if (-not (Test-Path -LiteralPath $inventoryPath -PathType Leaf)) { throw '安装文件清单不存在。' }
Assert-AppStopped $appRoot

$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json -AsHashtable
if ($manifest.schemaVersion -ne 1 -or $manifest.kind -ne 'dream-sike-dsh-branch' -or
    $manifest.baseCommit -ne $baseCommit -or $manifest.version -ne '2.5.0' -or
    $manifest.installationRoot -ine $installRoot -or $manifest.appRoot -ine $appRoot -or
    $manifest.backupRoot -ine $backupRoot -or $manifest.targetCommit -notmatch '^[0-9a-f]{40}$') {
    throw '备份清单身份、安装目录或版本不匹配。'
}
$appVersion = (Get-Content -LiteralPath (Join-Path $appRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
if ($appVersion -ne '2.5.0') { throw "当前程序版本为 $appVersion，不能用 2.5.0 备份回滚。" }
$files = @($manifest.files)
if ($files.Count -ne 26 -or @($files | ForEach-Object relativePath | Sort-Object -Unique).Count -ne 26) { throw '备份清单不是 26 个唯一运行文件。' }
foreach ($entry in $files) {
    $relative = [string]$entry.relativePath
    if ($relative -notin $expectedPaths -or $relative -match '(^|/)\.\.?(/|$)' -or
        $entry.operation -notin @('replace', 'create') -or $entry.deployedSha256 -notmatch '^[0-9a-f]{64}$') {
        throw "备份清单含无效运行文件：$relative"
    }
}
foreach ($path in $expectedPaths) {
    if ($path -notin @($files | ForEach-Object relativePath)) { throw "备份清单缺少文件：$path" }
}
if (@($files | Where-Object operation -EQ 'replace').Count -ne 15 -or @($files | Where-Object operation -EQ 'create').Count -ne 11) {
    throw '备份清单应记录替换 15 项、新建 11 项。'
}
if ($manifest.inventory.backupRelativePath -ne 'originals/.dsh-tavern-files.txt' -or
    $manifest.inventory.originalSha256 -notmatch '^[0-9a-f]{64}$' -or
    $manifest.inventory.deployedSha256 -notmatch '^[0-9a-f]{64}$') { throw '备份清单的安装清单校验信息无效。' }
$backupInventory = Assert-ContainedPath $backupRoot (Join-Path $backupRoot 'originals\.dsh-tavern-files.txt')
if (-not (Test-Path -LiteralPath $backupInventory -PathType Leaf) -or
    (Get-Sha256 $backupInventory) -ne $manifest.inventory.originalSha256) { throw '原安装清单备份已损坏。' }
$currentInventoryHash = Get-Sha256 $inventoryPath
if ($currentInventoryHash -notin @($manifest.inventory.deployedSha256, $manifest.inventory.originalSha256)) {
    throw '安装清单在部署后被其他操作修改；停止自动回滚。'
}

# Check every target and every backup before changing even one installed file.
foreach ($entry in $files) {
    $relative = [string]$entry.relativePath
    $target = Assert-ContainedPath $appRoot (Join-Path $appRoot $relative.Replace('/', '\'))
    if ($entry.operation -eq 'replace') {
        if ($entry.backupRelativePath -ne ('originals/' + $relative) -or
            $entry.originalSha256 -notmatch '^[0-9a-f]{64}$' -or $entry.baseBlob -notmatch '^[0-9a-f]{40}$') {
            throw "原文件备份记录无效：$relative"
        }
        $backup = Assert-ContainedPath $backupRoot (Join-Path $backupRoot $entry.backupRelativePath.Replace('/', '\'))
        if (-not (Test-Path -LiteralPath $backup -PathType Leaf) -or
            (Get-Sha256 $backup) -ne $entry.originalSha256) { throw "原文件备份已损坏：$relative" }
        if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { throw "待恢复文件已丢失：$relative" }
        if ((Get-Sha256 $target) -notin @($entry.deployedSha256, $entry.originalSha256)) {
            throw "部署文件在安装后被修改：$relative"
        }
    } else {
        if ($entry.backupRelativePath -or $entry.originalSha256 -or $entry.baseBlob) { throw "新增文件备份记录无效：$relative" }
        if (Test-Path -LiteralPath $target) {
            if (-not (Test-Path -LiteralPath $target -PathType Leaf) -or (Get-Sha256 $target) -ne $entry.deployedSha256) {
                throw "新增文件在安装后被修改：$relative"
            }
        }
    }
}

Write-Output "回滚提交：$($manifest.targetCommit)"
Write-Output "恢复文件：15；删除本次新增文件：11；恢复安装清单。"
Write-Output "保留备份：$backupRoot"
if (-not $PSCmdlet.ShouldProcess($appRoot, '逐文件回滚梦境思客DSH分支并恢复安装清单')) { return }

$restoreRoot = Assert-ContainedPath $backupRoot (Join-Path $backupRoot ('restore-' + [guid]::NewGuid().ToString('N').Substring(0, 8)))
New-Item -ItemType Directory -Path $restoreRoot -ErrorAction Stop | Out-Null
foreach ($entry in ($files | Where-Object operation -EQ 'replace')) {
    $target = Assert-ContainedPath $appRoot (Join-Path $appRoot $entry.relativePath.Replace('/', '\'))
    $backup = Assert-ContainedPath $backupRoot (Join-Path $backupRoot $entry.backupRelativePath.Replace('/', '\'))
    if ((Get-Sha256 $target) -ne $entry.originalSha256) {
        $staged = Assert-ContainedPath $restoreRoot (Join-Path $restoreRoot $entry.relativePath.Replace('/', '\'))
        New-Item -ItemType Directory -Path (Split-Path -Parent $staged) -Force | Out-Null
        Copy-Item -LiteralPath $backup -Destination $staged -ErrorAction Stop
        if ((Get-Sha256 $staged) -ne $entry.originalSha256) { throw "待恢复文件校验失败：$($entry.relativePath)" }
        if ((Get-Sha256 $target) -ne $entry.deployedSha256) { throw "安装文件在回滚期间变化：$($entry.relativePath)" }
        [System.IO.File]::Replace($staged, $target, $null)
        if ((Get-Sha256 $target) -ne $entry.originalSha256) { throw "原文件恢复校验失败：$($entry.relativePath)" }
    }
}
foreach ($entry in ($files | Where-Object operation -EQ 'create')) {
    $target = Assert-ContainedPath $appRoot (Join-Path $appRoot $entry.relativePath.Replace('/', '\'))
    if (Test-Path -LiteralPath $target) {
        if ((Get-Sha256 $target) -ne $entry.deployedSha256) { throw "新增文件在回滚期间被修改：$($entry.relativePath)" }
        Remove-Item -LiteralPath $target -Force -ErrorAction Stop
    }
}
$stagedInventory = Assert-ContainedPath $restoreRoot (Join-Path $restoreRoot '.dsh-tavern-files.txt')
Copy-Item -LiteralPath $backupInventory -Destination $stagedInventory -ErrorAction Stop
if ((Get-Sha256 $stagedInventory) -ne $manifest.inventory.originalSha256) { throw '待恢复安装清单校验失败。' }
if ((Get-Sha256 $inventoryPath) -notin @($manifest.inventory.deployedSha256, $manifest.inventory.originalSha256)) {
    throw '安装清单在回滚期间变化。'
}
[System.IO.File]::Replace($stagedInventory, $inventoryPath, $null)
if ((Get-Sha256 $inventoryPath) -ne $manifest.inventory.originalSha256) { throw '安装清单恢复校验失败。' }
$manifest.status = 'rolledBack'
$manifest.rolledBackAt = (Get-Date).ToString('o')
[System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 10) + "`n", $utf8NoBom)
Write-Output '回滚完成；备份和 deployment.json 已保留。'
