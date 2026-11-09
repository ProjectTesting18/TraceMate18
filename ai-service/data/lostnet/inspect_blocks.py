import torch

state = torch.load(
    "96.8cbam.pth",
    map_location="cpu",
    weights_only=True
)

for i in range(19):
    prefix = f"features.{i}."
    entries = [
        (k, tuple(v.shape))
        for k, v in state.items()
        if k.startswith(prefix) and isinstance(v, torch.Tensor)
        and k.endswith("weight")
    ]
    if entries:
        print(f"\nBlock {i}:")
        for key, shape in entries:
            print(f"  {key}: {shape}")
