# Start Here — TraceMate Final Guide

This guide consolidates the startup/setup notes found in the supplied archive. Check the actual scripts and package files in this project before running commands.

## Source startup documents
- `RUN-AI-SERVICE.md`
- `START-HERE-COMPLETE-v6.md`
- `START-HERE-FINAL.md`
- `START-HERE-TraceMate-Fixed-v11.md`
- `START-HERE-TraceMate-Fixed-v3.md`
- `START-HERE-TraceMate-Fixed-v5.md`
- `START-HERE-TraceMate-Fixed-v6.md`
- `START-HERE-TraceMate-Fixed-v7.md`
- `START-HERE-TraceMate-Fixed-v8.md`
- `START-HERE-TraceMate-Visual-Score-Fix.md`
- `START-HERE-V17.md`
- `STARTUP-AI-MODELS-FIX.md`
- `STARTUP-PYTHON-FIX.md`
- `STEP-1-CNN-MONGODB.md`

## Recommended setup sequence

1. Install the Node.js and Python versions specified by the project manifests and requirements files.
2. Review configuration templates. Create a local `.env` only if required; never share real secrets.
3. Install Node dependencies using the package manager and lockfile included in the project.
4. Install AI-service Python dependencies from the applicable requirements file.
5. Start the Node.js server using the documented `package.json` script or the project startup script.
6. Start the Python AI service if the app expects it, then check its health endpoint before testing AI matching.
7. Test lost-item and found-item submission, admin matching, and reviewing/confirming matches.
8. Back up `data/db.json` before any data reset or migration.

## Safety and verification notes

- Do not run `reset-data.js` unless you intend to reset data and have a backup.
- Previously observed logs indicated local JSON storage and said MongoDB was not required; verify against the current code/configuration before setup.
- The presence of a model file does not prove inference works. Test model loading and the AI health endpoint.
- A successful ZIP integrity check is not proof that the application runs end-to-end.

## Original startup instructions

---

### Source: `RUN-AI-SERVICE.md`

# Start the TraceMate AI service (Windows PowerShell)

Run this from the project root (the folder containing `server.js`):

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
.\run-ai-service.ps1
```

The script prefers the project `.venv`, then `ai-service\.venv`, then `TRACEMATE_PYTHON`, and finally the previously used TraceMate environment if it exists. It checks imports for FastAPI, SBERT, PyTorch, torchvision, and `CLIPModel`/`CLIPProcessor` before starting Uvicorn. It avoids the Microsoft Store `python.exe` alias.

The Python service automatically starts background warm-up for SBERT (`all-MiniLM-L6-v2`), MobileNetV2, and CLIP (`openai/clip-vit-base-patch32`). The health endpoint can respond while model downloads/warm-up continue. Wait until all three model objects report `available: true`, `initialized: true`, and `loading: false`:

```powershell
Invoke-RestMethod http://127.0.0.1:8001/health | ConvertTo-Json -Depth 8
```

Start the Node backend in a second PowerShell window:

```powershell
node server.js
```

Then open `http://127.0.0.1:5000`. If the AI health endpoint reports an error, inspect the Python/Uvicorn terminal first; do not assume the AI models are ready just because the HTTP service responds.

---

### Source: `START-HERE-COMPLETE-v6.md`

# TraceMate Complete Bundle v7 — Start Here

This ZIP is the updated complete source bundle with matching safety fixes, admin candidate-selection diagnostics, automatic SBERT/MobileNetV2/CLIP startup, and corrected cosine-score scaling. It is not a guarantee of live behavior on every PC: run the included tests and verify the app locally.

## 1. Keep your data safe

1. Stop your currently running TraceMate Node server (`Ctrl+C`).
2. Extract this ZIP into a **new folder**, for example `D:\TraceMate-v6-Complete`.
3. Do not delete your old project. Keep your original `data\db.json` and `.env` backed up.
4. If you need your existing reports/accounts, copy your old `data\db.json` into the new folder's `data` folder after backing it up. Do not run `npm run reset:data` unless you intentionally want to erase/reset the data.
5. Review `.env.example` and create a local `.env` with a strong admin password and any required local settings. Never share your real `.env`.

