# TraceMate Final Review Report

Consolidated project notes and reports from the supplied archive. Original documents are retained in the separate backup archive when available.

## Source documents
- `AI-LABEL-SCORE-FIX.md`
- `AI-MATCHING-FIX-README.md`
- `AI-TIMEOUT-FIX-NOTES.md`
- `CNN-CV-INTEGRATED.md`
- `CNN-INTEGRATION.md`
- `NLP-SBERT-SETUP.md`
- `README-TraceMate-AI-Fixes.md`
- `START-HERE-TraceMate-Fixed-v11.md`
- `START-HERE-TraceMate-Fixed-v3.md`
- `START-HERE-TraceMate-Fixed-v5.md`
- `START-HERE-TraceMate-Fixed-v6.md`
- `START-HERE-TraceMate-Fixed-v7.md`
- `START-HERE-TraceMate-Fixed-v8.md`
- `START-HERE-TraceMate-Visual-Score-Fix.md`
- `TRACE-MATE-COLOR-NLP-FIX.md`
- `TRACE-MATE-ENCODING-FIX-REPORT-20261030.md`
- `TRACE-MATE-ENTITY-REPAIR-v24-REPORT.md`
- `TRACE-MATE-FIX-20261029-REPORT-AUDIT.md`
- `TRACE-MATE-FIX-REPORT.md`
- `TRACE-MATE-FIX-v19-ENTITY-AND-ENCODING.md`
- `TRACE-MATE-FIXES-20261020-v3.md`
- `TRACE-MATE-FIXES-20261020.md`
- `TRACE-MATE-FIXES-20261024-MULTIPART-COLOR.md`
- `TRACE-MATE-FIXES-20261025-AUDIT-AI-STARTUP.md`
- `TRACE-MATE-FIXES-20261025-SCORE-AUDIT-RECONCILIATION.md`
- `TRACE-MATE-FIXES-20261025-v11-COLOR-EXPLANATION.md`
- `TRACE-MATE-MATCHING-SAFETY-FIXES.md`
- `TRACE-MATE-REVIEW-TEST-REPORT.txt`
- `TraceMate-Fix-Report-2026-10-29.txt`

---

## Source: `AI-LABEL-SCORE-FIX.md`

# TraceMate AI image-label score fix

## Changes

- The hybrid matcher now recovers image labels from `visualRecognition` / `visual_recognition` when a report has no persisted `detectedLabels` array.
- It can read a usable top object candidate from the visual-recognition payload as a fallback.
- Related charging-accessory labels (for example, `charger` and `charging cable`) can earn limited family-level evidence instead of automatically scoring zero because the words differ.
- Related accessory labels remain capped at 2/5; weak-confidence labels remain capped at 2/5. This does not treat a charger and cable as an exact subtype match.
- Added regression tests for missing persisted labels and related charging-accessory labels.

## Verification

- `node --test tests/*.test.js`: 82 passed, 0 failed.
- `node --check server.js`: passed.
- `node --check src/advanced-cnn/matchingServiceCompat.js`: passed.
- Python compilation checks for the AI service entry point and visual services: passed.

These checks verify source logic and regression cases. The live model/API must still be exercised on the target machine with actual report photos to confirm the deployed AI service returns candidates for those specific images.

---

## Source: `AI-MATCHING-FIX-README.md`

# TraceMate AI matching fix (20 October 2026)

This package updates the existing TraceMate source with a targeted fix for the admin AI-match modal returning an empty list when eligible lost reports exist but every candidate is blocked by a hard object/identity conflict.

## What changed

- Admin candidate selection still prefers conflict-free candidates and excludes lost reports already matched to a different found item.
- If there are eligible/open lost reports but every one has a hard identity/object conflict, the admin modal can show up to five **review-only** candidates with score 0. Those candidates have `eligibleForConfirmation: false` and the confirmation button is disabled. This does not convert a conflict into a match.
- Lost reports already matched elsewhere remain excluded; the currently confirmed pair remains inspectable.
- The admin modal explains when a found item must be physically received and offers the existing authorized `Record Receipt` action.
- Image similarity distinguishes a missing lost/found photo from unavailable similarity computation.
- One Plus/OnePlus brand aliases normalize consistently; Vivo remains a distinct brand.
- The return endpoint supports registered owner email verification for owners without a Student ID, while retaining Student ID and account-ID paths.
- Added focused tests for candidate selection and brand alias behavior.

## Verification performed

- `npm test`: 30 tests passed.
- `python -m unittest discover -s ai-service -p 'test_*.py' -v`: 5 tests passed.
- `node --check` passed for `server.js`, `js/admin.js`, and `src/advanced-cnn/matchingServiceCompat.js`.

