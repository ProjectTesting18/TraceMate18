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