## 2. Install and test the Node app (PowerShell)

Open PowerShell in the extracted project root:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
npm install
node --check .\server.js
node --check .\src\advanced-cnn\matchingServiceCompat.js
node --check .\js\admin.js
npm test
```

## 3. Start the complete application (recommended)

Open PowerShell in the project root and run just this one command:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\start-tracemate.ps1
```

The launcher prepares the Python environment, installs both NLP and computer-vision dependencies, starts the AI service in the background, then starts the Node backend. The older `start-backend.ps1` command is retained as an alias to the same complete startup flow.

Open `http://127.0.0.1:5000` in your browser. This bundle uses the local JSON database by default; MongoDB is not required for this configuration.

The AI service automatically begins loading SBERT (`all-MiniLM-L6-v2`), MobileNetV2, and CLIP (`openai/clip-vit-base-patch32`) as soon as it starts. Loading/downloads run in the background so the health endpoint can respond while models initialize. Check `http://127.0.0.1:8001/health` and `http://127.0.0.1:8001/cv/health`; each model reports `loading`, `initialized`, `available`, and/or an error. First startup requires internet access to download missing packages and pretrained model weights. The local fallback remains available when SBERT cannot load; MobileNetV2 and CLIP may be unavailable until their dependencies/weights are successfully installed.

To run only the Python service for troubleshooting, use `start-ai-service.ps1` in a separate PowerShell window.

## 5. Verify admin AI matching

1. Sign in as admin and open AI Matches for a found item.
2. In the Node server terminal, look for log lines beginning with `[TraceMate][AdminMatches]`.
3. The bundle logs source/candidate counts, hard-conflict counts and details, selected candidates, review-only fallback, and final result counts.
4. A candidate with a genuine hard identity/object conflict must not be automatically confirmable. A high numeric score is a similarity score, not proof that two records refer to the same physical item.

## What the diagnostics include

- Found-item ID and candidate counts.
- Hard-conflict candidate IDs/names, score, conflict flags, object-family labels, brand-conflict flag, and a few reason strings.
- No full image embeddings or full item descriptions are logged.

## Important limitations

- Automated tests validate the included test cases, not every live database record or every model prediction.
- Keep uncertain visual predictions and inconsistent evidence in manual review.
- If the project already has real data, preserve it by copying your backed-up `data\db.json` as described above.

---

### Source: `START-HERE-FINAL.md`

# TraceMate — Final Working Build (29 Oct 2026)

## Ports
- Website/backend: `http://127.0.0.1:5000`
- AI API: `http://127.0.0.1:8000`
- AI health: `http://127.0.0.1:8000/health`

## Start on Windows
1. Extract this complete folder somewhere writable, for example `D:\TraceMate`.
2. Install Node.js (LTS), Python 3.11 or 3.12, and MongoDB if your current `.env`/deployment uses a local MongoDB instance.
3. Open PowerShell in the extracted folder.
4. Run `Set-ExecutionPolicy -Scope Process Bypass` if PowerShell blocks local scripts.
5. Run `.\start-tracemate.ps1` (without the leading space).
6. Open `http://127.0.0.1:5000`.

The launcher prepares the AI Python environment and installs its requirements on first run, then starts/checks the AI service on port 8000 and the web backend on port 5000. First startup can take time while packages/model weights are downloaded. Check `http://127.0.0.1:8000/health` for AI model readiness.

## Manual service start
- AI service: `.\run-ai-service.ps1` (from the project folder)
- Website/backend: `npm install` then `npm start`

## Fixes included
- Consistent AI API port 8000 in backend bridges, AI app configuration, PowerShell launchers and docs.
- Repeated legacy HTML entity decoding in AI-match titles, explanations, and review/score-cap reasons, with HTML escaping retained at output sites.
- Existing responsive CSS, mobile table horizontal scrolling, viewport setup, and compact/mobile layouts retained.
- Existing matching safeguards and conservative score-cap/manual-review rules retained; this build does not inflate match scores to hide uncertainty.

## Notes
- The web backend uses port 5000; only the AI service was moved from 8001 to 8000. If you meant every process must share port 8000, that would require changing the backend architecture because two services cannot both listen on the same host/port.
- Never expose `.env` or reuse a default admin password in a public deployment.

