# TraceMate production deployment (Render)

This deployment keeps the existing Node.js website/backend and runs the existing Python AI service as a separate private Render service. Visitors use one public website; browser requests go to Node.js, and Node.js calls Python over Render's private network.

## Services

- `tracemate-web`: public Node.js web service; serves the existing TraceMate UI and API.
- `tracemate-ai`: private Python FastAPI service; serves LostNet, SBERT, MobileNetV2, CLIP, and the existing visual/NLP endpoints.
- Node data: persistent disk mounted at `/var/data`, with `TRACEMATE_DATA_DIR=/var/data`.
- AI model cache: persistent disk mounted at `/var/data`; Hugging Face, Sentence Transformers, and Torch caches use that disk.

The Blueprint is in the repository root as `render.yaml`. It uses Singapore for both services to reduce latency for users in India. It selects a 1 CPU / 2 GB Node plan and a 2 CPU / 8 GB private AI plan. These are starting resource allocations, not a guarantee of peak throughput; monitor memory and latency after deployment.

## Deploy

1. Merge the reviewed deployment pull request into `main` only after the code review and checks are complete.
2. In Render, choose **New + → Blueprint** and connect `ProjectTesting18/TraceMate18`.
3. Select the `main` branch and confirm Render detects the root `render.yaml`.
4. Review the two services and persistent disks before applying. The AI service must remain a **private service**; do not expose it as a public endpoint.
5. Supply `ADMIN_EMAIL` and a unique strong `ADMIN_PASSWORD` when Render prompts for the unsynced values. Do not use the sample/default password.
6. Apply the Blueprint and wait for both services to finish their first deploy. The first AI start downloads SBERT and CLIP model weights and can take several minutes.
7. Open the public `tracemate-web` URL. The Node service gets `AI_SERVICE_URL` from the private AI service's host-and-port reference; the backend adds the HTTP scheme and checks `/health` before using it.

## Production verification

- Open `https://<tracemate-web-host>/api/health`; expect HTTP 200 and the JSON database status.
- Open `https://<tracemate-web-host>/api/cv/health`; expect the Python service status.
- Open `https://<tracemate-web-host>/api/nlp/health`; inspect the NLP status.
- Confirm SBERT reports available after warm-up; confirm MobileNetV2 and CLIP report initialized/available as appropriate.
- Test a new lost report, a found report, image upload, LostNet classification, text similarity, image similarity, AI candidate matching, admin review, and claim flow from a second device/browser.
- Restart/redeploy the Node service and verify reports remain. Restart/redeploy the AI service and verify model caches remain and the models reload.
- Check Render logs for model download failures, out-of-memory restarts, request timeouts, and 5xx responses.

## Important operating notes

- The Python AI service is private. It is not a second website for users to open.
- Do not set `AI_SERVICE_URL` to localhost in Render. The Blueprint injects the private host:port automatically.
- The model cache disk stores downloaded pretrained weights; the LostNet checkpoint is shipped in `ai-service/data/lostnet/`.
- This project currently uses its JSON-file database, not MongoDB. The Node persistent disk is therefore required to preserve accounts, reports, claims, and sessions across deploys.
- Render disks are tied to one service instance and constrain scaling/zero-downtime deployment options. Before expecting multiple Node instances or high availability, migrate JSON storage to a managed database and move uploaded files to object storage.
- CPU inference can be slower than GPU inference. Load-test the actual image size and concurrent request patterns; upgrade the AI service plan or move to GPU-capable hosting if needed.
- A successful deploy or HTTP health response alone does not prove every AI model is ready. Verify model readiness and run the end-to-end checks above before announcing production readiness.