A live browser test against your actual local database has not been run from this package environment.

## Important database note

This ZIP intentionally does **not** include `data/db.json`, `.env`, `node_modules`, or `.venv`. That prevents overwriting your existing records or including local credentials. When applying to your existing project, keep your current `data/db.json` and `.env` files. Back them up before copying source files.

## Start

From the project root in PowerShell:

```powershell
npm test
node server.js
```

Start the Python AI service in a separate terminal using the project's existing virtual environment and instructions in `start-ai-service.ps1` / `ai-service/README.md`.

---

## Source: `AI-TIMEOUT-FIX-NOTES.md`

TraceMate AI request timeout patch (v9)

Changes:
- NLP bridge default timeout is now 45 seconds (configurable with NLP_TIMEOUT_MS).
- Image/text cross-modal bridge default timeout is now 90 seconds (configurable with IMAGE_TEXT_TIMEOUT_MS).
- Existing errors remain handled as graceful AI-unavailable fallbacks; this patch does not remove conflict guards or alter database data.

Important:
- A longer timeout prevents premature aborts during cold model startup; it does not fix a Python service that is deadlocked or unreachable.
- Keep Node.js and Python AI service running. Verify http://127.0.0.1:8001/health.
- After extracting this ZIP, copy your existing .env and data/db.json from the old project only after backing them up. Do not overwrite/reset the existing database.
- Run npm test and the direct endpoint checks documented in the conversation.

---

## Source: `CNN-CV-INTEGRATED.md`

# CNN + Computer Vision integration in the original TraceMate UI

This merged project keeps the original TraceMate login/dashboard frontend and original API-backed data layer, while adding the CNN workflow developed in the separate CNN build.

## Active AI service
`ai-service/` is the FastAPI service:
- MobileNetV2 pretrained CNN feature extractor
- 1280-dimensional normalized image embeddings
- cosine similarity
- `/health`
- `/cv/image-embedding`
- `/cv/image-similarity`

## Active Node integration
`src/advanced-cnn/cnnBridge.js` sends the original frontend's base64 image data to the AI service using native Node FormData/Blob. This avoids the multipart boundary problem encountered earlier.

`src/advanced-cnn/matchingServiceCompat.js` uses the same scoring weights:
category 25, name 20, description 15, location 10, date 10, color/brand 5, image labels 5, CNN image 10.

## Workflow endpoints
- `PUT /api/found/:id` — admin receives physical found item
- `GET /api/matches/admin/found/:id` — top AI candidates
- `POST /api/matches/admin/confirm` — admin confirms match
- `POST /api/matches/admin/return` — admin verifies Student ID and records return

Owner notifications are sent only after admin confirms a match (not when a found item is merely submitted).

## Important
The similarity percentage is a normalized similarity score, not model accuracy.

---

## Source: `CNN-INTEGRATION.md`

# TraceMate CNN Integration

The CNN layer now supports both pairwise comparison and reusable image embeddings.

## New endpoint

`POST /cv/image-embedding`

Returns a normalized 1280-dimensional MobileNetV2 embedding.

## Node integration

`src/services/cnnMatchingService.js` provides:

- `requestEmbedding(imagePath)`
- `compareImages(imagePath1, imagePath2)`
- `searchByEmbedding(queryEmbedding, candidates, topK)`

## Database field

For each lost/found image, store:

```json
{
  "imageEmbedding": [1280 normalized values],
  "imageEmbeddingModel": "MobileNetV2"
}
```

The embedding can be compared with candidate lost reports using cosine similarity.

## Research note

Similarity is not model accuracy. A production threshold must be selected from labeled TraceMate image pairs during evaluation.

Next layers: CLIP -> SBERT -> hybrid text/image/location/time/category ranking.

---

## Source: `NLP-SBERT-SETUP.md`

# TraceMate SBERT NLP

TraceMate now prefers Sentence-BERT (`all-MiniLM-L6-v2`) for semantic text similarity.

## Install

From the `ai-service` folder:

```powershell
python -m pip install -r requirements.txt
```

On the first NLP request, Sentence-BERT may download `all-MiniLM-L6-v2` from Hugging Face and cache it locally. Internet access is therefore needed for the first model download.

If `sentence-transformers` or the model cannot be loaded, TraceMate automatically uses the existing TF-IDF + token-overlap implementation. The API remains the same.

## Test

Start the AI service:

```powershell
python app.py
```

Then POST JSON to `http://127.0.0.1:8001/nlp/text-similarity`:

```json
{
  "text1": "I lost my black backpack in the library",
  "text2": "A black school bag was found near the library"
}
```