---

### Source: `START-HERE-TraceMate-Fixed-v11.md`

# TraceMate v11 — visual-confidence score-cap correction

## What changed
- A low-confidence visual object prediction still triggers manual review.
- Low visual confidence alone no longer triggers a 69% score cap in the admin UI when object-type property evidence is positive.
- The defensive UI cap remains for explicit unresolved/zero object-type evidence.
- The matching engine retains the unresolved-object cap and hard object-family/identity conflict protections.
- NLP/image-text bridge timeout defaults from the previous bundle are retained.

## Important: install and restart
1. Extract this ZIP into a NEW folder for testing.
2. Preserve your existing `.env` and `data/db.json`; neither should be replaced by this archive.
3. Install Node dependencies in the extracted project if needed: `npm install`.
4. Stop the old Node process (Ctrl+C in its terminal), then start Node from this extracted folder using `npm start`.
5. Restart the Python AI service too if you changed its code/configuration.
6. Hard-refresh the browser (Ctrl+F5) and retest the same lost/found pair.

A restart matters: a browser page or Node process running an older copy can keep showing the old 69% cap. If the backend has already returned `score: 69`, the UI cannot reconstruct a higher original score; the matching engine must be the updated file too.

## Validation
`npm test` was run against this bundle: 51 tests passed, 0 failed. This is automated regression coverage, not a full live end-to-end test with your local database and AI models.

---

### Source: `START-HERE-TraceMate-Fixed-v3.md`

# TraceMate fixed bundle — start here

This is a replacement source bundle based on the uploaded TraceMate code bundle. It preserves the original bundle's files and includes targeted fixes for the known matching/UI issues.

## Changes in this revision

- Recognizes **Sounce** as a brand in item text and recognizes **brush / cleaning brush** as object-type terms, so the Sounce brush reports can receive matching text-property evidence.
- Low-confidence visual object predictions recommend manual review without changing the numeric score or bypassing the high-confidence object-family rejection rule.
- Low-confidence disagreements between computer-vision color labels are described as unconfirmed rather than as a proven color conflict.
- The admin UI no longer says a score was capped at 100. It only shows a cap message when the actual cap is below 100.
- Manual-review copy is neutral: uncertain evidence prompts a human check; it does not automatically claim that evidence conflicts.
- Legacy HTML-encoded item names and descriptions are decoded for display, then HTML-escaped before insertion into the UI.
- Retains the AI-service health-check changes from the preceding fixed bundle and includes tests for lazy health checks.

## Before replacing files

1. Stop the Node and Python services.
2. Back up the current project, `.env`, and `data/db.json` separately.
3. Extract this ZIP into a **new folder first** and compare it with your current project.
4. Keep your existing `.env` and `data/db.json`; do not use `npm run reset:data`.
5. Install Python dependencies in the AI-service environment if needed.

## Start the services on Windows

From the project root, in separate PowerShell windows:

```powershell
# Window 1 — Node backend
node server.js
```

```powershell
# Window 2 — AI service; this script changes into ai-service before importing app.py
.\start-ai-service.ps1
```

If you start Uvicorn manually, run it from the `ai-service` directory:

```powershell
Set-Location .\ai-service
& "..\.venv\Scripts\python.exe" -m uvicorn app:app --host 127.0.0.1 --port 8001
```

The command above assumes the virtual environment is at the project root. If your environment is inside `ai-service\.venv`, use that interpreter instead.

## Tests run for this revision

- `node --test tests/*.test.js` — 25 passed, 0 failed.
- `node --check server.js` — passed.
- `node --check src/advanced-cnn/matchingServiceCompat.js` — passed.
- `node --check js/admin.js` — passed.
- `python -m py_compile ai-service/app.py ai-service/services/cnn_service.py ai-service/services/nlp_service.py ai-service/test_health_status.py` — passed.
- From `ai-service`: `python -m unittest test_health_status -v` — 2 passed.
- From `ai-service`: `python test_nlp.py` — passed.

These are code-level and local test results, not a guarantee that every model can run on every Windows installation. Model downloads, optional dependencies, ports, and local image data still depend on the target machine.

---

