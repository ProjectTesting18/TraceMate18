$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$aiDir = Join-Path $root "ai-service"
$localVenvPython = Join-Path $aiDir ".venv\Scripts\python.exe"
$venvPython = $localVenvPython
$usingExternalPython = $false
$logsDir = Join-Path $root "logs"

function Test-HttpEndpoint([string]$Url) {
    try {
        $response = Invoke-RestMethod -Uri $Url -TimeoutSec 3 -ErrorAction Stop
        return $response
    } catch {
        return $null
    }
}

Set-Location $root

Write-Host "=== TraceMate startup ===" -ForegroundColor Cyan

# Prepare the private local configuration without overwriting an existing .env.
if (-not (Test-Path (Join-Path $root ".env"))) {
    Copy-Item (Join-Path $root ".env.example") (Join-Path $root ".env")
    Write-Host "Created .env from .env.example. Change ADMIN_PASSWORD before real use." -ForegroundColor Yellow
}

# Ensure the Python environment includes SBERT, MobileNetV2, and CLIP dependencies.
# Prefer the extracted project's own environment. If it does not exist, reuse a verified
# existing TraceMate environment when available; this avoids Windows Store python.exe aliases
# and avoids reinstalling large AI packages unnecessarily.
if (-not (Test-Path $venvPython)) {
    $pythonCandidates = @(
        $env:TRACEMATE_PYTHON,
        "D:\og tracemate\TraceMate-Merged-Original-CNN\.venv\Scripts\python.exe"
    )
    $existingPython = $pythonCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    if ($existingPython) {
        $venvPython = $existingPython
        $usingExternalPython = $true
        Write-Host "Using existing Python environment: $venvPython" -ForegroundColor Green
    } else {
        Write-Host "Creating the AI Python environment..." -ForegroundColor Yellow
        $launcher = Get-Command py.exe -ErrorAction SilentlyContinue
        if (-not $launcher) { $launcher = Get-Command py -ErrorAction SilentlyContinue }
        if (-not $launcher) {
            throw "Python launcher 'py' was not found. Install Python 3.11/3.12, or set TRACEMATE_PYTHON to a working Python executable."
        }
        $created = $false
        foreach ($version in @("-3.12", "-3.11", "-3.14")) {
            & $launcher.Source $version -m venv (Join-Path $aiDir ".venv") 2>$null
            if ($LASTEXITCODE -eq 0 -and (Test-Path $localVenvPython)) { $created = $true; break }
        }
        if (-not $created) {
            throw "Could not create ai-service\.venv using Python launcher. Install Python 3.11/3.12 or set TRACEMATE_PYTHON to a working interpreter."
        }
        $venvPython = $localVenvPython
    }
}

Write-Host "Checking AI dependencies (SBERT + MobileNetV2 + CLIP)..." -ForegroundColor Yellow
& $venvPython -c "import fastapi, uvicorn, PIL, numpy, sentence_transformers, torch, torchvision, transformers" 2>$null
$dependenciesReady = ($LASTEXITCODE -eq 0)
if (-not $dependenciesReady) {
    if ($usingExternalPython) {
        throw "The existing Python environment is missing required AI packages. To avoid changing your original environment, install the project's requirements in ai-service\.venv or set TRACEMATE_PYTHON to a compatible environment."
    }
    Write-Host "Installing required AI dependencies; this may take several minutes on first run..." -ForegroundColor Yellow
    & $venvPython -m pip install --upgrade pip
    if ($LASTEXITCODE -ne 0) { throw "pip upgrade failed. Check internet access and the Python installation." }
    & $venvPython -m pip install -r (Join-Path $aiDir "requirements.txt")
    if ($LASTEXITCODE -ne 0) {
        throw "AI dependency installation failed. TraceMate was not started with incomplete AI dependencies. Review the pip error above."
    }
} else {
    Write-Host "Required AI packages are already installed." -ForegroundColor Green
}

New-Item -ItemType Directory -Force -Path $logsDir | Out-Null
$aiStdout = Join-Path $logsDir "ai-service.log"
$aiStderr = Join-Path $logsDir "ai-service-error.log"
$aiHealthUrl = "http://127.0.0.1:8001/health"
$aiHealth = Test-HttpEndpoint $aiHealthUrl

if ($null -ne $aiHealth -and $aiHealth.success -eq $true) {
    if ($aiHealth.version -ne "1.2.0") {
        throw "Port 8001 is serving an older TraceMate AI version (version field missing or not 1.2.0). Stop the old AI service with Ctrl+C in its original PowerShell window, then rerun this launcher so the updated automatic model startup is used."
    }
    Write-Host "Updated TraceMate AI service already responds on port 8001; reusing it." -ForegroundColor Green
} else {
    # Detect a port conflict separately so we don't silently use an unrelated service.
    $listener = Get-NetTCPConnection -LocalPort 8001 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) {
        throw "Port 8001 is already occupied, but it is not responding as TraceMate AI. Close the unrelated process or change AI_SERVICE_URL/port."
    }

    Write-Host "Starting AI service in the background..." -ForegroundColor Yellow
    $aiProcess = Start-Process -FilePath $venvPython `
        -ArgumentList @("-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", "8001") `
        -WorkingDirectory $aiDir `
        -WindowStyle Hidden `
        -RedirectStandardOutput $aiStdout `
        -RedirectStandardError $aiStderr `
        -PassThru

    $deadline = (Get-Date).AddMinutes(2)
    do {
        Start-Sleep -Seconds 2
        $aiHealth = Test-HttpEndpoint $aiHealthUrl
        if ($null -ne $aiHealth -and $aiHealth.success -eq $true) { break }
        if ($aiProcess.HasExited) {
            $tail = if (Test-Path $aiStderr) { (Get-Content $aiStderr -Tail 30) -join "`n" } else { "No AI error log was created." }
            throw "TraceMate AI service exited before health check passed. Error log: $aiStderr`n$tail"
        }
    } while ((Get-Date) -lt $deadline)

    if ($null -eq $aiHealth -or $aiHealth.success -ne $true) {
        throw "TraceMate AI service did not become healthy within 2 minutes. Check logs\ai-service-error.log and logs\ai-service.log."
    }
}

Write-Host "AI API is responding. Model downloads/warm-up continue in the background; check http://127.0.0.1:8001/health for loading/ready status." -ForegroundColor Green

# Reuse a working backend if one is already running instead of causing EADDRINUSE.
$backendHealth = Test-HttpEndpoint "http://127.0.0.1:5000/api/health"
if ($null -ne $backendHealth) {
    if ($backendHealth.release -ne "TraceMate-Complete-Fixed-v10") {
        throw "Port 5000 is serving an older/unidentified TraceMate backend. Stop the old backend with Ctrl+C in its original PowerShell window, then rerun this launcher so the v7 code is used."
    }
    Write-Host "TraceMate v7 backend already responds on port 5000. Open http://127.0.0.1:5000" -ForegroundColor Green
    exit 0
}
$backendListener = Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($backendListener) {
    throw "Port 5000 is occupied by a process that did not respond as TraceMate. Close that process before starting the backend."
}

if (-not (Test-Path (Join-Path $root "node_modules"))) {
    Write-Host "Installing Node dependencies..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed; TraceMate backend was not started." }
}

Write-Host "Starting TraceMate backend on http://127.0.0.1:5000 ..." -ForegroundColor Green
Write-Host "AI service logs: $aiStdout and $aiStderr" -ForegroundColor DarkGray
npm start
if ($LASTEXITCODE -ne 0) { throw "TraceMate backend exited with code $LASTEXITCODE." }
