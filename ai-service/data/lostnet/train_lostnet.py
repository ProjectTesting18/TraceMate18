
import random
import os
import json
from datetime import datetime, timezone
from pathlib import Path

import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
from PIL import Image
from torchvision import transforms

from mobilenet import MobileNetV2


# --------------------------------------------------
# CONFIGURATION
# --------------------------------------------------
ROOT = Path(__file__).resolve().parent

# Already prepared dataset containing train, validation, and test folders.
DATASET_ROOT = Path(
    r"D:\tracemate og full\dataset-tools\training-data"
)

# Prefer original checkpoint; otherwise use existing fine-tuned checkpoint.
CHECKPOINT_PATH = ROOT / "96.8cbam.pth"
if not CHECKPOINT_PATH.exists():
    CHECKPOINT_PATH = ROOT / "96.8cbam_finetuned_best.pth"

# Use new filenames so earlier experimental outputs are not overwritten.
OUTPUT_PATH = ROOT / "96.8cbam_prepared_dataset_v2.pth"
BEST_PATH = ROOT / "96.8cbam_prepared_dataset_v2_best.pth"
REPORT_PATH = ROOT / "training_report_prepared_dataset_v2.json"

# Preserve the class-to-index order expected by the existing model.
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

SEED = 42
EPOCHS = int(os.environ.get("TRACEMATE_EPOCHS", "15"))
BATCH_SIZE = int(os.environ.get("TRACEMATE_BATCH_SIZE", "16"))
LEARNING_RATE = 0.0001
IMAGE_SIZE = 224
NUM_WORKERS = 0

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}

random.seed(SEED)
torch.manual_seed(SEED)

if torch.cuda.is_available():
    torch.cuda.manual_seed_all(SEED)

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

print(f"Device: {DEVICE}")
print(f"Dataset: {DATASET_ROOT}")
print(f"Base checkpoint: {CHECKPOINT_PATH}")
print(f"Epochs: {EPOCHS} | Batch size: {BATCH_SIZE}")


# Match preprocessing used by the existing test script.
transform = transforms.Compose([
    transforms.Resize((IMAGE_SIZE, IMAGE_SIZE)),
    transforms.ToTensor(),
])


# --------------------------------------------------
# LOAD EXISTING PREPARED DATASET SPLITS
# --------------------------------------------------
if not DATASET_ROOT.is_dir():
    raise FileNotFoundError(
        f"Prepared dataset folder not found: {DATASET_ROOT}"
    )

if not CHECKPOINT_PATH.is_file():
    raise FileNotFoundError(
        "No starting checkpoint found. Expected one of:\n"
        f"  {ROOT / '96.8cbam.pth'}\n"
        f"  {ROOT / '96.8cbam_finetuned_best.pth'}"
    )

class_to_idx = {
    name: index for index, name in enumerate(CLASSES)
}


def load_split(split_name):
    """Load images from training-data/<split>/<class_name>/."""
    split_dir = DATASET_ROOT / split_name

    if not split_dir.is_dir():
        raise FileNotFoundError(
            f"Dataset split not found: {split_dir}"
        )

    samples = []
    print(f"\n{split_name} dataset counts:")

    for class_name in CLASSES:
        class_dir = split_dir / class_name

        if not class_dir.is_dir():
            raise RuntimeError(
                f"Missing class folder: {class_dir}"
            )

        files = sorted(
            path for path in class_dir.iterdir()
            if path.is_file()
            and path.suffix.lower() in IMAGE_EXTENSIONS
        )

        print(f"  {class_name}: {len(files)}")

        if not files:
            raise RuntimeError(
                f"No images found for class '{class_name}' "
                f"in '{split_name}'."
            )

        samples.extend(
            (path, class_to_idx[class_name])
            for path in files
        )

    if not samples:
        raise RuntimeError(
            f"No images found in the {split_name} split."
        )

    return samples


train_samples = load_split("train")
val_samples = load_split("validation")
test_samples = load_split("test")

print(
    f"\nPrepared split sizes: "
    f"train={len(train_samples)}, "
    f"validation={len(val_samples)}, "
    f"test={len(test_samples)}"
)

if not train_samples or not val_samples or not test_samples:
    raise RuntimeError("One or more dataset splits are empty.")


# --------------------------------------------------
# DATASET AND DATALOADERS
# --------------------------------------------------
class LostNetDataset(Dataset):
    def __init__(self, samples, image_transform):
        self.samples = samples
        self.transform = image_transform

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, index):
        path, label = self.samples[index]

        try:
            with Image.open(path) as image:
                image = image.convert("RGB")
                image = self.transform(image)
        except Exception as exc:
            raise RuntimeError(
                f"Cannot read image {path}: {exc}"
            ) from exc

        return image, label


train_loader = DataLoader(
    LostNetDataset(train_samples, transform),
    batch_size=BATCH_SIZE,
    shuffle=True,
    num_workers=NUM_WORKERS,
)

val_loader = DataLoader(
    LostNetDataset(val_samples, transform),
    batch_size=BATCH_SIZE,
    shuffle=False,
    num_workers=NUM_WORKERS,
)

test_loader = DataLoader(
    LostNetDataset(test_samples, transform),
    batch_size=BATCH_SIZE,
    shuffle=False,
    num_workers=NUM_WORKERS,
)


# --------------------------------------------------
# LOAD EXISTING MODEL AND CHECKPOINT
# --------------------------------------------------
model = MobileNetV2(num_classes=len(CLASSES)).to(DEVICE)