### Source: `START-HERE-TraceMate-Fixed-v5.md`

# TraceMate Fixed Bundle v5 — Start Here

This bundle includes the TraceMate application source, the JSON-backed Node backend, the FastAPI AI service, and regression tests. It does **not** include a live `data/db.json`, `.env`, `node_modules`, Python virtual environment, or downloaded AI model weights.

## Fixes in this bundle

- NLP requests no longer wait synchronously for the first Sentence-BERT model download. The API uses its TF-IDF/token-overlap fallback immediately while SBERT loads in a background thread, and can use SBERT on later requests if loading succeeds.
- The Node-to-Python NLP bridge has a longer timeout as a safety net.
- Image-similarity display handles missing photos, unavailable scores, and one-decimal percentages.
- `One Plus` and `OnePlus` normalize to the same brand; Vivo remains a distinct brand.
- Paper notebooks remain distinct from notebook computers; frontend object families include helmet, mouse, and brush.
- Admin match confirmation checks that the physical found item has been recorded as received. The server also enforces receipt before confirmation.
- Regression tests cover these behaviors.

## Start on Windows

Use two PowerShell terminals from this extracted folder.

### Terminal 1 — AI service

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\start-ai-service.ps1
```

Wait until Uvicorn reports that it is running at `http://127.0.0.1:8001`.

Check the service in a browser at:

- `http://127.0.0.1:8001/health`
- `http://127.0.0.1:8001/cv/health`

The health endpoint must not download/load the models. If Sentence-BERT is missing or cannot download its model, NLP matching still responds with the TF-IDF fallback.

### Terminal 2 — Node app

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\start-backend.ps1
```

Open `http://127.0.0.1:5000`.

MongoDB is not required; this bundle uses the JSON database by default. The first startup in a clean folder creates `data/db.json` automatically.

## Tests

```powershell
npm test
```

Python service tests (from project root):

```powershell
.\ai-service\.venv\Scripts\python.exe -m unittest discover -s ai-service -p "test_*.py" -v
```

If your virtual environment is named `.venv` at the project root instead, use that environment's Python interpreter.

## Important data safety

- Keep your original working project and its `data/db.json` as a backup.
- Extract this ZIP into a **new folder** first; do not overwrite your existing folder blindly.
- If you want to keep your current records, copy your original `data/db.json` into the new folder's `data` directory only after making a separate backup of it.
- Do not run `npm run reset:data` unless you intentionally want to reset data.
- Keep your actual `.env` private and set a strong admin password before deployment.

## Notes on AI scores

NLP and visual similarity are supporting signals, not proof that two reports describe the same physical item. Low-confidence object predictions and identity/property conflicts should remain reviewable by an admin. A successful test run validates the tested code paths; it does not guarantee model availability on every computer or prove end-to-end behavior against a live deployment.

---

### Source: `START-HERE-TraceMate-Fixed-v6.md`

# TraceMate Fixed Bundle v6 — Start Here

This bundle includes the TraceMate application source, the JSON-backed Node backend, the FastAPI AI service, and regression tests. It does **not** include a live `data/db.json`, `.env`, `node_modules`, Python virtual environment, or downloaded AI model weights.

## Fixes in this bundle

- NLP requests no longer wait synchronously for the first Sentence-BERT model download. The API uses its TF-IDF/token-overlap fallback immediately while SBERT loads in a background thread, and can use SBERT on later requests if loading succeeds.
- The Node-to-Python NLP bridge has a longer timeout as a safety net.
- Image-similarity display handles missing photos, unavailable scores, and one-decimal percentages.
- `One Plus` and `OnePlus` normalize to the same brand; Vivo remains a distinct brand.
- Paper notebooks remain distinct from notebook computers; frontend object families include helmet, mouse, and brush.
- Charging cables, chargers, wall adapters, and power cords normalize to one `charging_accessory` object type so multi-part charging kits are compared consistently.
- If visual object predictions are low-confidence and property extraction cannot establish an object-type match, the final candidate score is capped at 69 and the UI requires manual review instead of letting text/brand/color scores alone dominate.
- Admin match confirmation checks that the physical found item has been recorded as received. The server also enforces receipt before confirmation.
- Regression tests cover these behaviors, including the charging-cable/Vivo-adapter example and conservative scoring when object identity remains unresolved.

