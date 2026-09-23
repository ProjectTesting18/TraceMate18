# TraceMate — Fixed NLP + CNN Backend

This version fixes the backend integration so the Node server does not depend on MongoDB or on a working PyTorch installation.

## What was fixed

- Added a lightweight NLP service using token normalization + TF-IDF cosine similarity.
- Added `POST /nlp/text-similarity`.
- Added Node proxy `POST /api/ai/text-similarity`.
- Added `/api/nlp/health`.
- Made PyTorch/torchvision lazy-loaded so a CNN import error cannot crash FastAPI.
- Added a deterministic image-feature fallback when PyTorch/torchvision is unavailable.
- Kept MobileNetV2 as the preferred CNN extractor when compatible PyTorch packages are installed.
- Fixed the admin-page `null.innerHTML` problem by adding the missing AI workflow table and guarding the optional pending-user table.
- Made matching dependency-free and robust against missing fields.
- Kept the final admin decision manual; AI only provides candidate scores.

## 1. Start the Node backend

From the project root:

```powershell
npm install
npm start
```

Expected:

```text
TraceMate server running at http://localhost:5000
```

Test:

```text
http://localhost:5000/api/health
```

## 2. Start the AI service

Open a second PowerShell window:

```powershell
cd ai-service
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
python app.py
```

Expected:

```text
Uvicorn running on http://127.0.0.1:8001
```

Test:

```text
http://127.0.0.1:8001/health
```

## 3. Optional MobileNetV2 CNN

The AI service works without PyTorch. If your Python/platform has compatible PyTorch wheels, install:

```powershell
pip install -r requirements-cnn.txt
```

Then the image embedding endpoint will use pretrained MobileNetV2. Without it, the service uses a clearly labeled color-histogram fallback so NLP and the rest of the backend remain available.

## NLP test

Run:

```powershell
python test_nlp.py
```

Example request:

```json
{
  "text1": "black Nike backpack near college library",
  "text2": "black backpack with Nike logo found near library"
}
```

Endpoint:

```text
POST http://127.0.0.1:8001/nlp/text-similarity
```

or through Node:

```text
POST http://127.0.0.1:5000/api/ai/text-similarity
```

The result includes a similarity score and token overlap.

## Important

The NLP score is a matching similarity score, not model accuracy. The CNN similarity percentage is also a normalized similarity score, not classification accuracy.

The system should be evaluated later with labeled lost/found pairs before claiming an accuracy figure in a research paper.
