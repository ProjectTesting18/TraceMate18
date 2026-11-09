
import zipfile
import io
from pathlib import Path

import torch
from PIL import Image
from torchvision import transforms
from mobilenet import MobileNetV2

CLASSES = [
    "USBflashdisk", "bag", "book", "card", "earphone",
    "key", "lipstick", "phone", "umbrella", "vacuumcup"
]

BASE = Path(__file__).resolve().parent
CHECKPOINT = BASE / "96.8cbam.pth"
DATASET = BASE / "test.zip"


def main():
    print("Device: CPU")
    print("PyTorch:", torch.__version__)

    if not CHECKPOINT.exists():
        raise FileNotFoundError(f"Checkpoint not found: {CHECKPOINT}")

    if not DATASET.exists():
        raise FileNotFoundError(f"Dataset not found: {DATASET}")

    state = torch.load(
        CHECKPOINT,
        map_location="cpu",
        weights_only=True
    )

    model = MobileNetV2(num_classes=len(CLASSES))
    model.load_state_dict(state, strict=True)
    model.eval()

    print("Model weights loaded successfully.")

    with zipfile.ZipFile(DATASET) as archive:
        candidates = [
            name for name in archive.namelist()
            if name.lower().endswith((".jpg", ".jpeg", ".png"))
            and "/" in name
            and not name.endswith("/")
        ]

        if not candidates:
            raise RuntimeError("No images found inside test.zip.")

        sample = next(
            (name for name in candidates
             if name.lower().startswith("bag/")),
            candidates[0]
        )

        with archive.open(sample) as image_file:
            image = Image.open(
                io.BytesIO(image_file.read())
            ).convert("RGB")

    transform = transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.ToTensor()
    ])

    tensor = transform(image).unsqueeze(0)

    with torch.inference_mode():
        logits = model(tensor)
        probabilities = torch.softmax(logits, dim=1)[0]

    print("\nSample image:", sample)
    print("Output shape:", tuple(logits.shape))

    print("\nRaw logits:")
    for name, score in zip(CLASSES, logits[0].tolist()):
        print(f"  {name}: {score:.6f}")

    print("\nAll class probabilities:")
    for name, score in zip(CLASSES, probabilities.tolist()):
        print(f"  {name}: {score * 100:.6f}%")

    index = int(probabilities.argmax())

    print("\nPredicted category:", CLASSES[index])
    print(
        "Top-class score:",
        f"{probabilities[index].item() * 100:.2f}%"
    )


if __name__ == "__main__":
    main()