## Start on Windows

Use two PowerShell terminals from this extracted folder.

### Terminal 1 — AI service

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\start-ai-service.ps1
```

Wait until Uvicorn reports that it is running at `http://127.0.0.1:8001`.

Check the service in a browser at:

- `http://127.0.0.1:8001/health`
- `http://127.0.0.1:8001/cv/health`

The health endpoint must not download/load the models. If Sentence-BERT is missing or cannot download its model, NLP matching still responds with the TF-IDF fallback.

### Terminal 2 — Node app

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\start-backend.ps1
```

Open `http://127.0.0.1:5000`.

MongoDB is not required; this bundle uses the JSON database by default. The first startup in a clean folder creates `data/db.json` automatically.

## Tests

```powershell
npm test
```

Python service tests (from project root):

```powershell
.\ai-service\.venv\Scripts\python.exe -m unittest discover -s ai-service -p "test_*.py" -v
```

If your virtual environment is named `.venv` at the project root instead, use that environment's Python interpreter.

## Important data safety

- Keep your original working project and its `data/db.json` as a backup.
- Extract this ZIP into a **new folder** first; do not overwrite your existing folder blindly.
- If you want to keep your current records, copy your original `data/db.json` into the new folder's `data` directory only after making a separate backup of it.
- Do not run `npm run reset:data` unless you intentionally want to reset data.
- Keep your actual `.env` private and set a strong admin password before deployment.

## Notes on AI scores

NLP and visual similarity are supporting signals, not proof that two reports describe the same physical item. Low-confidence object predictions and identity/property conflicts should remain reviewable by an admin. A successful test run validates the tested code paths; it does not guarantee model availability on every computer or prove end-to-end behavior against a live deployment.

---

### Source: `START-HERE-TraceMate-Fixed-v7.md`

# TraceMate Fixed Bundle v7 — Start Here

This bundle contains the application source, JSON-backed Node backend, Python AI service, and regression tests. It intentionally excludes live `data/db.json`, `.env`, `node_modules`, Python virtual environments, downloaded model weights, and Git metadata.

## v7 targeted fix

- Added a conservative score cap for the charging cable / Vivo adapter case when visual object predictions are uncertain.
- Added a defensive admin-card guard: if the evidence card reports Object Type = 0% and the candidate has a review warning, the displayed score cannot remain above 69%. The UI explains that a score limit was applied.
- Supports both 0–1 and 0–100 object-confidence values from different AI service versions.
- Related cables, chargers, wall adapters, and power cords remain in one `charging_accessory` family so they are not automatically hard-rejected as unrelated objects.
- Added regression tests for the reported charging-kit scenario and the admin display guard.
- Retains v6 NLP background loading/fallback, longer bridge timeout, brand normalization, image formatting, notebook/laptop distinction, and receipt checks.

## IMPORTANT: install cleanly, do not extract over the old folder

1. Keep your existing project and `data/db.json` untouched as a backup.
2. Extract this ZIP into a **new folder**, for example `D:\TraceMate-v7`.
3. Start the AI service and Node backend from that new folder. Do not keep an old Node process running from the previous folder.
4. If you need your existing accounts/reports, stop the app, make a separate copy of your old `data/db.json`, then copy it into the new folder's `data` directory. Never replace it without a backup.
5. Do not run `npm run reset:data` if you want to preserve records.

## Start on Windows

Open two PowerShell terminals in this extracted folder.

### Terminal 1 — Python AI service

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\start-ai-service.ps1
```

Check `http://127.0.0.1:8001/health` and `http://127.0.0.1:8001/cv/health`.

### Terminal 2 — Node app

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\start-backend.ps1
```

Open `http://127.0.0.1:5000`.

MongoDB is not required for the JSON database setup. The first startup in a clean folder creates `data/db.json` automatically.

## Tests

From the project root:

```powershell
npm test
```

