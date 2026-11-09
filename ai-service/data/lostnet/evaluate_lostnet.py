import torch
from pathlib import Path
from torch.utils.data import Dataset, DataLoader
from torchvision import transforms
from PIL import Image
from mobilenet import MobileNetV2

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "lostnet_extracted"
MODEL_PATH = ROOT / "96.8cbam_finetuned_best.pth"

CLASSES = [
    "USBflashdisk", "bag", "book", "card", "earphone",
    "key", "lipstick", "phone", "umbrella", "vacuumcup"
]

device = torch.device("cpu")
transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor()
])

class ImageDataset(Dataset):
    def __init__(self):
        self.items = []
        for label, name in enumerate(CLASSES):
            folder = DATA_DIR / name
            if not folder.exists():
                raise FileNotFoundError(f"Missing folder: {folder}")
            for path in sorted(folder.iterdir()):
                if path.suffix.lower() in {".jpg", ".jpeg", ".png", ".bmp", ".webp"}:
                    self.items.append((path, label))

    def __len__(self):
        return len(self.items)

    def __getitem__(self, i):
        path, label = self.items[i]
        with Image.open(path) as im:
            return transform(im.convert("RGB")), label

model = MobileNetV2(num_classes=len(CLASSES)).to(device)
state = torch.load(MODEL_PATH, map_location=device)
model.load_state_dict(state, strict=True)
model.eval()

dataset = ImageDataset()
loader = DataLoader(dataset, batch_size=16, shuffle=False, num_workers=0)
correct, total = 0, 0
per_class = torch.zeros(len(CLASSES), 2, dtype=torch.int64)

with torch.no_grad():
    for images, labels in loader:
        predictions = model(images).argmax(dim=1)
        correct += (predictions == labels).sum().item()
        total += len(labels)
        for actual, pred in zip(labels, predictions):
            per_class[actual, 1] += 1
            if actual == pred:
                per_class[actual, 0] += 1

print(f"\nOverall accuracy on extracted dataset: {100 * correct / max(total, 1):.2f}%")
for i, name in enumerate(CLASSES):
    hit, count = per_class[i].tolist()
    print(f"{name}: {hit}/{count} ({100 * hit / max(count, 1):.2f}%)")
