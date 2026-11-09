$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$aiDir = Join-Path $root "ai-service"

# Prefer the environment already used by this project. Do not rely on the
# WindowsApps python.exe alias, which can point to the Microsoft Store.
$candidates = @(
    $env:TRACEMATE_PYTHON,
    (Join-Path $root ".venv\Scripts\python.exe"),
    (Join-Path $aiDir ".venv\Scripts\python.exe"),
    "D:\og tracemate\TraceMate-Merged-Original-CNN\.venv\Scripts\python.exe"
)
$python = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if (-not $python) {
    $launcher = Get-Command py.exe -ErrorAction SilentlyContinue
    if (-not $launcher) { $launcher = Get-Command py -ErrorAction SilentlyContinue }
    if (-not $launcher) {
        throw "No Python interpreter found. Install Python or set TRACEMATE_PYTHON to the full path of a working python.exe."
    }
    $python = Join-Path $root ".venv\Scripts\python.exe"
    foreach ($version in @("-3.14", "-3.12", "-3.11")) {
        & $launcher.Source $version -m venv (Join-Path $root ".venv") 2>$null
        if ($LASTEXITCODE -eq 0 -and (Test-Path $python)) { break }
    }
    if (-not (Test-Path $python)) {
        throw "Could not create a project virtual environment. Set TRACEMATE_PYTHON to a working Python executable."
    }
}

Write-Host "Using Python: $python" -ForegroundColor Green
Write-Host "Checking FastAPI, SBERT, MobileNetV2, and CLIP imports..." -ForegroundColor Yellow
& $python -c "import fastapi, uvicorn, PIL, numpy, sentence_transformers, torch, torchvision; from transformers import CLIPModel, CLIPProcessor; print('All required AI imports succeeded')"
if ($LASTEXITCODE -ne 0) {
    $isExternal = $python -ne (Join-Path $root ".venv\Scripts\python.exe") -and $python -ne (Join-Path $aiDir ".venv\Scripts\python.exe")
    if ($isExternal) {
        throw "The selected existing Python environment is missing one or more AI dependencies. To avoid changing that environment automatically, install the dependencies into the project venv or set TRACEMATE_PYTHON to the correct interpreter."
    }
    Write-Host "Installing AI requirements into the selected project environment..." -ForegroundColor Yellow
    & $python -m pip install --upgrade pip
    if ($LASTEXITCODE -ne 0) { throw "Could not upgrade pip; see the error above." }
    & $python -m pip install -r (Join-Path $aiDir "requirements.txt")
    if ($LASTEXITCODE -ne 0) { throw "AI dependency installation failed; the service was not started." }
    & $python -c "import fastapi, uvicorn, PIL, numpy, sentence_transformers, torch, torchvision; from transformers import CLIPModel, CLIPProcessor"
    if ($LASTEXITCODE -ne 0) { throw "AI dependencies still fail to import after installation." }
}

Write-Host "Starting TraceMate AI on http://127.0.0.1:8001 ..." -ForegroundColor Green
Write-Host "SBERT, MobileNetV2, and CLIP warm up automatically. They may show loading=true briefly." -ForegroundColor Yellow
Set-Location $root
& $python -m uvicorn app:app --app-dir $aiDir --host 127.0.0.1 --port 8001
if ($LASTEXITCODE -ne 0) { throw "TraceMate AI exited with code $LASTEXITCODE." }
