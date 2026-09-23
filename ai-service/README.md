# TraceMate AI Service — CNN Foundation

This service is the first Computer Vision component of TraceMate.

## What it does

- Uses pretrained MobileNetV2 as a CNN visual feature extractor.
- Removes the ImageNet classification head and produces a visual embedding.
- Compares two item images using cosine similarity.
- Provides a health endpoint and an image-similarity endpoint.

This is a research baseline. We will add CLIP after this CNN stage is working.

## Windows setup

From this `ai-service` folder:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
python app.py
```

If PowerShell blocks activation, use:

```powershell
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\pip.exe install -r requirements.txt
.\.venv\Scripts\python.exe app.py
```

The first CNN request may download the pretrained MobileNetV2 weights from the PyTorch model repository. Internet access is required for that first download.

## API

Health:

`GET http://127.0.0.1:8001/health`

Compare two local images:

`POST http://127.0.0.1:8001/cv/image-similarity`

Form fields:

- `image1`
- `image2`

The response contains:

- cosine similarity in the range -1 to 1
- similarity percentage scaled to 0–100
- model name

## Important

Do not train a CNN from scratch at this stage. We are using transfer learning/feature extraction first. Later, we can evaluate whether a campus-specific fine-tuned model is justified by the dataset.