A successful SBERT response reports:

- `model`: `SBERT all-MiniLM-L6-v2`
- `backend`: `sbert`
- `method`: `sentence embeddings + cosine similarity`
- `similarity_percent`: semantic similarity score
- `match`: true when the score is at least 45%

The existing Node.js `/api/ai/text-similarity` endpoint continues to work without changes.

---

## Source: `README-TraceMate-AI-Fixes.md`

# TraceMate AI patch — reviewed changes

## Included changes

1. `src/advanced-cnn/matchingServiceCompat.js`
   - Removed the incorrect `notebook -> laptop` token synonym. A paper notebook and an electronic laptop must not be treated as the same word/object.
   - Removed the misleading `graphic/graphics -> graffiti` aliases, which could create false text matches.
   - Visual color parsing now uses the first color mentioned in a multi-color label rather than a hard-coded color priority. For example, `pink, black trim` resolves to pink, not black.
   - AI color evidence now reports `AI visual color agrees: pink` when both labels indicate the same primary color, rather than emitting an ambiguous `pink vs pink` message.
   - Category lookup now supports common alternative fields (`itemCategory`, `item_category`, `categoryName`, `category_name`) and category objects with `name`, `label`, `value`, or nested `category` fields. If category data is genuinely absent, it remains unknown and receives no category points.

2. `ai-service/services/nlp_service.py`
   - Removed the incorrect `notebook -> laptop` normalization from the TF-IDF fallback. This preserves paper notebook and laptop as distinct terms.

3. Regression tests
   - `tests/matching-ai-regression.test.js`: five tests for notebook/laptop distinction, category fields and aliases, secondary trim color handling, same-color explanations, and true high-confidence color conflicts.
   - `ai-service/test_nlp.py`: added a deterministic check that the fallback tokenizer does not collapse notebook into laptop.

## Tests run in the review environment

- `node --check server.js` — passed
- `node --check src/advanced-cnn/matchingServiceCompat.js` — passed
- `node --test tests/matching-ai-regression.test.js` — 5 passed, 0 failed
- `python -m py_compile ai-service/services/nlp_service.py ai-service/test_nlp.py` — passed
- `cd ai-service; python test_nlp.py` — passed

## Apply

Extract this patch ZIP into the TraceMate project root and allow it to replace the two matching/NLP files and the NLP test. Keep a backup first. Run:

```powershell
node --check .\server.js
node --check .\src\advanced-cnn\matchingServiceCompat.js
node --test .\tests\matching-ai-regression.test.js
Set-Location .\ai-service
python test_nlp.py
```

## Scope / remaining work

The uploaded `TraceMate-AI-Core.zip` contains `server.js`, the matching engine, and the AI service, but not the frontend source or actual lost/found records. Therefore this patch does not claim to fix the frontend's warning icon styling or prove why a particular stored report pair has `Category 0/20`. If the category fields are truly absent in those records, the score correctly remains zero until the source form/data mapping is corrected. Model weights and similarity thresholds were not arbitrarily changed without a labeled evaluation set; the reported percentages are similarity scores, not calibrated probabilities or model accuracy.

---

## Source: `START-HERE-TraceMate-Fixed-v11.md`

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

## Source: `START-HERE-TraceMate-Fixed-v3.md`

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

## Source: `START-HERE-TraceMate-Fixed-v5.md`

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

## Source: `START-HERE-TraceMate-Fixed-v6.md`

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

## Source: `START-HERE-TraceMate-Fixed-v7.md`

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

## Source: `START-HERE-TraceMate-Fixed-v8.md`

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

## Source: `START-HERE-TraceMate-Visual-Score-Fix.md`

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

## Source: `TRACE-MATE-COLOR-NLP-FIX.md`

# TraceMate colour/NLP match-score fix

## What changed

- A reported red-vs-white colour discrepancy no longer automatically applies the visual similarity cap when both image-recognition results independently agree on the same colour with confidence >= 0.65 and the lost/found reports resolve to the same object family.
- The report-field discrepancy is still surfaced as a manual-review reason; it is not silently discarded.
- If the two high-confidence image colour predictions disagree, the existing visual contradiction penalty and cap still apply.
- The score audit exposes `reportedPrimaryColorConflict` and `visualColorAgreementOverridesReportConflict` so reviewers can distinguish a text-field discrepancy from an image-derived contradiction.
- Existing NLP similarity and external NLP adjustment are unchanged. Low text similarity continues to be a review signal rather than being hidden or inflated.

## Why

