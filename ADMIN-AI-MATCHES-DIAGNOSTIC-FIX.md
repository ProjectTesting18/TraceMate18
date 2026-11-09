# Admin AI Matches diagnostic fix

## Changes
- Added privacy-conscious server logs around Admin AI match source counts, candidate selection, and final result counts.
- Kept existing match eligibility rules and hard identity/object-conflict protections unchanged. The fix does not fabricate candidates or weaken conflict checks.
- Updated the empty-state message in the Admin AI Matches modal. The previous text claimed a configured score threshold even though this server function does not apply that threshold.
- Added a regression test for the empty-state message.

## Verification performed
- `node --check server.js` — passed
- `node --check js/admin.js` — passed
- `npm test` — 86 tests passed, 0 failed
- Python syntax compilation for the AI service entry point and core service modules — passed
- Original uploaded ZIP integrity check — passed

## How to use the diagnostics
Start the backend and open the Admin AI Matches modal again. Inspect the backend terminal for:
- `[TraceMate][AdminMatches] source counts`
- `[TraceMate][AdminMatches] candidate selection`
- `[TraceMate][AdminMatches] final results`

Interpretation:
- `lostReportsTotal: 0`: the local JSON database has no lost reports in `data/db.json`.
- `lostReportsTotal > 0` but `lostReportsEligible: 0`: all reports are in excluded statuses.
- `scoredCandidates: 0`: the matcher returned no usable candidate results.
- `selectedCandidates > 0` but `afterDeduplication: 0`: inspect the hybrid result/eligibility path.

Real records are intentionally not included in the ZIP. Back up the live `data/db.json` before replacing files; do not overwrite it with an empty database.

This package diagnoses the live empty-result cause; it does not claim to have reproduced the user's private runtime database state.
