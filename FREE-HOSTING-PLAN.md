# TraceMate free-hosting plan (experimental)

This branch is separate from `main` and from `deployment/render-full-ai`. It is an experimental path for a no-cost deployment. Do not merge it until the complete deployment has passed the verification checklist.

## Goal and honest limitations

The target is to keep the existing TraceMate workflows and all four AI components:
- LostNet trained classifier
- SBERT semantic text similarity
- MobileNetV2 image embeddings
- CLIP image/text similarity

A free-tier deployment is best-effort and suitable for a student-project demonstration, not a production availability guarantee. Free services may sleep, restart, have CPU limits, and use ephemeral local filesystems. Model downloads may repeat after a restart. Cold starts can be long.

Do not claim that all models are available until the deployed `/health` response reports each model ready and the end-to-end matching tests pass.

## Candidate hosting layout

1. **Web/API:** Render Free Node web service, only if the current app can run within its memory limit. It sleeps after inactivity and its local filesystem is ephemeral.
2. **AI:** Hugging Face Spaces CPU Basic is a candidate because its published hardware is 2 vCPU / 16 GB RAM. Before implementation, verify the account can create a compute Space on the free account and verify a FastAPI-compatible deployment path. Do not assume a Docker Space can be created on every free account. A Gradio-SDK Space may require adapting the service entrypoint while preserving the existing FastAPI routes.
3. **Database:** Supabase Free Postgres for persistent structured records. The existing Node application currently uses a JSON-file collection adapter; this requires a deliberate data-layer migration, not just an environment-variable change.
4. **Images:** Supabase Storage (or another free object-storage provider) for uploaded images. The current JSON records may contain data URLs; confirm upload and image-serving flows before migration.

## Required code work (not yet implemented)

### A. Replace local JSON persistence with a storage adapter

- Introduce a Postgres-backed repository implementation for users, lost_items, found_items, claims, and sessions.
- Preserve the existing collection method semantics used by `server.js` or refactor call sites with tests.
- Add schema/migrations, indexes, transactions, and safe parameterized queries.
- Add environment configuration for Supabase/Postgres connection details; never commit credentials.
- Add a one-time export/import utility for existing `data/db.json` and verify record counts before switching.
- Do not delete or overwrite the existing JSON database during migration.

### B. Move uploaded images to object storage

- Find every route that accepts, stores, reads, or returns image data.
- Upload image bytes to a private/public bucket according to the existing access model.
- Store stable object keys/URLs in records instead of large base64 data URLs.
- Add size/type validation, authorization checks, and cleanup for deleted records.
- Verify old data-URL records remain readable during a transition period.

### C. Adapt the AI service for the selected free Space runtime

- Keep the current FastAPI routes and response contracts if the selected Space runtime supports them.
- If a Gradio SDK entrypoint is required, mount or bridge the existing FastAPI routes without changing their request/response behavior.
- Pin compatible CPU dependencies and avoid loading duplicate model copies.
- Keep model warm-up status visible. Add request timeouts and clear 503 responses while models load.
- Use a cache directory where possible, but assume the Space's local disk can be reset.
- Verify LostNet checkpoint is included in the repository and model downloads fit the Space's storage limits.

### D. Configure Node-to-AI calls

- Set `AI_SERVICE_URL` to the public HTTPS endpoint of the AI Space.
- Add a server-side API token if the Space is private/protected; do not expose secrets in browser JavaScript.
- Configure CORS only if browsers call the AI Space directly (preferred design is Node-to-AI server-side calls).
- Add bounded retries/timeouts and user-facing fallback messages for sleeping/cold AI service.

### E. Render free web service

- Remove persistent disk and private-service references from the free web service config.
- Do not use the JSON database in production on Render Free.
- Do not include production credentials in Git.
- Add environment variables for Supabase and AI endpoint as unsynced secrets.

## Acceptance checklist

- [ ] Confirm free-account eligibility and runtime type for the AI Space before writing deployment-specific entrypoint code.
- [ ] Render web service builds and starts on the Free plan.
- [ ] Supabase schema and storage bucket created; migration imported and record counts reconciled.
- [ ] Existing user login, sessions, lost reports, found reports, claims, and admin views work.
- [ ] Image upload, retrieval, and access control work after Node restarts.
- [ ] AI health reports LostNet, SBERT, MobileNetV2, and CLIP as available.
- [ ] Test text similarity, image embedding, image-text similarity, image similarity, and LostNet classification.
- [ ] Test lost/found candidate matching and Admin AI Matches using real test records and images.
- [ ] Repeat tests after service sleep/restart and confirm records/images remain.
- [ ] Document cold-start delays, model readiness, usage limits, and free-tier failure modes.

## Safety and branch policy

- Keep `main` unchanged.
- Keep `deployment/render-full-ai` as the paid Render deployment candidate.
- Implement and test the free architecture only on `deployment/free-hosting`.
- Never deploy or migrate real user data before taking a backup and confirming access controls.