Python service tests (using your project virtual environment):

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s ai-service -p "test_*.py" -v
```

If your virtual environment is inside `ai-service`, use `ai-service\.venv\Scripts\python.exe` instead.

## Score interpretation

The candidate score is a ranking signal, not the probability that two reports concern the same physical item. A high text/image similarity cannot override unresolved object identity. If Object Type is 0% and visual evidence is uncertain, v7 caps the displayed candidate score at 69% and requires manual review.

Automated tests cover the code paths listed above. The full app still needs to be run from the clean extracted folder on your Windows computer to verify your actual environment and records.

---

### Source: `START-HERE-TraceMate-Fixed-v8.md`

# TraceMate Fixed v8 — Start Here

## What this version changes

- Keeps charging accessory **subtypes** separate in property evidence (`charging_cable`, `charger`, `power_adapter`) while preserving the broader compatibility family so related accessories are not automatically hard-rejected.
- Uses subtype-set overlap rather than broad-family identity to avoid displaying 100% object-type similarity merely because one charging-kit report lists a subset of the other report's components.
- Adds a defensive Admin UI score cap of 69 when low-confidence visual-object / unresolved-object-type warnings are present, even if an older or stale match payload reports a positive object-type score. The high-match summary uses the same effective score.
- Keeps the prior NLP timeout fallback and other matching/admin safeguards.

## Safe installation on Windows

1. Extract this ZIP to a **new folder**, for example `D:\TraceMate-v8`. Do not extract over an old folder or while a previous Node process is running.
2. Back up your existing `data\db.json` before migrating records. The ZIP intentionally excludes live database data and `.env` secrets.
3. If you need your existing records, copy your backed-up `data\db.json` into the new folder's `data` directory. Keep the backup until you confirm the new app works.
4. Install dependencies if needed (`npm install` from the project root), then start the Node backend using the project's documented start command.
5. Start the Python AI service in a separate terminal, following `CNN-CV-INTEGRATED.md` and `NLP-SBERT-SETUP.md`.
6. Open the app and regenerate/re-run the AI candidate search. Old stored candidate payloads may still show previous scores until recalculated.
7. Run `npm test` from the project root.

Do not run `npm run reset:data` unless you intentionally want to reset the database.

## Verification performed for this bundle

- Node regression suite: 50 passed, 0 failed.
- Python health tests: 2 passed.
- Python NLP test script: passed.
- Python syntax compilation: passed.
- `node --check` on modified JavaScript files: passed.

The automated tests and extracted source were verified in this environment; the complete app has not been tested against your specific live Windows database/session.

---

### Source: `START-HERE-TraceMate-Visual-Score-Fix.md`

# TraceMate visual-score adjustment

## Change included
`src/advanced-cnn/matchingServiceCompat.js` now adjusts the final score when a usable image similarity percentage is available:

`adjusted score = original score × (0.5 + 0.5 × visual similarity / 100)`

Examples before other score caps/penalties:
- visual similarity 100% -> score remains unchanged
- visual similarity 80% -> original score is multiplied by 0.90
- visual similarity 50% -> original score is multiplied by 0.75
- visual similarity 0% -> original score is multiplied by 0.50

If visual comparison is unavailable (`null`/missing), no visual adjustment is applied. Existing hard object-family rejection and contradiction penalties remain in place. A visual similarity percentage is a similarity signal, not proof that two reports concern the same physical item.

## Test result
`npm test`: 51 passed, 0 failed in the included package, after this change.

## Install safely
1. Stop the Node backend before replacing files.
2. Back up your current project and especially `data/db.json`.
3. Extract this ZIP into a **new folder** first, not over the live project.
4. Copy the changed `src/advanced-cnn/matchingServiceCompat.js` into the existing project, keeping the same relative path. This is the only runtime source file changed by the visual-score adjustment.
5. Do not replace `.env` or `data/db.json`; both are intentionally excluded from this ZIP.
6. Run `npm test`, restart the backend, then compare a known same-image pair and a known different-image pair.

The included test suite is unit/source-level coverage; the live UI and database workflow still need to be verified in your environment.

---

### Source: `START-HERE-V17.md`

# TraceMate Full Working Source — v17 Responsive + AI Match Fixes

This package combines the v16 full source project (AI candidate fallback, score-audit clarity, HTML-entity decoding/cache-busting, and AI startup scripts) with the responsive navigation/layout patch and a higher-specificity mobile admin-table overflow fix.

## Windows startup
1. Extract this folder to a normal writable directory.
2. Open PowerShell in the extracted project root.
3. Run:
   ```powershell
   Set-ExecutionPolicy -Scope Process Bypass
   .\start-tracemate.ps1
   ```
4. Open `http://127.0.0.1:5000`.

