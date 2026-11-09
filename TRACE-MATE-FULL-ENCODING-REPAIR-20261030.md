# TraceMate full website encoding repair — 2026-10-30

This repair targets visible mojibake in the website UI (for example `ðŸ‘‹`, `âœ…`, and `â†’`) and legacy HTML-entity text in AI match explanations.

## Changes
- Preserved UTF-8 document metadata in `index.html`.
- Repaired known corrupted Unicode arrows and repeated separator characters in `js/app.js`.
- Kept the existing `decodeLegacyHtmlEntities` and safe `escapeHtml` display path in `js/admin.js`.
- Did not alter match scoring, confidence calculations, visual similarity calculations, identity-conflict checks, or manual-review rules.

## Verification performed
- `node --check server.js` — passed.
- `node --check js/admin.js` — passed.
- `node --check js/app.js` — passed.
- `npm test` — 92 tests passed, 0 failed.

The AI service and model loading should still be checked on the target Windows machine because runtime dependencies and model warm-up depend on that environment.
