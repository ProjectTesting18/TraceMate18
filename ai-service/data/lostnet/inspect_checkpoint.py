import torch

checkpoint = torch.load(
    "96.8cbam.pth",
    map_location="cpu",
    weights_only=True
)

print("\n=== Checkpoint architecture clues ===")
for key, value in checkpoint.items():
    if isinstance(value, torch.Tensor) and (
        key.startswith("features.0.")
        or key.startswith("features.1.")
        or key.startswith("features.2.")
        or key.startswith("features.3.")
        or key.startswith("features.8.")
        or key.startswith("features.9.")
        or key.startswith("features.18.")
        or key.startswith("classifier.")
    ):
        print(f"{key}: {tuple(value.shape)}")

print("\nTotal tensors:", len(checkpoint))
