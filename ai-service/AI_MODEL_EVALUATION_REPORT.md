# TraceMate AI model update and validation report

## Changes made

- **NLP/SBERT fallback:** Added audio-item aliases so `headphones`, `headsets`, `earbuds`, and `earphones` are treated as one broad candidate family during retrieval. This avoids an accidental object-family conflict; it does not claim the two items are identical.
- **CNN/MobileNetV2 and CLIP scoring:** Corrected cosine-to-percentage conversion in `services/cnn_service.py` and `services/image_similarity.py`. A cosine of 0 (orthogonal embeddings) now reports 0% similarity instead of the misleading 50%; 1.0 remains 100%. Negative cosine is clamped to 0. These values are similarity scores, not calibrated probabilities.
- **Regression tests:** Added `test_model_regression.py` and expanded `test_nlp.py` for identical-image embeddings, different-color fixtures, hybrid model availability, CLIP embedding comparisons, empty text, explicit object conflicts, and headphone/earphone aliases.
- **Dataset baseline script:** Added `training/evaluate_visual_dataset.py`, which makes a repeatable stratified holdout evaluation from the bundled precomputed visual-pair features and writes a JSON report.

## Test results in this environment

- Python AI-service tests: **17 passed, 0 failed**.
- JavaScript project tests: **109 passed, 0 failed**.
- Python syntax compilation: passed.
- Bundled feature dataset: 2,073 rows (1,382 negative, 691 positive); baseline holdout 1,658 train / 415 test.

The lightweight Random Forest experiment reported 100% on this controlled split. **Do not interpret that as real-world accuracy.** The bundled labels are controlled/mostly identical-image positives, source image paths point to an external Windows directory, and pair-level splitting can leak image identities across train/test. The result is retained as a pipeline smoke test, not evidence of production performance.

## What was not possible to validate here

- `sentence-transformers` and `transformers` are not installed in this execution environment, so this run did **not** load real SBERT or CLIP weights or measure their semantic/visual benchmark accuracy.
- The ZIP contains precomputed feature CSVs but not the raw images referenced by those CSVs. Therefore this run did **not** retrain MobileNetV2/CLIP or evaluate them on a fresh, labeled real-photo dataset.
- The added tests validate score math, fallbacks, and integration contracts. They do not replace a held-out real lost/found dataset with same-item/different-angle positives and hard negatives.

## Commands to rerun on Windows

From the extracted project root, activate the AI-service virtual environment, install `ai-service/requirements.txt` and (if GPU/CPU wheels are compatible) `ai-service/requirements-vision.txt`, then run:

```powershell
python -m unittest discover -s ai-service -p "test*.py" -v
python ai-service/training/evaluate_visual_dataset.py
npm test
```

For a scientifically meaningful evaluation, place a permitted labeled dataset of real lost/found pairs into the documented schema, split by item identity (not just pair rows), and report precision/recall/F1/ROC-AUC on an untouched test set. Calibrate the final match score before interpreting it as confidence.
