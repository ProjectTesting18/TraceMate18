$ErrorActionPreference = "Stop"
# Backward-compatible entry point: starting the backend now starts the AI service too.
& (Join-Path $PSScriptRoot "start-tracemate.ps1")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