A charging kit can contain differently coloured components (for example, a red cable and a white adapter). Report text/structured colour fields may refer to different components or be stale. When the actual image recognizer confidently agrees on colour for both photos, that evidence should prevent an automatic visual penalty, while keeping the report discrepancy visible for a person to review.

## Validation

`npm test`: 84 tests passed, 0 failed. New regressions cover matching high-confidence image colours despite conflicting report fields, and retaining the penalty when high-confidence image colours actually disagree.

The tests validate the matcher logic; the live app should still be re-tested with the actual lost/found images after restarting the Node backend and AI service.

---

## Source: `TRACE-MATE-ENCODING-FIX-REPORT-20261030.md`

# TraceMate encoding repair report — 30 October 2026

## Changes applied in this build

1. Updated the global `decodeLegacyHtmlEntities` helper in `js/app.js` to repeatedly decode legacy/nested HTML entities as text and added a numeric-character-reference fallback for strings such as `charge&#x72;`, `&#x53;ame category`, and `&#x1F7E2;`.
2. Applied the same robust decoder to the AI Match Candidates modal's local decoder in `js/admin.js`, including candidate names, review warnings, score-cap explanations, and evidence reasons.
3. Bumped the `index.html` CSS, `app.js`, and `admin.js` asset query versions to `20261030-full-encoding-fix-v20` so browsers request the repaired files rather than an older cached JavaScript file.
4. Preserved the existing safe HTML escaping path: decoded user/report text is escaped before insertion into HTML.
5. Kept the existing matching score policy. The sample's 64% cap is due to combined text similarity (40% below the 45% threshold); 100% visual-feature similarity and 17% visual object-classifier confidence are separate measurements, so the low-confidence warning remains appropriate.

## Validation

- `node --check js/app.js` — passed
- `node --check js/admin.js` — passed
- `node --check server.js` — passed
- `npm test` — 92 passed, 0 failed
- ZIP archive integrity — checked after packaging

A live browser test against the user's Windows installation was not possible from this workspace. This archive contains the actual source edits above; after extracting it, restart TraceMate and hard-refresh the browser (Ctrl+Shift+R).


## v23 follow-up repair

- Added a final DOM text-node normalization pass inside the AI Match Candidates modal observer. It repeatedly decodes legacy entities in visible text nodes, including values that were inserted after the original render path.
- The pass updates `textContent`/text-node values only; it does not insert decoded values as HTML.
- Updated frontend asset query versions to `20261030-entity-repair-v23`.
- Server static responses already send no-cache headers, retained for this release.

---

## Source: `TRACE-MATE-ENTITY-REPAIR-v24-REPORT.md`

# TraceMate entity repair v24

## Change
- Updated the AI Match Candidates modal MutationObserver in `js/admin.js` to observe `characterData` mutations as well as child-list mutations.
- Bumped the `index.html` asset cache-busting version from `20261030-entity-repair-v23` to `20261030-entity-repair-v24`.

## Why
The existing last-mile decoder walks text nodes and changes `nodeValue`, but the observer previously watched only `childList`. If a later renderer updates an existing text node's value without adding/removing a node, the decoder would not run for that update. Observing character data makes those changes trigger the repair pass too.

## Validation
- JavaScript syntax check and archive integrity check are required before use.
- This archive was not run against the user's Windows server/browser from this environment; live application verification remains outstanding.

---

## Source: `TRACE-MATE-FIX-20261029-REPORT-AUDIT.md`

# TraceMate report audit wording fix — 2026-10-29

## Change
The AI Match Candidates score audit now labels the hybrid arithmetic as:

`Hybrid pre-final-cap calculation (uncapped base score + NLP adjustment)`

It also explains that the displayed base matcher cap is diagnostic; the hybrid score uses the uncapped base score, adds the bounded external NLP adjustment, and applies the final recommended cap to the combined result.

## Why
A report such as raw score 77, external NLP adjustment +3, pre-final-cap hybrid score 80, final cap 64, final score 64 is consistent with this policy. The previous label was easy to misread as if the base cap of 64 had been used in the arithmetic. The conservative cap remains unchanged; low text evidence still triggers manual review.

## Validation
Node test suite and Python unit tests were run after this wording/test change. See the response for the observed results. This does not constitute a live browser/database end-to-end test or model retraining.

---

## Source: `TRACE-MATE-FIX-REPORT.md`

# TraceMate Fix Report — v4

