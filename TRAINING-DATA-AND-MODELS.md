# TraceMate dataset and model package

## Included

- `ai-service/data/lostnet/test.zip`: supplied LostNet-style image archive, organized into 10 object categories. The training script performs a stratified 70/15/15 image split.
- `ai-service/data/lostnet/96.8cbam_finetuned_best.pth`: existing trained 10-class object-category checkpoint.
- `ai-service/data/lostnet/train_lostnet.py`: fine-tuning script. It prefers `96.8cbam.pth` if present, otherwise uses the bundled `96.8cbam_finetuned_best.pth`; new outputs are saved separately as `96.8cbam_dataset_trained_best.pth` and `96.8cbam_dataset_trained.pth`.
- `dataset-tools/matching-data/`: precomputed multimodal pair features used to train the lightweight matching baseline.
- `ai-service/models/multimodal_matcher.joblib`: newly trained Random Forest baseline.
- `ai-service/models/multimodal_matcher_metrics.json`: metrics and limitations for that baseline.

## Training that was completed during packaging

The multimodal Random Forest baseline trained successfully on 10,000 precomputed pair-feature rows (8,000 training rows / 2,000 held-out rows). Its split produced 100% metrics, but the dataset labels are controlled category-level labels and category match dominated feature importance. This is a pipeline smoke test only—not real-world identity-match accuracy and not proof that two lost/found reports are the same physical item. The model is saved but is not automatically wired into the production match score.

## Fine-tune the image classifier on your Windows PC

From the extracted project root, use PowerShell:

```powershell
cd .\ai-service\data\lostnet
python -m pip install torch torchvision pillow
$env:TRACEMATE_EPOCHS = "15"
$env:TRACEMATE_BATCH_SIZE = "16"
python train_lostnet.py
```

For a quick smoke test, set `TRACEMATE_EPOCHS` to `1`; use a supported CUDA GPU if available to speed up training. The original bundled checkpoint is not overwritten. Training report is written to `training_report.json`.

## Important limitation

The image-classifier fine-tuning attempt in the packaging environment did not finish within the available CPU execution window. Therefore this package includes the dataset, checkpoint, and repaired training script, but does **not** claim that a newly fine-tuned LostNet image-classifier checkpoint was completed here. The multimodal Random Forest baseline above was actually trained and saved.
