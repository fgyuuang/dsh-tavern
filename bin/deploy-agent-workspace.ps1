# Deploy committed Agent workspace runtime files; stop this installation first.
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [string]$InstallationRoot = 'D:\pro\DSH-Tavern',
    [string]$BaseCommit = '7e49f7072a406038e7f5a840e7638ceb1a8f935c'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$utf8 = [System.Text.UTF8Encoding]::new($false)
$comparison = [System.StringComparison]::OrdinalIgnoreCase

function Assert-OrdinaryPath([string]$path) {
    $full = [System.IO.Path]::GetFullPath($path)
    $cursor = $full
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force
            if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw "不允许重解析路径：$cursor" }
        }
        $next = [System.IO.Path]::GetDirectoryName($cursor)
        if ($next -eq $cursor) { break }
        $cursor = $next
    }
    return $full
}
function Get-Directory([string]$path) {
    $full = (Assert-OrdinaryPath $path).TrimEnd('\')
    if (-not (Test-Path -LiteralPath $full -PathType Container)) { throw "目录不存在：$full" }
    return $full
}
function Get-Contained([string]$root, [string]$relative) {
    if ([string]::IsNullOrEmpty($relative) -or $relative -match '[\\:\r\n\t]' -or $relative.StartsWith('/') -or $relative -match '(^|/)\.\.?(/|$)' -or $relative -match '//|/$') { throw "无效相对路径：$relative" }
    $full = Assert-OrdinaryPath (Join-Path $root $relative.Replace('/', '\'))
    if (-not $full.StartsWith($root.TrimEnd('\') + '\', $comparison)) { throw "路径超出允许目录：$full" }
    return $full
}
function Get-Sha([string]$path) { return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() }
function New-Parent([string]$path) {
    $directory = Assert-OrdinaryPath ([System.IO.Path]::GetDirectoryName($path))
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
}
function Invoke-RepoGit([string[]]$arguments) {
    $result = @(& git -C $repoRoot @arguments)
    if ($LASTEXITCODE -ne 0) { throw "Git 检查失败：$($arguments -join ' ')" }
    return $result
}
function Assert-Stopped {
    $running = @(Get-CimInstance Win32_Process | Where-Object {
        $_.ExecutablePath -and $_.ExecutablePath.StartsWith($installRoot + '\runtime-', $comparison) -and
        $_.CommandLine -and $_.CommandLine.IndexOf($appRoot, $comparison) -ge 0
    })
    if ($running.Count) { throw '此安装的 DSH Tavern 运行进程仍在运行；请先停止。' }
    $listeners = @(Get-NetTCPConnection -LocalPort 43120 -State Listen -ErrorAction SilentlyContinue | Where-Object {
        $_.LocalAddress -in @('127.0.0.1', '::1', '0.0.0.0', '::')
    })
    if ($listeners.Count) { throw '本机 TCP 43120 仍在监听；请先停止服务。' }
}

$repoRoot = Get-Directory (Join-Path $PSScriptRoot '..')
$installRoot = Get-Directory $InstallationRoot
$appRoot = Get-Directory (Get-Contained $installRoot 'data/harness/apps/dsh-tavern')
$tempRoot = Get-Contained $installRoot 'temp'
if (Test-Path -LiteralPath $tempRoot) { $tempRoot = Get-Directory $tempRoot }
if ([System.IO.Path]::GetPathRoot($appRoot) -ine [System.IO.Path]::GetPathRoot($tempRoot)) { throw '备份与运行目录必须位于同一卷。' }
Assert-Stopped
$branch = [string](@(Invoke-RepoGit @('branch', '--show-current'))[0])
if ($branch -ne 'codex/dream-sike-dsh-agent') { throw "部署要求 codex/dream-sike-dsh-agent 分支，当前为 $branch。" }
if ($BaseCommit -notmatch '^[0-9a-fA-F]{40}$') { throw 'BaseCommit 必须是完整提交 SHA。' }
$base = [string](@(Invoke-RepoGit @('rev-parse', '--verify', "$BaseCommit^{commit}"))[0])
$head = [string](@(Invoke-RepoGit @('rev-parse', 'HEAD'))[0])
& git -C $repoRoot merge-base --is-ancestor $base $head
if ($LASTEXITCODE -ne 0 -or $base -eq $head) { throw 'HEAD 必须是指定基线之后的提交。' }
$dirty = @(Invoke-RepoGit @('status', '--porcelain', '--untracked-files=all', '--', 'presets/dream-sike-dsh', 'tavern-plugin/lib'))
if ($dirty.Count) { throw '运行文件有未提交变更；请先完成构建与提交。' }
$sourceVersion = (Get-Content -LiteralPath (Get-Contained $repoRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$appVersion = (Get-Content -LiteralPath (Get-Contained $appRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
if ($sourceVersion -ne '2.5.0' -or $appVersion -ne '2.5.0') { throw "版本要求均为 2.5.0，当前为源码 $sourceVersion / 安装 $appVersion。" }
$inventoryPath = Get-Contained $appRoot '.dsh-tavern-files.txt'
if (-not (Test-Path -LiteralPath $inventoryPath -PathType Leaf)) { throw '缺少安装文件清单。' }
$inventoryText = [System.IO.File]::ReadAllText($inventoryPath, [System.Text.Encoding]::UTF8)
$installed = @($inventoryText -split '\r?\n' | Where-Object { $_ -ne '' })
$inventorySet = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
foreach ($path in $installed) {
    $null = Get-Contained $appRoot $path
    if (-not $inventorySet.Add($path)) { throw "安装清单含重复路径：$path" }
}
$changes = @(Invoke-RepoGit @('-c', 'core.quotepath=false', 'diff', '--name-status', '--no-renames', $base, $head, '--', 'presets/dream-sike-dsh', 'tavern-plugin/lib'))
if (-not $changes.Count) { throw '没有已提交的运行文件差异。' }
$files = @()
foreach ($line in $changes) {
    $parts = $line -split "`t"
    if ($parts.Count -ne 2 -or $parts[0] -notin @('A', 'M')) { throw "仅允许新增或修改普通文件，拒绝：$line" }
    $relative = $parts[1]
    if ($relative -notmatch '^(presets/dream-sike-dsh/.+|tavern-plugin/lib/.+)$') { throw "部署路径不受支持：$relative" }
    $source = Get-Contained $repoRoot $relative
    $target = Get-Contained $appRoot $relative
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "源文件不存在：$relative" }
    $tree = [string](@(Invoke-RepoGit @('ls-tree', $head, '--', $relative))[0])
    if ($tree -notmatch '^100(644|755) blob ') { throw "提交中的目标不是普通文件：$relative" }
    $inBase = $parts[0] -eq 'M'
    $baseBlob = $null
    $originalSha = $null
    if ($inBase) {
        if (-not (Test-Path -LiteralPath $target -PathType Leaf) -or -not $inventorySet.Contains($relative)) { throw "基线文件缺失或不在安装清单：$relative" }
        $baseBlob = [string](@(Invoke-RepoGit @('rev-parse', "${base}:$relative"))[0])
        # Compare with repository text attributes; Windows installs can retain CRLF.
        # The original byte hash below still guards backup, replacement and rollback.
        $actualBlob = [string](@(Invoke-RepoGit @('hash-object', '--path', $relative, '--', $target))[0])
        if ($actualBlob -ne $baseBlob) { throw "安装文件已偏离指定基线：$relative" }
        $originalSha = Get-Sha $target
    } elseif ((Test-Path -LiteralPath $target) -or $inventorySet.Contains($relative)) { throw "新增路径已经存在或列入安装清单：$relative" }
    $files += [ordered]@{ relativePath = $relative; operation = if ($inBase) { 'replace' } else { 'create' }; baseBlob = $baseBlob;
        originalSha256 = $originalSha; deployedSha256 = Get-Sha $source; backupRelativePath = if ($inBase) { 'originals/' + $relative } else { $null } }
}
$nextInventory = (@($installed + @($files | Where-Object operation -EQ 'create' | ForEach-Object { $_.relativePath })) | Sort-Object -Unique) -join "`n"
$nextInventory += "`n"
$inventorySha = Get-Sha $inventoryPath
$nextInventorySha = [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($utf8.GetBytes($nextInventory))).ToLowerInvariant()
$deploymentId = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N')
$backupRoot = Get-Contained $tempRoot ('agent-workspace-deploy-' + $deploymentId)
if (Test-Path -LiteralPath $backupRoot) { throw "备份目录已存在：$backupRoot" }
$manifest = [ordered]@{ schemaVersion = 1; kind = 'agent-workspace'; status = 'prepared'; createdAt = (Get-Date).ToString('o');
    installationRoot = $installRoot; appRoot = $appRoot; backupRoot = $backupRoot; baseCommit = $base; targetCommit = $head; version = '2.5.0';
    inventory = [ordered]@{ originalSha256 = $inventorySha; deployedSha256 = $nextInventorySha; backupRelativePath = 'originals/.dsh-tavern-files.txt' }; files = $files }
Write-Output "分支 $branch；基线 $base；目标 $head；运行文件 $($files.Count)；版本 2.5.0"
Write-Output "备份与回滚位置：$backupRoot"
if (-not $PSCmdlet.ShouldProcess($appRoot, "备份并原子部署 $($files.Count) 个 Agent 工作区运行文件和安装清单")) { return }
Assert-Stopped
if (-not (Test-Path -LiteralPath $tempRoot)) { New-Item -ItemType Directory -Path $tempRoot | Out-Null }
New-Item -ItemType Directory -Path $backupRoot | Out-Null
$manifestPath = Get-Contained $backupRoot 'deployment.json'
function Save-Manifest { [System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 12) + "`n", $utf8) }
Save-Manifest
$rollbackSource = @'
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$cmp = [System.StringComparison]::OrdinalIgnoreCase
function Ordinary([string]$path) {
    $full = [System.IO.Path]::GetFullPath($path)
    $cursor = $full
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force
            if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw "拒绝重解析路径：$cursor" }
        }
        $cursor = [System.IO.Path]::GetDirectoryName($cursor)
    }
    return $full
}
function Contained([string]$root, [string]$relative) {
    if (-not $relative -or $relative -match '[\\:\r\n\t]' -or $relative.StartsWith('/') -or $relative -match '(^|/)\.\.?(/|$)|//|/$') { throw '回滚相对路径无效。' }
    $full = Ordinary (Join-Path $root $relative.Replace('/', '\'))
    if (-not $full.StartsWith($root.TrimEnd('\') + '\', $cmp)) { throw '回滚路径越界。' }
    return $full
}
function Sha([string]$path) { return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Parent([string]$path) { $directory = Ordinary ([System.IO.Path]::GetDirectoryName($path)); if (-not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null } }
$backup = (Ordinary $PSScriptRoot).TrimEnd('\')
$manifestPath = Contained $backup 'deployment.json'
$m = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($m.schemaVersion -ne 1 -or $m.kind -ne 'agent-workspace' -or $m.version -ne '2.5.0' -or $m.backupRoot -ine $backup) { throw '部署清单格式或备份位置无效。' }
$install = (Ordinary $m.installationRoot).TrimEnd('\')
$app = Contained $install 'data/harness/apps/dsh-tavern'
if ($m.appRoot -ine $app -or -not (Test-Path -LiteralPath $app -PathType Container)) { throw '运行目录不符合部署清单。' }
$expectedBackupParent = Contained $install 'temp'
if ([System.IO.Path]::GetDirectoryName($backup) -ine $expectedBackupParent -or [System.IO.Path]::GetFileName($backup) -notmatch '^agent-workspace-deploy-[0-9]{8}-[0-9]{6}-[0-9a-f]{32}$') { throw '备份目录不属于此安装。' }
if (@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($install + '\runtime-', $cmp) -and $_.CommandLine -and $_.CommandLine.IndexOf($app, $cmp) -ge 0 }).Count) { throw '此安装仍在运行，请先停止。' }
if (@(Get-NetTCPConnection -LocalPort 43120 -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -in @('127.0.0.1', '::1', '0.0.0.0', '::') }).Count) { throw 'TCP 43120 仍在监听，请先停止。' }
$entries = @($m.files)
if (-not $entries.Count) { throw '部署清单没有文件。' }
$seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
foreach ($entry in $entries) {
    if ($entry.relativePath -notmatch '^(presets/dream-sike-dsh/.+|tavern-plugin/lib/.+)$' -or -not $seen.Add($entry.relativePath) -or $entry.operation -notin @('replace', 'create') -or $entry.deployedSha256 -notmatch '^[0-9a-f]{64}$') { throw '部署文件记录无效。' }
    $target = Contained $app $entry.relativePath
    if ($entry.operation -eq 'replace') {
        if ($entry.originalSha256 -notmatch '^[0-9a-f]{64}$' -or $entry.backupRelativePath -ne ('originals/' + $entry.relativePath)) { throw '原文件备份记录无效。' }
        $original = Contained $backup $entry.backupRelativePath
        if (-not (Test-Path -LiteralPath $original -PathType Leaf) -or (Sha $original) -ne $entry.originalSha256) { throw "原文件备份损坏：$($entry.relativePath)" }
        if (-not (Test-Path -LiteralPath $target -PathType Leaf) -or (Sha $target) -notin @($entry.originalSha256, $entry.deployedSha256)) { throw "目标文件已被其他修改改变：$($entry.relativePath)" }
    } elseif (Test-Path -LiteralPath $target) {
        if (-not (Test-Path -LiteralPath $target -PathType Leaf) -or (Sha $target) -ne $entry.deployedSha256) { throw "新增文件已被其他修改改变：$($entry.relativePath)" }
    }
}
if ($m.inventory.backupRelativePath -ne 'originals/.dsh-tavern-files.txt' -or $m.inventory.originalSha256 -notmatch '^[0-9a-f]{64}$' -or $m.inventory.deployedSha256 -notmatch '^[0-9a-f]{64}$') { throw '安装清单备份记录无效。' }
$inventory = Contained $app '.dsh-tavern-files.txt'
$originalInventory = Contained $backup $m.inventory.backupRelativePath
if (-not (Test-Path -LiteralPath $originalInventory -PathType Leaf) -or (Sha $originalInventory) -ne $m.inventory.originalSha256) { throw '安装清单备份损坏。' }
if (-not (Test-Path -LiteralPath $inventory -PathType Leaf) -or (Sha $inventory) -notin @($m.inventory.originalSha256, $m.inventory.deployedSha256)) { throw '安装清单已被其他修改改变。' }
if (-not $PSCmdlet.ShouldProcess($app, '验证部署 SHA 并恢复原文件，移除此次新增普通文件')) { return }
$attempt = 'rollback-' + [guid]::NewGuid().ToString('N')
foreach ($entry in $entries) {
    $target = Contained $app $entry.relativePath
    if ($entry.operation -eq 'replace') {
        if ((Sha $target) -eq $entry.originalSha256) { continue }
        if ((Sha $target) -ne $entry.deployedSha256) { throw '回滚期间目标发生变化。' }
        $staged = Contained $backup ($attempt + '/staged/' + $entry.relativePath)
        $displaced = Contained $backup ($attempt + '/displaced/' + $entry.relativePath)
        Parent $staged; Parent $displaced
        Copy-Item -LiteralPath (Contained $backup $entry.backupRelativePath) -Destination $staged
        if ((Sha $staged) -ne $entry.originalSha256) { throw '恢复暂存文件校验失败。' }
        [System.IO.File]::Replace($staged, $target, $displaced)
        if ((Sha $target) -ne $entry.originalSha256) { throw '恢复文件校验失败。' }
    } elseif (Test-Path -LiteralPath $target) {
        if (-not (Test-Path -LiteralPath $target -PathType Leaf) -or (Sha $target) -ne $entry.deployedSha256) { throw '移除前新增文件发生变化。' }
        $displaced = Contained $backup ($attempt + '/displaced/' + $entry.relativePath)
        Parent $displaced
        Copy-Item -LiteralPath $target -Destination $displaced
        if ((Sha $displaced) -ne $entry.deployedSha256) { throw '新增文件证据备份失败。' }
        $target = Contained $app $entry.relativePath
        if ((Sha $target) -ne $entry.deployedSha256) { throw '新增文件在移除前发生变化。' }
        Remove-Item -LiteralPath $target
    }
}
if ((Sha $inventory) -ne $m.inventory.originalSha256) {
    if ((Sha $inventory) -ne $m.inventory.deployedSha256) { throw '回滚期间安装清单变化。' }
    $staged = Contained $backup ($attempt + '/staged/.dsh-tavern-files.txt')
    $displaced = Contained $backup ($attempt + '/displaced/.dsh-tavern-files.txt')
    Parent $staged; Parent $displaced
    Copy-Item -LiteralPath $originalInventory -Destination $staged
    if ((Sha $staged) -ne $m.inventory.originalSha256) { throw '安装清单恢复暂存校验失败。' }
    [System.IO.File]::Replace($staged, $inventory, $displaced)
}
if ((Sha $inventory) -ne $m.inventory.originalSha256) { throw '安装清单恢复失败。' }
$m.status = 'rolled-back'
$m | Add-Member -NotePropertyName rolledBackAt -NotePropertyValue (Get-Date).ToString('o') -Force
[System.IO.File]::WriteAllText($manifestPath, ($m | ConvertTo-Json -Depth 12) + "`n", [System.Text.UTF8Encoding]::new($false))
Write-Output "回滚完成；备份与部署证据保留：$backup"
'@
$rollbackPath = Get-Contained $backupRoot 'rollback.ps1'
[System.IO.File]::WriteAllText($rollbackPath, $rollbackSource + "`n", $utf8)
$applied = 0
try {
    $backupInventory = Get-Contained $backupRoot 'originals/.dsh-tavern-files.txt'
    New-Parent $backupInventory
    Copy-Item -LiteralPath $inventoryPath -Destination $backupInventory
    if ((Get-Sha $backupInventory) -ne $inventorySha) { throw '安装清单备份校验失败。' }
    foreach ($entry in $files) {
        $target = Get-Contained $appRoot $entry.relativePath
        if ($entry.operation -eq 'replace') {
            $backup = Get-Contained $backupRoot $entry.backupRelativePath
            New-Parent $backup
            Copy-Item -LiteralPath $target -Destination $backup
            if ((Get-Sha $backup) -ne $entry.originalSha256) { throw "备份校验失败：$($entry.relativePath)" }
        }
        $staged = Get-Contained $backupRoot ('staged/' + $entry.relativePath)
        New-Parent $staged
        Copy-Item -LiteralPath (Get-Contained $repoRoot $entry.relativePath) -Destination $staged
        if ((Get-Sha $staged) -ne $entry.deployedSha256) { throw "暂存校验失败：$($entry.relativePath)" }
    }
    $stagedInventory = Get-Contained $backupRoot 'staged/.dsh-tavern-files.txt'
    [System.IO.File]::WriteAllText($stagedInventory, $nextInventory, $utf8)
    if ((Get-Sha $stagedInventory) -ne $nextInventorySha) { throw '安装清单暂存校验失败。' }
    Assert-Stopped
    foreach ($entry in $files) {
        $target = Get-Contained $appRoot $entry.relativePath
        $staged = Get-Contained $backupRoot ('staged/' + $entry.relativePath)
        New-Parent $target
        if ($entry.operation -eq 'replace') {
            if ((Get-Sha $target) -ne $entry.originalSha256) { throw "安装文件在部署期间变化：$($entry.relativePath)" }
            $displaced = Get-Contained $backupRoot ('replaced/' + $entry.relativePath)
            New-Parent $displaced
            [System.IO.File]::Replace($staged, $target, $displaced)
        } else {
            if (Test-Path -LiteralPath $target) { throw "新增文件在部署期间出现：$($entry.relativePath)" }
            [System.IO.File]::Move($staged, $target)
        }
        $applied += 1
        if ((Get-Sha $target) -ne $entry.deployedSha256) { throw "部署校验失败：$($entry.relativePath)" }
    }
    if ((Get-Sha $inventoryPath) -ne $inventorySha) { throw '安装清单在部署期间变化。' }
    $displacedInventory = Get-Contained $backupRoot 'replaced/.dsh-tavern-files.txt'
    New-Parent $displacedInventory
    [System.IO.File]::Replace($stagedInventory, $inventoryPath, $displacedInventory)
    $applied += 1
    if ((Get-Sha $inventoryPath) -ne $nextInventorySha) { throw '部署后的安装清单校验失败。' }
    $manifest.status = 'deployed'
    $manifest.deployedAt = (Get-Date).ToString('o')
    Save-Manifest
    Write-Output "部署完成。回滚入口：& '$rollbackPath'"
} catch {
    $deploymentError = $_
    $manifest.status = 'failed'
    $manifest.error = $deploymentError.Exception.Message
    Save-Manifest
    if ($applied -gt 0) {
        try { & $rollbackPath -Confirm:$false }
        catch {
            $manifest.status = 'rollback-failed'
            $manifest.rollbackError = $_.Exception.Message
            Save-Manifest
            Write-Warning "自动回滚未完成：$($_.Exception.Message)；备份和证据保留于 $backupRoot"
        }
    }
    throw $deploymentError
}