## Changes in this package
- Preserved the existing matching engine, object-family safeguards, manual-review behavior, and receipt confirmation guard.
- Fixed numeric descriptor parsing: null, undefined, and blank strings are treated as unavailable instead of being converted to numeric zero.
- Fine visual matching returns unavailable when both images lack usable descriptors instead of reporting a false 100% match.
- Fixed model provenance: a deterministic `ColorHistogramFallback` embedding is no longer labelled or scored as a MobileNetV2 embedding. Explicitly unavailable/fallback CLIP embeddings are likewise excluded from CLIP scoring. Legacy records without model metadata remain compatible.
- Prevented null/blank embedding dimensions from producing a cosine similarity.
- Marked model similarity evidence as informational in the admin explanation list; raw feature similarity is not a claim of physical-item identity.
- Kept reported color conflicts distinct from AI-estimated image color; image estimates do not override user-provided report details.
- Clarified NLP model similarity vs. combined text similarity and visual feature similarity vs. physical-item identity.
- Avoided repeating primary-color, low-text, low-confidence-object, and scratch-screening warnings in the detailed evidence list when those warnings are already shown in the manual-review banner.
- Kept low-confidence predictions and heuristic scratch evidence as review signals, not proof of identity.
- Added regression tests for null/blank descriptors, fallback embedding provenance, true MobileNetV2 scoring, and warning presentation.

## Verification performed in the package environment
- `node --check server.js` — passed
- `node --check js/admin.js` — passed
- `node --check src/advanced-cnn/matchingServiceCompat.js` — passed
- `node --check src/advanced-cnn/visualDetailMatching.js` — passed
- `npm test` — 77 passed, 0 failed, 0 skipped
- Python source compilation — 24/24 files passed
- ZIP integrity check — passed after packaging

## Limitations
This package has not been verified against the user's live MongoDB/database, Windows environment, or running external AI models. Real model scores still depend on the actual uploaded photos and AI service responses. A passing automated suite does not guarantee every runtime dependency or live prediction is error-free. Preserve the user's own `.env` and `data/db.json` when installing.


## Final review fixes (2026-10-22)

- Expanded the CLIP object vocabulary with common phone/laptop chargers, power adapters, charging/USB cables, power banks, charging bricks, and other electronics.
- Populated `detectedLabels` from the best available CLIP object candidate when the candidate confidence is usable, while retaining confidence metadata. This fixes the empty-label path without presenting weak model outputs as confirmed facts.
- Capped image-label contribution at 2/5 when either label is a low-confidence candidate; full 5/5 is only possible when both item labels meet the high-confidence threshold.
- Added score audit fields for component total, shared-text/location boosts, visual contradiction penalty, visual evidence factor, pre-cap score, recommended cap, and final score; displayed these in the admin candidate detail so the final score is explainable.
- Added regression tests for low-confidence label handling, common charging-device classes, score audit display, and label-score caps.

Validation: JavaScript syntax checks, Python compilation, and the Node test suite are run during packaging. Live CV model output depends on installed AI dependencies and the local AI service being available; it is not claimed as verified by static tests alone.


## Colour override regression fix (2026-10-22)

- Adjusted the report-colour disagreement override so matching high-confidence colour estimates from both images can resolve a report-field mismatch when the visual identity gate has not detected a strong object-type conflict. This avoids relying on exact equality of text-derived object-family labels for closely related charging accessories.
- Kept the independent strong visual object-conflict gate and differing high-confidence image-colour contradiction behavior intact.
- Added a regression test for charger/charging-cable text-family variation.
- Validation for this revision: Node test suite run during packaging; see the final test summary in the delivery message.

---

## Source: `TRACE-MATE-FIX-v19-ENTITY-AND-ENCODING.md`

TraceMate v19 — entity rendering fix

Changes:
- Shared escapeHtml now decodes legacy/double-encoded HTML entities before escaping output.
- The admin AI-match renderer uses up to 12 decode passes for consistency.
- app.js cache-busting version updated to 20261030-entity-decode-v19.
- Repaired known mojibake punctuation in app.js text strings.

The patch does not change match scoring, similarity calculations, identity-conflict checks, or manual-review safeguards.

Run start-tracemate.ps1 from the project root as usual. After replacing the old folder, hard-refresh the browser with Ctrl+Shift+R.

---

## Source: `TRACE-MATE-FIXES-20261020-v3.md`

# TraceMate matching/UI fixes — 2026-10-20 (v3)

## Fixes

