# TraceMate — Original UI + CNN/CV Integrated Build

This build uses the original TraceMate login/dashboard UI and integrates the CNN/CV and admin workflow developed separately.

## Services

- TraceMate web app + Node backend: http://localhost:5000
- CNN Computer Vision service: http://127.0.0.1:8001

## Run

### Terminal 1 — backend
```powershell
cd "C:\path\to\TraceMate-Merged"
npm install
npm start
```

### Terminal 2 — CNN service
```powershell
cd "C:\path\to\TraceMate-Merged\ai-service"
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m uvicorn app:app --reload --port 8001
```

Then open http://localhost:5000. No Live Server is required because the Node server serves the original frontend.

## Admin workflow

Submitted found item -> Admin receives physical item -> AI/CNN candidates -> Admin confirms match -> owner notified -> owner comes to Admin Office -> Student ID verification -> Admin returns item.

## CNN

The Python service uses pretrained MobileNetV2 as a CNN visual feature extractor. It stores normalized embeddings and uses cosine similarity. The similarity percentage is a normalized similarity score, not model accuracy.

## Important

Do not copy this project over MarketIQ. It is a separate TraceMate project.
