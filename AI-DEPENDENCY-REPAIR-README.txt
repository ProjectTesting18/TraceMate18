TRACEMATE AI DEPENDENCY REPAIR (Windows PowerShell)

1. Keep your existing project folder and make a backup before replacing any files.
2. Extract this ZIP into a NEW folder.
3. Open PowerShell in the extracted project root.
4. Run: Set-ExecutionPolicy -Scope Process Bypass
5. Run: .\repair-ai-dependencies.ps1
6. If imports pass, run: .\start-ai-service.ps1
   The project launcher uses the project virtual environment and port 8001.
7. In another PowerShell window, test: Invoke-RestMethod http://127.0.0.1:8001/health

IMPORTANT
- This script targets the project's .venv and does not alter global Python.
- It reinstalls Transformers 4.x because the current project code imports the 4.x CLIP API.
- Model weights may need internet access on first startup.
- If the repair fails, keep the console output. Do not delete .venv or the original project.
- A healthy API does not guarantee downloaded SBERT/CLIP model weights have finished loading.
- MongoDB/backend/browser end-to-end workflow has not been verified by this package build.