1. **Sounce brush text attributes:** added `sounce` to known brand terms and `brush`, `cleaning brush`, and `scrub brush` to object-type terms. The two supplied Sounce brush report descriptions now yield matching brand, object-type, color, and feature property evidence in the regression fixture.
2. **Low-confidence visual predictions:** uncertain object labels trigger a manual-review reason without changing the score. Missing visual predictions do not create a spurious low-confidence warning. High-confidence object-family conflict protection remains covered by existing tests.
3. **Color-label language:** if vision labels differ but the confidence threshold did not establish a visual color conflict, the explanation now says the labels differ but are insufficient to confirm a conflict. Confirmed high-confidence conflicts retain a distinct message.
4. **Score-cap explanation:** the admin UI only displays a cap explanation when `recommendedScoreCap < 100`, so a cap value of 100 is not described as an applied cap.
5. **Review banner:** the banner says evidence is uncertain or inconsistent, rather than claiming text/color/identity evidence conflicts for every review case.
6. **Legacy text entities:** common legacy HTML entity encodings in item names/descriptions are decoded for display and escaped before HTML insertion.
7. **AI health:** carries forward the lazy-model health checks and bounded backend health requests from the prior fixed bundle.

## Validation

- Node test suite: 25/25 passed.
- Node syntax checks: `server.js`, `src/advanced-cnn/matchingServiceCompat.js`, `js/admin.js` passed.
- Python compilation: AI app, CNN/NLP services and health test compiled successfully.
- AI health tests: 2/2 passed.
- NLP smoke test: passed.

## Important limitation

Text descriptions can support a Sounce brand match, but an image-label/OCR score of zero remains honest when image OCR has not confidently read the brand. The software must not pretend that textual evidence proves the logo was read from the image, nor should visual similarity prove that two images depict the same physical object. Manual review remains appropriate for uncertain cases.

---

## Source: `TRACE-MATE-FIXES-20261020.md`

# TraceMate patch bundle — 20 October 2026

This bundle is based on the uploaded `TraceMate-CodeBundle-20261020-142445.zip`. The replacement package keeps the application, AI service, model asset, source scripts, and tests. To keep the replacement download small, it omits the bulk generated datasets in `dataset-tools/matching-data/` and `dataset-tools/training-data/`; those are not needed to run the app, but retain the original uploaded ZIP if you need those training datasets.

## Changes made

1. **Low-confidence visual predictions recommend manual review**
   - `src/advanced-cnn/matchingServiceCompat.js`
   - When both lost/found items have an object label and both confidence values are present, a confidence below `0.45` adds `reviewRecommended: true` and a human-readable `reviewReasons` entry.
   - This is a review warning only. It does not change the numeric score or weaken the existing high-confidence object-family rejection gate.
   - Missing object labels/confidence values do not create this warning.

2. **Health endpoints no longer trigger heavyweight model downloads**
   - `ai-service/services/cnn_service.py`
   - `ai-service/services/nlp_service.py`
   - The health status functions now inspect whether MobileNetV2, CLIP, and SBERT have already been initialized rather than trying to load/download them just to answer a health request. Inference still performs lazy initialization when needed.
   - Health payloads distinguish an uninitialized lazy model from a loaded model/fallback.

3. **Node backend AI health checks have a timeout**
   - `server.js`
   - `/api/nlp/health` and `/api/cv/health` use a 3-second timeout when contacting the AI service so an unresponsive service cannot leave these health routes hanging indefinitely.

4. **Regression tests added**
   - `tests/matching-ai-regression.test.js`: low-confidence Sounce brush-style predictions request review without changing the score; a missing prediction does not create the low-confidence warning.
   - `ai-service/test_health_status.py`: health-status checks do not trigger lazy model initialization/downloads.

## Verification performed in this environment

- `npm test`: **23 passed, 0 failed**.
- `node --check` across JavaScript files: passed.
- Python syntax compilation across 26 Python files: passed.
- `python -m unittest test_health_status.py -v`: **2 passed**.
- Started the FastAPI service locally and confirmed `/health` and `/cv/health` returned JSON promptly without initializing/downloading the heavyweight models.

These checks do not prove every model inference path works on every Windows machine. First-use model downloads still require suitable network access and installed Python dependencies. Real image matching should be checked in the user's environment after installation.

## Safe replacement instructions

1. Stop the Node and Python TraceMate services.
2. Make a backup of your existing project folder, especially `data/db.json` and `.env`.
3. Extract this ZIP **over the existing project root**, allowing source files to be replaced.
4. Keep your existing `data/db.json` and `.env`; this bundle intentionally excludes both.
5. From the project root, run `npm test`.
6. Start the Node backend and AI service using your existing project start scripts, then check `http://localhost:5000/api/nlp/health` and `http://localhost:5000/api/cv/health`.

Do not run `npm run reset:data` as part of this update.

---

## Source: `TRACE-MATE-FIXES-20261024-MULTIPART-COLOR.md`

# TraceMate matching fixes — 24 October 2026

## Changes in this release

