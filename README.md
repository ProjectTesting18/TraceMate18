# TraceMate — Complete Project Package v11

TraceMate is a Node.js lost-and-found application with a local JSON database and an optional Python AI service for text and image matching.

## Requirements

- Node.js 20 or newer recommended
- Python 3.11 or 3.12 recommended for the AI service
- The Python AI service is optional for basic matching. CNN/CLIP features require their model dependencies.
- MongoDB is **not required** by the current backend. Runtime data is stored in `data/db.json`.

## Start on Windows

Recommended: open PowerShell in the project root and run one command:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\start-tracemate.ps1
```

This starts the Python AI service (SBERT + MobileNetV2 + CLIP warm-up) and the Node backend. `start-backend.ps1` remains a backward-compatible alias for the full startup. Open `http://127.0.0.1:5000`.

The first start installs Python dependencies and may download pretrained weights. Check `http://127.0.0.1:8001/health` for model states and `logs/ai-service-error.log` if the AI service fails. The AI models load in the background after the service starts; health status reports loading versus ready. Keep `.env` private and set a unique `ADMIN_PASSWORD` before real use.

For AI-only troubleshooting, run `start-ai-service.ps1` from the project root. MongoDB is not required by this local JSON database configuration.

## Tests and checks

From the project root:

```powershell
node --check server.js
node --check src/advanced-cnn/matchingServiceCompat.js
node --check src/advanced-cnn/visualDetailMatching.js
npm test
Set-Location .\ai-service
python -m unittest test_health_status.py test_visual_details.py test_nlp.py
```

Validation in the packaging environment: **108 Node regression tests passed**, **6 Python AI-service tests passed**, Python source compilation passed, and JavaScript syntax checks passed. These checks do not replace a full live browser/backend/AI end-to-end test on your Windows machine.

## Visual score interpretation

Image-embedding cosine values are now displayed as `max(0, cosine) × 100` instead of shifting cosine zero to 50%. This avoids inflating unrelated/orthogonal embeddings. The result remains a similarity score, not a calibrated probability that two photos show the same physical item.

## Matching color consistency

The matcher now:

- Prefers explicit cable/cord/wire color descriptions over a potentially stale item title, so a red cable is not mistaken for a black cable just because both reports have the same title.
- Does not report “Color appears to match” when the visual labels disagree, even if the disagreement is too low-confidence to declare a confirmed conflict.
- Caps uncertain visual color evidence at 50% in the property breakdown and caps image-only color disagreements at 82% pending manual review.
- Applies the 62% score cap only when lost/found report-provided primary colors explicitly conflict. Image-derived gray/white differences remain review warnings with a smaller penalty because lighting, exposure, white balance, and background leakage can mislead the visual heuristic.
- Retains the incompatible-object-family rejection gate and the physical-receipt requirement before admin confirmation.

A similarity score is not a probability that two reports refer to the same physical item. Review original photos and report details before confirming a match.

## Data and secrets

- `.env` is not included in this package; create it from `.env.example` and keep it private.
- The ZIP does not include `data/db.json`, because it can contain user records and session tokens. The live database is stored outside the project under the user application-data directory. If you still have an older project-local `data/db.json`, keep it safe for migration.
- Generated dataset copies, temporary patch files, old backups, and isolated experimental copies were excluded to keep the project folder clean. AI training scripts and the shipped model files remain in `ai-service/`.
- Do not run `npm run reset:data` unless you deliberately want to reset local application data.


## Run the Python AI service directly (Windows)

From the project root, run ` .\run-ai-service.ps1 ` in PowerShell. This chooses a working Python interpreter without relying on the Windows Store alias, checks the SBERT/MobileNetV2/CLIP imports, then launches Uvicorn. Model warm-up starts automatically; wait until `/health` shows SBERT, MobileNetV2, and CLIP all available and not loading. See [RUN-AI-SERVICE.md](RUN-AI-SERVICE.md) for the exact commands.


## Persistent report storage and history

TraceMate stores its live JSON database outside the extracted source folder so reports survive restarting the server and extracting a newer ZIP. On Windows the default location is `%APPDATA%\TraceMate\data\db.json`; macOS and Linux use the user's application-data directory. Set `TRACEMATE_DATA_DIR` to choose a custom data folder. `npm run reset:data` resets this same persistent database.

The server records report creation and edits in each lost/found report's `history` and `timeline`, preserving the original creation time and listing changed fields. A clean ZIP does not include another user's live database. When upgrading an existing installation in place, the server imports its old `data/db.json` into persistent storage on first startup if no persistent database exists. Stop the TraceMate backend before importing data from a different extracted folder. Run `npm run migrate:data -- "C:\path\to\old-TraceMate\data\db.json"` from this project folder (replace the example with the actual old path). The migration merges by record ID and can be repeated safely; restart the backend after import.

## Latest matching reliability fixes

- Visual AI confidence values are normalized whether the service returns a 0–1 fraction or a 0–100 percentage before applying object, size, and color conflict thresholds.
- Gray/grey/silver and light-gray/gray foreground estimates are normalized to reduce lighting-driven false color conflicts. Distinct image estimates such as gray vs white still trigger manual review, but image-only estimates do not automatically count as a confirmed report-color conflict.
- NLP similarity, image similarity, object properties, and the final candidate score remain separate measurements. A match score is not a probability that two reports refer to the same physical object.
- Color and other uncertain visual contradictions recommend manual review; they do not by themselves confirm identity. Physical receipt is still required before admin confirmation.
- Report history and durable database storage are retained. The live database is intentionally excluded from this ZIP so extracting an update cannot overwrite a user's existing reports.


### Color-conflict score-cap clarification

The hybrid server applies the strict 62% cap only to explicit report-color conflicts. An image-derived color difference alone is uncertain visual evidence: it keeps the matching engine's 82% maximum cap and still recommends manual review.
