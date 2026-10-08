# Deploy the committed Dream Sike Agent branch to the existing Desktop install.
# Run with -WhatIf first. This deliberately excludes profile data and the root
# plugin.patch.yml, which is not part of the Desktop runtime file manifest.
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [string]$InstallationRoot = 'D:\pro\DSH-Tavern'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$baseCommit = '7f4a7484584459a54ec51834118742ba71ece3ae'
$expectedBranch = 'codex/dream-sike-dsh-agent'
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

function Invoke-Git([string[]]$arguments) {
    $result = @(& git -C $repoRoot @arguments)
    if ($LASTEXITCODE -ne 0) { throw "Git 检查失败：git $($arguments -join ' ')" }
    return $result
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

$repoRoot = Get-AbsoluteDirectory (Join-Path $PSScriptRoot '..')
$installRoot = Get-AbsoluteDirectory $InstallationRoot
$appRoot = Get-AbsoluteDirectory (Join-Path $installRoot 'data\harness\apps\dsh-tavern')
$tempRoot = Get-AbsoluteDirectory (Join-Path $installRoot 'temp')
if ([System.IO.Path]::GetPathRoot($appRoot) -ine [System.IO.Path]::GetPathRoot($tempRoot)) {
    throw '部署目录与备份目录必须位于同一卷，以便逐文件原子替换。'
}
$inventoryPath = Assert-ContainedPath $appRoot (Join-Path $appRoot '.dsh-tavern-files.txt')
if (-not (Test-Path -LiteralPath $inventoryPath -PathType Leaf)) { throw '安装文件清单不存在。' }
Assert-AppStopped $appRoot

$branch = [string](@(Invoke-Git @('branch', '--show-current'))[0])
if ($branch -ne $expectedBranch) { throw "当前分支不是 $expectedBranch：$branch" }
$head = [string](@(Invoke-Git @('rev-parse', 'HEAD'))[0])
if ($head -eq $baseCommit) { throw '分支尚未提交重构结果。' }
& git -C $repoRoot merge-base --is-ancestor $baseCommit $head
if ($LASTEXITCODE -ne 0) { throw '部署分支不是指定 2.5.0 基线的后代。' }
$dirty = @(Invoke-Git @('status', '--porcelain', '--', 'presets/dream-sike-dsh', 'tavern-plugin/lib'))
if ($dirty.Count -gt 0) { throw '预设或运行代码仍有未提交变更；请先提交并重建。' }
$diffPaths = @(Invoke-Git @('-c', 'core.safecrlf=false', 'diff', '--name-only', '--no-renames', $baseCommit, $head, '--', 'presets/dream-sike-dsh', 'tavern-plugin/lib'))
if ($diffPaths.Count -ne 26 -or @($diffPaths | Sort-Object -Unique).Count -ne 26) { throw "运行文件差异应为 26 项，当前为 $($diffPaths.Count) 项。" }
foreach ($path in $diffPaths) {
    if ($path -notin $expectedPaths) { throw "分支包含未经审核的运行文件：$path" }
}
foreach ($path in $expectedPaths) {
    if ($path -notin $diffPaths) { throw "分支缺少预期运行文件：$path" }
}

$sourceVersion = (Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$appVersion = (Get-Content -LiteralPath (Join-Path $appRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
if ($sourceVersion -ne '2.5.0' -or $appVersion -ne '2.5.0') { throw "版本校验失败：源码 $sourceVersion，安装 $appVersion；要求均为 2.5.0。" }

$inventoryText = [System.IO.File]::ReadAllText($inventoryPath, [System.Text.Encoding]::UTF8)
$installedFiles = @($inventoryText -split '\r?\n' | Where-Object { $_ -ne '' })
if (@($installedFiles | Sort-Object -Unique).Count -ne $installedFiles.Count) { throw '安装文件清单含重复项。' }
$files = @()
foreach ($relative in $expectedPaths) {
    if ($relative -notmatch '^(presets/dream-sike-dsh/.+|tavern-plugin/lib/.+)$' -or $relative -match '(^|/)\.\.?(/|$)') { throw "无效部署路径：$relative" }
    $native = $relative.Replace('/', '\')
    $source = Assert-ContainedPath $repoRoot (Join-Path $repoRoot $native)
    $target = Assert-ContainedPath $appRoot (Join-Path $appRoot $native)
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "已提交文件不存在：$relative" }
    & git -C $repoRoot cat-file -e "${baseCommit}:$relative" 2>$null
    $inBase = $LASTEXITCODE -eq 0
    $exists = Test-Path -LiteralPath $target
    if ($inBase -ne $exists) { throw "目标存在状态与基线不符：$relative" }
    $originalHash = $null
    $baseBlob = $null
    if ($inBase) {
        if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { throw "目标不是普通文件：$relative" }
        if ($relative -notin $installedFiles) { throw "原文件不在安装清单中：$relative" }
        $baseBlob = [string](@(Invoke-Git @('rev-parse', "${baseCommit}:$relative"))[0])
        $installedBlob = [string](@(Invoke-Git @('hash-object', '--', $target))[0])
        if ($installedBlob -ne $baseBlob) { throw "安装文件偏离 2.5.0 基线：$relative" }
        $originalHash = Get-Sha256 $target
    } elseif ($relative -in $installedFiles) {
        throw "新增文件已出现在安装清单中：$relative"
    }
    $files += [ordered]@{
        relativePath = $relative
        operation = if ($inBase) { 'replace' } else { 'create' }
        baseBlob = $baseBlob
        originalSha256 = $originalHash
        deployedSha256 = Get-Sha256 $source
        backupRelativePath = if ($inBase) { 'originals/' + $relative } else { $null }
    }
}
if (@($files | Where-Object operation -EQ 'replace').Count -ne 15 -or @($files | Where-Object operation -EQ 'create').Count -ne 11) {
    throw '部署文件类型与预期不符；要求替换 15 项、新建 11 项。'
}

$newPaths = @($files | Where-Object operation -EQ 'create' | ForEach-Object { $_.relativePath })
$nextInventory = (@($installedFiles + $newPaths) | Sort-Object -Unique) -join "`n"
$nextInventory += "`n"
$nextInventoryHash = [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($utf8NoBom.GetBytes($nextInventory))).ToLowerInvariant()
$inventoryHash = Get-Sha256 $inventoryPath
$deploymentId = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$backupRoot = Assert-ContainedPath $tempRoot (Join-Path $tempRoot "dream-sike-deploy-$deploymentId")
if (Test-Path -LiteralPath $backupRoot) { throw "备份目录已存在：$backupRoot" }
$manifest = [ordered]@{
    schemaVersion = 1
    kind = 'dream-sike-dsh-branch'
    status = 'prepared'
    createdAt = (Get-Date).ToString('o')
    installationRoot = $installRoot
    appRoot = $appRoot
    backupRoot = $backupRoot
    baseCommit = $baseCommit
    targetCommit = $head
    version = '2.5.0'
    inventory = [ordered]@{
        originalSha256 = $inventoryHash
        deployedSha256 = $nextInventoryHash
        backupRelativePath = 'originals/.dsh-tavern-files.txt'
    }
    files = $files
}

Write-Output "分支：$branch ($head)"
Write-Output "部署文件：26（替换 15，新建 11）；安装版本：2.5.0"
Write-Output "备份位置：$backupRoot"
if (-not $PSCmdlet.ShouldProcess($appRoot, '备份并部署梦境思客DSH分支的 26 个运行文件及安装清单')) { return }

New-Item -ItemType Directory -Path $backupRoot -ErrorAction Stop | Out-Null
$backupInventory = Assert-ContainedPath $backupRoot (Join-Path $backupRoot 'originals\.dsh-tavern-files.txt')
New-Item -ItemType Directory -Path (Split-Path -Parent $backupInventory) -Force | Out-Null
Copy-Item -LiteralPath $inventoryPath -Destination $backupInventory -ErrorAction Stop
if ((Get-Sha256 $backupInventory) -ne $inventoryHash) { throw '安装清单备份校验失败。' }
foreach ($entry in ($files | Where-Object operation -EQ 'replace')) {
    $original = Assert-ContainedPath $appRoot (Join-Path $appRoot $entry.relativePath.Replace('/', '\'))
    $backup = Assert-ContainedPath $backupRoot (Join-Path $backupRoot $entry.backupRelativePath.Replace('/', '\'))
    New-Item -ItemType Directory -Path (Split-Path -Parent $backup) -Force | Out-Null
    Copy-Item -LiteralPath $original -Destination $backup -ErrorAction Stop
    if ((Get-Sha256 $backup) -ne $entry.originalSha256) { throw "备份校验失败：$($entry.relativePath)" }
}
# Stage every byte before replacing any live file. A failed stage remains in
# the backup directory for review; File.Replace/File.Move cannot leave a
# half-copied installed file.
foreach ($entry in $files) {
    $source = Assert-ContainedPath $repoRoot (Join-Path $repoRoot $entry.relativePath.Replace('/', '\'))
    $staged = Assert-ContainedPath $backupRoot (Join-Path $backupRoot ('staged\' + $entry.relativePath.Replace('/', '\')))
    New-Item -ItemType Directory -Path (Split-Path -Parent $staged) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $staged -ErrorAction Stop
    if ((Get-Sha256 $staged) -ne $entry.deployedSha256) { throw "待部署文件校验失败：$($entry.relativePath)" }
}
$stagedInventory = Assert-ContainedPath $backupRoot (Join-Path $backupRoot 'staged\.dsh-tavern-files.txt')
[System.IO.File]::WriteAllText($stagedInventory, $nextInventory, $utf8NoBom)
if ((Get-Sha256 $stagedInventory) -ne $nextInventoryHash) { throw '待部署安装清单校验失败。' }
$manifestPath = Assert-ContainedPath $backupRoot (Join-Path $backupRoot 'deployment.json')
[System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 10) + "`n", $utf8NoBom)

try {
    foreach ($entry in $files) {
        $staged = Assert-ContainedPath $backupRoot (Join-Path $backupRoot ('staged\' + $entry.relativePath.Replace('/', '\')))
        $target = Assert-ContainedPath $appRoot (Join-Path $appRoot $entry.relativePath.Replace('/', '\'))
        New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
        if ($entry.operation -eq 'replace') {
            if ((Get-Sha256 $target) -ne $entry.originalSha256) { throw "安装文件在部署期间变化：$($entry.relativePath)" }
            $replaced = Assert-ContainedPath $backupRoot (Join-Path $backupRoot ('replaced\' + $entry.relativePath.Replace('/', '\')))
            New-Item -ItemType Directory -Path (Split-Path -Parent $replaced) -Force | Out-Null
            [System.IO.File]::Replace($staged, $target, $replaced)
        } else {
            if (Test-Path -LiteralPath $target) { throw "新增文件在部署期间出现：$($entry.relativePath)" }
            [System.IO.File]::Move($staged, $target)
        }
        if ((Get-Sha256 $target) -ne $entry.deployedSha256) { throw "部署校验失败：$($entry.relativePath)" }
    }
    if ((Get-Sha256 $inventoryPath) -ne $inventoryHash) { throw '安装清单在部署期间变化。' }
    $replacedInventory = Assert-ContainedPath $backupRoot (Join-Path $backupRoot 'replaced\.dsh-tavern-files.txt')
    New-Item -ItemType Directory -Path (Split-Path -Parent $replacedInventory) -Force | Out-Null
    [System.IO.File]::Replace($stagedInventory, $inventoryPath, $replacedInventory)
    if ((Get-Sha256 $inventoryPath) -ne $nextInventoryHash) { throw '安装清单更新校验失败。' }
    $manifest.status = 'deployed'
    $manifest.deployedAt = (Get-Date).ToString('o')
    [System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 10) + "`n", $utf8NoBom)
    Write-Output "部署完成。回滚：& '$PSScriptRoot\rollback-dream-sike-branch.ps1' -BackupRoot '$backupRoot'"
} catch {
    Write-Error "部署未完成。备份保留在 $backupRoot；请先关闭 DSH Tavern，再用 rollback-dream-sike-branch.ps1 -BackupRoot 回滚。原因：$($_.Exception.Message)"
    throw
}
