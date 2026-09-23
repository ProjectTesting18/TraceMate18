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