checkpoint = torch.load(
    CHECKPOINT_PATH,
    map_location=DEVICE,
)

# Handle common checkpoint formats.
if isinstance(checkpoint, dict):
    if "state_dict" in checkpoint:
        checkpoint = checkpoint["state_dict"]
    elif "model_state_dict" in checkpoint:
        checkpoint = checkpoint["model_state_dict"]

if not isinstance(checkpoint, dict):
    raise RuntimeError(
        "Checkpoint does not contain a state dictionary."
    )

# Remove DataParallel prefixes if present.
checkpoint = {
    key.removeprefix("module."): value
    for key, value in checkpoint.items()
}

# Strict loading prevents silently ignoring architecture differences.
model.load_state_dict(checkpoint, strict=True)

print("\nExisting checkpoint loaded successfully.")


# --------------------------------------------------
# TRAINING
# --------------------------------------------------
criterion = nn.CrossEntropyLoss()

optimizer = torch.optim.AdamW(
    model.parameters(),
    lr=LEARNING_RATE,
    weight_decay=0.0001,
)

best_val_accuracy = -1.0


def evaluate(eval_model, loader):
    eval_model.eval()
    total = 0
    correct = 0
    total_loss = 0.0

    with torch.no_grad():
        for images, labels in loader:
            images = images.to(DEVICE)
            labels = labels.to(DEVICE)

            outputs = eval_model(images)

            if (
                outputs.ndim != 2
                or outputs.shape[1] != len(CLASSES)
            ):
                raise RuntimeError(
                    f"Expected model output [batch, {len(CLASSES)}], "
                    f"got {tuple(outputs.shape)}"
                )

            loss = criterion(outputs, labels)
            total_loss += loss.item() * labels.size(0)

            predictions = outputs.argmax(dim=1)
            correct += (predictions == labels).sum().item()
            total += labels.size(0)

    accuracy = 100.0 * correct / max(total, 1)
    average_loss = total_loss / max(total, 1)

    return average_loss, accuracy


for epoch in range(1, EPOCHS + 1):
    model.train()

    running_loss = 0.0
    total = 0
    correct = 0

    for images, labels in train_loader:
        images = images.to(DEVICE)
        labels = labels.to(DEVICE)

        optimizer.zero_grad(set_to_none=True)

        outputs = model(images)

        if (
            outputs.ndim != 2
            or outputs.shape[1] != len(CLASSES)
        ):
            raise RuntimeError(
                f"Expected model output [batch, {len(CLASSES)}], "
                f"got {tuple(outputs.shape)}"
            )

        loss = criterion(outputs, labels)
        loss.backward()
        optimizer.step()

        running_loss += loss.item() * labels.size(0)

        predictions = outputs.argmax(dim=1)
        correct += (predictions == labels).sum().item()
        total += labels.size(0)

    train_loss = running_loss / max(total, 1)
    train_accuracy = 100.0 * correct / max(total, 1)

    val_loss, val_accuracy = evaluate(model, val_loader)

    print(
        f"Epoch {epoch:02d}/{EPOCHS} | "
        f"train loss={train_loss:.4f} | "
        f"train acc={train_accuracy:.2f}% | "
        f"val loss={val_loss:.4f} | "
        f"val acc={val_accuracy:.2f}%"
    )

    if val_accuracy > best_val_accuracy:
        best_val_accuracy = val_accuracy
        torch.save(model.state_dict(), BEST_PATH)

        print(f"  Saved best checkpoint: {BEST_PATH.name}")


# --------------------------------------------------
# SAVE FINAL MODEL AND EVALUATE ON HELD-OUT TEST SET
# --------------------------------------------------
torch.save(model.state_dict(), OUTPUT_PATH)

best_model = MobileNetV2(num_classes=len(CLASSES)).to(DEVICE)

best_model.load_state_dict(
    torch.load(BEST_PATH, map_location=DEVICE),
    strict=True,
)

test_loss, test_accuracy = evaluate(best_model, test_loader)

print("\nTraining finished.")
print(f"Best validation accuracy: {best_val_accuracy:.2f}%")
print(f"Held-out test loss: {test_loss:.4f}")
print(f"Held-out test accuracy: {test_accuracy:.2f}%")
print(f"Best checkpoint: {BEST_PATH}")
print(f"Final checkpoint: {OUTPUT_PATH}")


# --------------------------------------------------
# SAVE TRAINING REPORT
# --------------------------------------------------
report = {
    "created_at_utc": datetime.now(timezone.utc).isoformat(),
    "dataset_source": str(DATASET_ROOT),
    "dataset_classes": CLASSES,
    "train_images": len(train_samples),
    "validation_images": len(val_samples),
    "test_images": len(test_samples),
    "epochs_requested": EPOCHS,
    "batch_size": BATCH_SIZE,
    "learning_rate": LEARNING_RATE,
    "best_validation_accuracy_percent": best_val_accuracy,
    "held_out_test_loss": test_loss,
    "held_out_test_accuracy_percent": test_accuracy,
    "base_checkpoint": CHECKPOINT_PATH.name,
    "best_checkpoint": BEST_PATH.name,
    "final_checkpoint": OUTPUT_PATH.name,
    "note": (
        "This is a 10-class lost-item object-category classifier, "
        "not a same-physical-item matching model. The held-out split "
        "is image-level and may not measure real-world lost/found "
        "matching accuracy."
    ),
}

REPORT_PATH.write_text(
    json.dumps(report, indent=2),
    encoding="utf-8",
)

print(f"Training report: {REPORT_PATH}")
print("Original bundled checkpoints were not overwritten.")
