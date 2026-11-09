$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$python = Join-Path $root ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
    $python = Join-Path $root "ai-service\.venv\Scripts\python.exe"
}
if (-not (Test-Path $python)) {
    $existingProjectPython = "D:\og tracemate\TraceMate-Merged-Original-CNN\.venv\Scripts\python.exe"
    if (Test-Path $existingProjectPython) { $python = $existingProjectPython }
}
if (-not (Test-Path $python)) {
    throw "Project Python environment was not found. Expected .venv\Scripts\python.exe. This repair script will not modify your global Python installation."
}
Write-Host "Using project Python: $python" -ForegroundColor Cyan
Write-Host "Checking imports before changing packages..." -ForegroundColor Yellow
& $python -c "import transformers; print('transformers', transformers.__version__, transformers.__file__); import transformers.utils; print('transformers.utils OK'); from transformers import CLIPModel, CLIPProcessor; print('CLIP imports OK')"
if ($LASTEXITCODE -eq 0) {
    & $python -c "import sentence_transformers; print('sentence-transformers', sentence_transformers.__version__)"
    if ($LASTEXITCODE -eq 0) {
        Write-Host "AI package imports are healthy. No reinstall needed." -ForegroundColor Green
        exit 0
    }
}
Write-Host "Repairing broken/incompatible Transformers installation in the project environment..." -ForegroundColor Yellow
& $python -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "pip upgrade failed. Check internet access and retry." }
# Transformers 5.x is intentionally excluded because this project uses the Transformers 4.x CLIP API.
& $python -m pip install --no-cache-dir --force-reinstall "transformers>=4.45,<5.0" "sentence-transformers>=3.0,<6.0"
if ($LASTEXITCODE -ne 0) { throw "Dependency repair failed. Keep the project folder and share the final pip error; do not delete the virtual environment." }
Write-Host "Validating repaired imports..." -ForegroundColor Yellow
& $python -c "import transformers; print('transformers', transformers.__version__, transformers.__file__); import transformers.utils; from transformers import CLIPModel, CLIPProcessor; import sentence_transformers; print('transformers.utils: OK'); print('CLIP imports: OK'); print('sentence-transformers', sentence_transformers.__version__)"
if ($LASTEXITCODE -ne 0) { throw "Packages installed but import validation still failed. Do not delete the project. Save and share this error output." }
Write-Host "Dependency repair succeeded. Restart TraceMate AI using start-ai-service.ps1 or start-tracemate.ps1." -ForegroundColor Green
