param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectPath
)

$ErrorActionPreference = "Stop"
$ProjectPath = [System.IO.Path]::GetFullPath($ProjectPath)

if (-not (Test-Path -LiteralPath $ProjectPath -PathType Container)) {
    throw "Project folder not found: $ProjectPath"
}
if (-not (Test-Path -LiteralPath (Join-Path $ProjectPath "server.js"))) {
    throw "server.js was not found in the target folder. Check -ProjectPath."
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupRoot = Join-Path $ProjectPath ".tracemate-fix-backup-$timestamp"
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null

$relativeFiles = @(
    "server.js",
    "src\advanced-cnn\cnnBridge.js",
    "src\advanced-cnn\nlpBridge.js",
    "src\advanced-cnn\aiServiceUrl.js",
    "ai-service\app.py",
    "tests\ai-image-data-url.test.js"
)

foreach ($relative in $relativeFiles) {
    $source = Join-Path $PSScriptRoot $relative
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Patch file is missing: $source"
    }

    $destination = Join-Path $ProjectPath $relative
    $backup = Join-Path $backupRoot $relative
    $destinationParent = Split-Path -Parent $destination
    $backupParent = Split-Path -Parent $backup

    New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null
    New-Item -ItemType Directory -Path $backupParent -Force | Out-Null

    if (Test-Path -LiteralPath $destination -PathType Leaf) {
        Copy-Item -LiteralPath $destination -Destination $backup -Force
    }

    Copy-Item -LiteralPath $source -Destination $destination -Force
    Write-Host "Patched: $relative" -ForegroundColor Green
}

Write-Host ""
Write-Host "Patch applied. Backups are here:" -ForegroundColor Cyan
Write-Host $backupRoot
Write-Host "Your data/db.json and .env files were not changed."
Write-Host "Restart Node.js and Python before testing."
