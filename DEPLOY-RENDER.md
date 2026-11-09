# TraceMate production deployment (Render)

This deployment keeps the existing website and its Python AI stack. It creates:

- `tracemate-web`: public Node.js service; serves the website and existing API.
- `tracemate-ai`: private Python FastAPI service; not exposed directly to the public internet.
- Persistent disk for the JSON database and a separate persistent disk for downloaded AI model caches.

## Important architecture and requirements

The browser talks only to the Node website. Node calls the Python service over Render's private network. Users do not install Python, start a second process, or download model files.

The Python service automatically warms up SBERT, MobileNetV2, CLIP, and the trained LostNet classifier. The LostNet checkpoint is part of the repository under `ai-service/data/lostnet/`. The AI service uses CPU-only PyTorch wheels; no GPU is assumed.

This Blueprint uses paid Render services and persistent disks. Render's free services cannot provide this private-service + persistent-disk production architecture. The Python service is configured with 2 CPU / 4 GB RAM as an initial minimum, not a performance guarantee. If simultaneous model loading or traffic exceeds memory/CPU, increase the plan after observing actual usage.

## Before deploying

1. Confirm the deployment pull request has been reviewed and merged into `main`.
2. In Render, choose **New → Blueprint** and connect `ProjectTesting18/TraceMate18`.
3. Select the `main` branch and the repository-root `render.yaml`.
4. Review the two services and disks before applying the Blueprint.
5. Set the prompted `ADMIN_EMAIL` and a new, unique, strong `ADMIN_PASSWORD`. Do not use `Admin@123`.

## Services defined in render.yaml

### tracemate-web

- Runtime: Node
- Build: `npm install`
- Start: `npm start`
- Health: `/api/health`
- Persistent JSON database: `/var/data/db.json`
- `AI_SERVICE_URL` is populated from the private AI service's internal host and port.

### tracemate-ai

- Runtime: Python 3.11.9
- Root directory: `ai-service`
- Build: `pip install --upgrade pip && pip install -r requirements.txt`
- Start: `uvicorn app:app --host 0.0.0.0 --port $PORT`
- Health: `/health`
- Model caches: `/var/data`
- Private service; same Render region as the Node service.

The first AI deployment downloads model weights. Keep the AI service's model-cache disk attached so downloaded weights survive future deploys. Do not remove the LostNet checkpoint from the Git repository.

## Verify after deployment

1. Open the public `tracemate-web` URL. Confirm the landing page and login page load.
2. Open `https://YOUR-WEB-SERVICE.onrender.com/api/health`; expect `ok: true`.
3. Open `https://YOUR-WEB-SERVICE.onrender.com/api/cv/health` and `/api/nlp/health`. These are proxied through Node; the private Python URL is not exposed to visitors.
4. Inspect the returned model status:
   - `lostnet.available` becomes true after the checkpoint is loaded.
   - `nlp.sbert_available` becomes true after SBERT finishes loading.
   - `cnn.available` indicates the MobileNetV2 model state.
   - `clip.available` indicates CLIP model state.
   - `hybrid_visual.available` indicates the visual combination state.
5. Wait for warm-up/downloads to finish before testing matching. A running HTTP health endpoint alone does not prove all models are ready.
6. Test a new lost report, a found report, student matching, and Admin AI Matches using real test images and descriptions.
7. Confirm records remain after a service restart/redeploy. Do not run the data-reset script on production.

## Security and data notes

- Never commit `.env`, production credentials, user records, or session tokens.
- The private AI service is not intended to be called directly by browsers.
- The JSON database is stored on the Node service's persistent disk. This is a simple single-instance starting point, not a multi-instance database architecture.
- User-uploaded images must also be verified for durable storage. If the app stores image bytes as data URLs in the JSON records, they are covered by the JSON disk; if any route writes image files to a source-relative folder, that folder must be moved to the persistent disk before production.
- Back up the persistent data disk before migrations or destructive changes.

## Troubleshooting

- **Node says AI service unavailable:** check that both services are in the same region, the private service is running, and the Blueprint populated `AI_SERVICE_URL`.
- **SBERT/CLIP/MobileNet still loading:** inspect AI logs and model cache disk capacity; allow first-time downloads to finish.
- **LostNet unavailable:** check that `ai-service/data/lostnet/96.8cbam_prepared_dataset_v2_best.pth` exists in the deployed commit and that the AI logs do not show a checkpoint or state-dict error.
- **Out of memory:** increase the Python service compute plan. Do not work around this by silently disabling a model.
- **Reports disappear after deploy:** confirm `TRACEMATE_DATA_DIR=/var/data` and the Node persistent disk mount path is exactly `/var/data`.