If you only need the Node application, run `node server.js`. The optional AI service is started by `start-tracemate.ps1`.

## Preserve your local data
This source package intentionally excludes `.env`, `data/db.json`, `node_modules`, and virtual environments. Keep your existing `.env` and `data/db.json` backed up; never replace them with a blank database if you want to retain accounts and reports. Use `.env.example` as a template if setting up a fresh copy.

## Main fixes included
- Existing AI matching candidate selection and review-only fallback for conflict-only candidates; conflict candidates remain unconfirmable.
- Clear score-audit cap explanations and conservative evidence caps.
- HTML entity decoding in the admin match UI and cache-busted admin script reference.
- Responsive mobile navigation and layout styles.
- Admin tables use horizontal scrolling on narrow screens instead of collapsing every column into tiny vertical text.

## Verification
Run `npm test` and the Node syntax checks from `README.md`. The package has not been live-tested against your local database or browser session; review AI candidates before confirming a match.

---

### Source: `STARTUP-AI-MODELS-FIX.md`

# TraceMate startup and AI model initialization fix

- `start-tracemate.ps1` is the single Windows launcher for AI + backend.
- `start-backend.ps1` remains compatible and invokes the full launcher.
- AI dependencies include the vision requirements so fresh installs include PyTorch, torchvision, and Transformers.
- FastAPI startup kicks off SBERT, MobileNetV2, and CLIP warm-up automatically in background threads.
- Model loading is single-initialization/thread-safe for concurrent startup and inference requests.
- `/health` and `/cv/health` report initialization/loading and model errors.
- Logs for the background AI process are written under `logs/`.

Pretrained weights are downloaded from their model providers on first startup if they are not already cached. An internet connection is required for first-time downloads. This source package does not contain a Windows-specific Python virtual environment or third-party runtime dependencies.

---

### Source: `STARTUP-PYTHON-FIX.md`

# Windows startup Python fix

The launcher now prefers `ai-service\.venv`, then checks `TRACEMATE_PYTHON` and the known original TraceMate virtual environment before creating a new environment. This avoids the Microsoft Store `python.exe` alias and reuses existing AI dependencies when possible.

If your working Python environment is elsewhere, set it before launching: ` $env:TRACEMATE_PYTHON = 'C:\path\to\python.exe' `.

After launching, verify `http://127.0.0.1:8001/health` reports SBERT, MobileNetV2, and CLIP as initialized and not loading.

---

### Source: `STEP-1-CNN-MONGODB.md`

# TraceMate Step 1 — CNN + MongoDB + Top-5 Matching

## What is now connected

When a Lost or Found item contains an uploaded image:

1. TraceMate stores the image in the existing Cloudinary flow.
2. Node.js sends the image URL to the Python CNN service.
3. MobileNetV2 produces a normalized 1280-dimensional embedding.
4. The embedding is stored in MongoDB as `imageEmbedding`.
5. `imageEmbeddingModel` records `MobileNetV2`.
6. The existing matching engine uses the CNN vector as an image component when both records have embeddings.

## New admin endpoint

`GET /api/matches/admin/found/:id`

Requires a JWT for an admin account.

It returns up to 5 candidate lost reports with:

- hybrid score
- confidence
- matching reasons
- score breakdown
- CNN image contribution

## Run order

Terminal 1:
```bash
cd ai-service
pip install -r requirements.txt
python -m uvicorn app:app --host 127.0.0.1 --port 8001
```

Terminal 2:
```bash
npm install
npm run dev
```

The Node backend should have:
```env
AI_SERVICE_URL=http://127.0.0.1:8001
```

## Important

CNN similarity is a feature of the matching system, not "accuracy".
The research threshold/weights should be validated later using labeled TraceMate image pairs.

Next research layer: CLIP, then SBERT, then experimental hybrid fusion.