- Added a component-aware color check for multi-part charging accessories. A red charging cable and a white adapter are not automatically treated as a whole-item color contradiction when the reports mention both components and both colors.
- Preserved real color contradictions: when the reports explicitly describe a red cable versus a white cable, the color conflict and manual-review signal remain active.
- Changed the color-property overlap to Jaccard overlap. A color that is present in one report no longer receives full credit solely because it is a subset of several colors listed by the other report.
- Added a human-readable match explanation when differing report colors are interpreted as component colors.
- Clarified the warning text that combined text evidence is distinct from SBERT semantic similarity. Low-confidence object prediction and genuinely low combined text evidence remain review signals instead of being hidden.
- Added regression tests for the multi-part charger case and for genuine cable-color disagreement.

## Validation

Run `npm test` from the project root. The current regression suite passes **89/89 tests**.

This is a code/test validation result, not a guarantee that every deployment environment or every real-world match will be error-free. After replacing the project, start both services and verify `/health` plus a real lost/found report pair.

---

## Source: `TRACE-MATE-FIXES-20261025-AUDIT-AI-STARTUP.md`

# TraceMate fixes — audit clarity and AI startup (2026-10-25)

## Matching report changes

- The score audit now includes explicit `recommendedScoreCapReasons`.
- When combined text evidence is below 45%, the report explains that this is the rule that limits the maximum score to 64%, and clarifies that SBERT semantic similarity is a separate metric.
- Low-confidence visual object warnings now include the lost/found classifier confidence percentages and the 45% review threshold when those values are available.
- Scratch-screening text distinguishes a mark detected in both images from an actual mismatch; the heuristic is explicitly not described as proof of identity.
- The charger multi-component colour logic and previous safeguards remain in place. Identical source images may legitimately yield 100% visual similarity, but this is not a probability that the reports refer to the same physical item.

## AI startup changes

- Added `run-ai-service.ps1` to choose a known Python interpreter, verify imports for FastAPI, SBERT, PyTorch, torchvision, and CLIP classes, and start Uvicorn from the project root.
- `start-ai-service.ps1` now delegates to the same startup/preflight script.
- The FastAPI lifespan logs that SBERT, MobileNetV2, and CLIP warm-up begins automatically. Warm-up is asynchronous, so check `/health` until all three are available, initialized, and not loading.

## Verification performed

- `node --check` passed for `server.js`, `js/admin.js`, and `src/advanced-cnn/matchingServiceCompat.js`.
- Python byte-compilation passed for `ai-service/app.py`, `ai-service/services/cnn_service.py`, and `ai-service/services/nlp_service.py`.
- Node regression suite: 90 passed, 0 failed.
- This does not replace a live Windows startup and model-download test on the target PC.

## Score audit reconciliation update

- The hybrid matcher now carries the base matcher's raw pre-cap score separately from its capped score.
- External NLP adjustment is applied to the raw base score before the final policy cap, while hard identity conflicts remain score 0.
- The audit UI separately displays raw score before base policy cap, base matcher score after its cap, external NLP adjustment, score after NLP adjustment before final cap, final cap, and final score.
- Cap reasons are retained and added for external NLP text evidence when that metric is the reason a stricter cap applies.
- This change makes the arithmetic traceable; it does not remove the 64% cap for combined text evidence below 45%.

---

## Source: `TRACE-MATE-FIXES-20261025-SCORE-AUDIT-RECONCILIATION.md`

# TraceMate v12 — Score Audit Reconciliation

## Issue fixed
The previous audit showed the base matcher score after its internal cap, then added the external NLP adjustment, and then showed the cap again. This hid the raw score and made the displayed arithmetic look inconsistent with the component subtotal.

## Updated audit stages
1. Evidence component subtotal.
2. Shared-text and location boosts, visual contradiction penalty, and visual evidence factor.
3. Raw score before the base matcher's policy cap.
4. Base matcher score after its cap.
5. External NLP adjustment.
6. Score after NLP adjustment and before the final cap.
7. Final recommended cap and its reasons.
8. Final score.

The final policy cap remains active. In the reported charger example, combined text evidence below 45% still limits the final score to 64%. The visual score is not reduced simply because it is 100% when the same image is used.

## Validation performed in this build
- `node --check server.js`: passed
- `node --check js/admin.js`: passed
- `npm test`: 92 passed, 0 failed
- Python compile check for `ai-service`: passed
- Python tests (`test_health_status`, `test_nlp`, `test_visual_details`): 5 passed

These checks validate automated code paths. Full startup and the browser workflow still need to be confirmed on the user's Windows machine.

---

## Source: `TRACE-MATE-FIXES-20261025-v11-COLOR-EXPLANATION.md`

