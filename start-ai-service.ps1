$ErrorActionPreference = "Stop"
# Use the project-root Python selection/preflight logic so this entry point and
# run-ai-service.ps1 behave the same way regardless of the current directory.
& (Join-Path $PSScriptRoot "run-ai-service.ps1")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
