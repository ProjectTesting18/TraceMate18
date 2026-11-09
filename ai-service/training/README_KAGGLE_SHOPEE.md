# Kaggle multimodal training for TraceMate

## Dataset choice

Use Kaggle's **Shopee Price Match Guarantee** competition (`shopee-product-matching`). Its `train.csv` has `posting_id`, `image`, `title`, and `label_group`; a shared `label_group` indicates listings for the same/near-duplicate product. This is a useful public proxy for multimodal product matching, but it is **not** a lost-and-found dataset and cannot prove performance on lost property photographed in different settings.

Competition page: https://www.kaggle.com/competitions/shopee-product-matching/data

## 1. Configure Kaggle

1. Sign in to Kaggle, open the competition page, and accept its rules.
2. In Kaggle Account settings, create/download an API token (`kaggle.json`).
3. Put it at `%USERPROFILE%\.kaggle\kaggle.json` and protect it; do not commit it or include it in a ZIP.
4. In PowerShell from the TraceMate root:

```powershell
python -m pip install -r ai-service/requirements.txt
python -m pip install kaggle
python ai-service/training/train_from_kaggle_shopee.py --download --max-images 4000 --device auto
```

The first run downloads model weights and Kaggle data and may take a while. Ensure enough free disk space. Increase `--max-images` gradually (for example 8000, then 16000) after the smaller run works. `--max-images 0` attempts all available images and can require substantial RAM, disk, and GPU/CPU time.

If Kaggle CLI doesn't extract `train_images.zip`, extract it so the directory is `data/kaggle/shopee-product-matching/train_images/` and run again without `--download`.

## 2. What is actually trained

- **SBERT** `all-MiniLM-L6-v2`: frozen semantic text embeddings.
- **CLIP** `openai/clip-vit-base-patch32`: frozen image embeddings.
- **MobileNetV2 CNN**: frozen image embeddings.
- A **supervised logistic-regression pair scorer** is trained on SBERT cosine, CLIP cosine, MobileNetV2 cosine, title token overlap, and color-histogram similarity.

This first stage deliberately freezes foundation encoders; it does not fine-tune SBERT/CLIP/CNN weights. Fine-tuning needs a larger controlled experiment, GPU budget, and held-out TraceMate-style labels. The output scorer is saved to `ai-service/models/kaggle_shopee/` and is not automatically plugged into production `app.py` until separately validated and integrated.

## 3. Evaluation safeguards

The script splits by `label_group` so a product identity cannot appear across train/validation/test splits. It reports accuracy, precision, recall, F1 and ROC-AUC on held-out pair rows. Results apply only to this e-commerce proxy dataset. Before using the scorer in TraceMate, collect consented lost/found pairs with verified match/non-match labels, include different-angle photos and hard negatives, and evaluate by report/item identity with no leakage.

Never commit Kaggle credentials or redistribute competition files. Follow Kaggle competition rules and dataset license.