# TraceMate v11 — Color explanation consistency fix

## Fix

The AI color explanation now depends on the actual matching state:

- When red and white are identified as component colors of a multi-part charging accessory, matching image-color estimates no longer append the contradictory phrase “reported color conflict remains”. The explanation tells reviewers to compare the cable and adapter separately.
- When a real reported primary-color conflict remains, the explanation explicitly says that the report conflict is unresolved and that image estimates do not override report fields.
- When no report-level conflict exists, matching AI color estimates are described as an estimate, not proof of identity.

The numeric visual similarity is not reduced merely because the same image is reused. Low-confidence object classification and low combined-text evidence continue to trigger manual review; this is intentional. The 64% score cap remains explained by the existing 40% combined-text evidence rule.

## Validation

- Node regression suite: 90 passed, 0 failed.
- Python AI service tests: 5 passed.
- The charger multi-component regression now asserts that the report does not call the component-color case an unresolved primary-color conflict.

These are automated tests, not a full Windows/browser end-to-end run. After extracting, start the app and verify `/health` and the live charger report on the target machine.

---

## Source: `TRACE-MATE-MATCHING-SAFETY-FIXES.md`

# TraceMate matching safety fixes

## Changes in this build

- Explicit report-derived primary-color disagreements remain conflicts even when image classifiers estimate the same color. The image estimate is surfaced as review evidence and no longer silently suppresses the report conflict.
- The existing visual-score cap and contradiction penalty remain active for reported color conflicts.
- The hybrid matcher records when different photo-source strings have identical MobileNetV2 or CLIP embedding vectors, and when all available fine-visual sub-scores are effectively identical. These are diagnostics for checking stale/cached embeddings or feature extraction; they do not claim that two items are identical and do not independently alter the score.
- Admin AI matching now logs aggregate counts at the source-load, candidate-filter, scored-candidate, and final-result stages. Logs omit item descriptions and image data.
- Regression tests cover explicit color conflicts and identical embeddings across distinct photo-source strings.

## Validation

Run `npm test` from the project root. This build was validated with the Node test suite; passing unit tests do not replace a live end-to-end check against your actual database and AI service.

## Install safely

Extract this archive into a new folder. Keep your existing `.env` and database/user data backed up. Do not replace a live database with an empty sample database. Start the app and inspect the terminal logs prefixed with `[TraceMate][AdminMatches]` if Admin AI Matches returns no rows.

---

## Source: `TRACE-MATE-REVIEW-TEST-REPORT.txt`

TraceMate source review - 2026-10-29

Validation performed:
- JavaScript automated tests: 98 passed, 0 failed.
- ZIP integrity: output archive will be checked after creation.
- The JavaScript tests cover matching regressions, score audit reconciliation,
  NLP timeout/cold-start behavior, visual-color conflicts, mobile/admin UI fixes,
  and workflow candidate selection.

Important limitations:
- This is a source-level regression test, not a full live end-to-end run.
- Python AI dependencies/models and MongoDB were not started in this environment.
- No model training was performed.
- The uploaded TraceMate-review.zip could not be opened as a complete ZIP
  (missing readable central directory); this reviewed package was built from the
  valid TraceMate-Clean-Source.zip available in this session.
- Keep TraceMate-Datasets-Models-Data.zip separately if you need training data.

---

## Source: `TraceMate-Fix-Report-2026-10-29.txt`

TraceMate targeted fix report — 2026-10-29

Source baseline: TraceMate-Complete-Fixed-v12-Score-Audit-Reconciliation.zip
Change: js/admin.js now calls the score arithmetic "Hybrid pre-final-cap calculation (uncapped base score + NLP adjustment)" and displays an explanatory note that the base matcher cap is diagnostic. This avoids confusion when raw 77 + NLP adjustment 3 = 80 while final recommended cap and final score are 64.
Policy: Conservative cap is unchanged. Low combined text evidence remains a manual-review warning; visual similarity is not proof of item identity.
Regression test: tests/score-audit-reconciliation.test.js updated to assert the corrected wording and explanatory note.
Validation:
- npm test: 92 passed, 0 failed.
- node --check server.js: passed.
- node --check js/admin.js: passed.
- node --check src/advanced-cnn/matchingServiceCompat.js: passed.
- python -m compileall -q ai-service: exit code 0 (environment emitted an unrelated spreadsheet-runtime warmup traceback on stderr).
- Python unit tests test_health_status, test_nlp, test_visual_details: 5 passed.
Not yet verified: live MongoDB-backed workflow, browser end-to-end workflow, model startup timing on Windows, or model retraining.
