# TraceMate Training & Evaluation Pipeline

This folder prepares the project for a real labeled Lost & Found dataset.
It does **not** invent training data and it does **not** retrain SBERT,
MobileNetV2, or CLIP from scratch.

## Planned flow

1. Import a permitted public/research dataset.
2. Normalize it into `training-data/raw/pairs.csv`.
3. Run `prepare_dataset.py` to validate labels and create a stratified
   70/15/15 train/validation/test split.
4. Generate the feature columns used by the final matcher. The important
   columns are:
   - `text_similarity` (SBERT score)
   - `category_match`
   - `color_match`
   - `location_similarity`
   - `date_similarity`
   - `image_similarity_mobilenet`
   - `image_similarity_clip`
   - `label` (0 = different item, 1 = matching item)
5. Train the lightweight final matching layer with `train_matcher.py`.
6. Evaluate only on the held-out test set with `evaluate_matcher.py`.

## Dataset pair schema

Required raw columns:

```text
lost_id, found_id, lost_description, found_description, label
```

Optional columns:

```text
category_match, color_match, location_similarity, date_similarity,
image_similarity_mobilenet, image_similarity_clip
```

All similarity/match features are expected in the range 0..1.

## Commands

From the project root:

```powershell
python ai-service/training/prepare_dataset.py --input training-data/raw/pairs.csv --output-dir training-data
```

After feature generation:

```powershell
python ai-service/training/train_matcher.py --train training-data/train/pairs.csv --validation training-data/validation/pairs.csv
```

Then evaluate the untouched test split:

```powershell
python ai-service/training/evaluate_matcher.py --test training-data/test/pairs.csv
```

The trained artifact is written to `ai-service/models/tracemate_matcher.joblib`.
The evaluation report is written to `ai-service/models/evaluation_report.json`.

## Important

Do not report accuracy/F1/etc. until a real labeled test set has been
used. The current TraceMate sample data is for functional testing, not a
scientific evaluation dataset.
