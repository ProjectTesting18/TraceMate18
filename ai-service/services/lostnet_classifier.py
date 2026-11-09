from pathlib import Path
from threading import Lock

import torch
from PIL import Image
from torchvision import transforms

from data.lostnet.mobilenet import MobileNetV2

ROOT = Path(__file__).resolve().parent
import os

MODEL_PATH = Path(
    os.getenv(
        "TRACEMATE_LOSTNET_CHECKPOINT",
        str(ROOT.parent / "data" / "lostnet" / "96.8cbam_prepared_dataset_v2_best.pth"),
    )
)

CLASSES = [
    "USBflashdisk",
    "bag",
    "book",
    "card",
    "earphone",
    "key",
    "lipstick",
    "phone",
    "umbrella",
    "vacuumcup",
]

_TRANSFORM = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
])

_MODEL = None
_LOCK = Lock()


def _get_model():
    global _MODEL

    if _MODEL is None:
        with _LOCK:
            if _MODEL is None:
                if not MODEL_PATH.is_file():
                    raise FileNotFoundError(
                        f"LostNet checkpoint not found: {MODEL_PATH}"
                    )

                model = MobileNetV2(num_classes=len(CLASSES))
                checkpoint = torch.load(
                    MODEL_PATH,
                    map_location="cpu",
                    weights_only=True,
                )

                if isinstance(checkpoint, dict) and "state_dict" in checkpoint:
                    checkpoint = checkpoint["state_dict"]

                model.load_state_dict(checkpoint, strict=True)
                model.eval()
                _MODEL = model

    return _MODEL


def classify_image(image_bytes: bytes) -> dict:
    if not image_bytes:
        raise ValueError("Image data is empty.")

    from io import BytesIO

    with Image.open(BytesIO(image_bytes)) as source:
        image = source.convert("RGB")

    tensor = _TRANSFORM(image).unsqueeze(0)
    model = _get_model()

    with torch.inference_mode():
        logits = model(tensor)
        probabilities = torch.softmax(logits, dim=1)[0]
        index = int(torch.argmax(probabilities).item())

    return {
        "model": "LostNet-MobileNetV2-CBAM",
        "predicted_class": CLASSES[index],
        "confidence": round(float(probabilities[index].item()), 6),
        "confidence_percent": round(
            float(probabilities[index].item()) * 100, 2
        ),
        "classes": [
            {
                "label": CLASSES[i],
                "probability": round(float(probabilities[i].item()), 6),
            }
            for i in torch.argsort(probabilities, descending=True).tolist()
        ],
    }
