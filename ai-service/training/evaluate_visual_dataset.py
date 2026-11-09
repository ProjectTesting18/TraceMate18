"""Train/evaluate a lightweight visual-pair baseline on TraceMate's bundled CSV.

This is an offline baseline experiment on precomputed features, not a retraining
of SBERT, CLIP, or MobileNetV2. The bundled dataset's image paths point to the
original author's Windows machine, so raw images are not present in this ZIP.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path

import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, roc_auc_score, confusion_matrix
from sklearn.model_selection import train_test_split

FEATURES = ["mobilenet_cosine", "category_match", "color_similarity", "brightness_similarity", "aspect_ratio_similarity"]


def main():
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", default=str(root / "dataset-tools" / "matching-data" / "realistic_pair_features.csv"))
    parser.add_argument("--report", default=str(root / "ai-service" / "models" / "visual_dataset_evaluation.json"))
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    path = Path(args.dataset)
    if not path.exists():
        raise SystemExit(f"Dataset not found: {path}")
    df = pd.read_csv(path)
    required = FEATURES + ["match"]
    missing = [col for col in required if col not in df.columns]
    if missing:
        raise SystemExit(f"Dataset missing required columns: {missing}")
    df = df[required].dropna().copy()
    df[FEATURES] = df[FEATURES].apply(pd.to_numeric, errors="coerce")
    df["match"] = pd.to_numeric(df["match"], errors="coerce")
    df = df.dropna()
    df[FEATURES] = df[FEATURES].clip(0, 1)
    df["match"] = df["match"].astype(int)
    if len(df) < 20 or df["match"].nunique() != 2:
        raise SystemExit("Need at least 20 usable rows and both match classes.")

    x_train, x_test, y_train, y_test = train_test_split(
        df[FEATURES], df["match"], test_size=0.20,
        random_state=args.seed, stratify=df["match"],
    )
    model = RandomForestClassifier(
        n_estimators=300, min_samples_leaf=2, class_weight="balanced",
        random_state=args.seed, n_jobs=-1,
    )
    model.fit(x_train, y_train)
    pred = model.predict(x_test)
    proba = model.predict_proba(x_test)[:, 1]
    report = {
        "experiment": "random forest on precomputed visual pair features",
        "dataset": str(path),
        "dataset_rows_used": int(len(df)),
        "train_rows": int(len(x_train)),
        "test_rows": int(len(x_test)),
        "class_counts": {str(int(k)): int(v) for k, v in df["match"].value_counts().sort_index().items()},
        "features": FEATURES,
        "random_seed": args.seed,
        "accuracy": round(float(accuracy_score(y_test, pred)), 4),
        "precision": round(float(precision_score(y_test, pred, zero_division=0)), 4),
        "recall": round(float(recall_score(y_test, pred, zero_division=0)), 4),
        "f1": round(float(f1_score(y_test, pred, zero_division=0)), 4),
        "confusion_matrix_labels_0_1": confusion_matrix(y_test, pred, labels=[0, 1]).tolist(),
        "roc_auc": round(float(roc_auc_score(y_test, proba)), 4),
        "feature_importance": {name: round(float(value), 4) for name, value in zip(FEATURES, model.feature_importances_)},
        "limitations": [
            "Uses precomputed feature rows; it does not run CLIP, SBERT, or MobileNetV2 on raw images.",
            "Bundled image paths refer to an external Windows path and raw images are not included here.",
            "Random pair-level split may share image identities across splits; results are a functional baseline, not a publishable generalization estimate.",
            "The dataset labels emphasize identical-image positives and synthetic/controlled negatives, not real-world lost/found identity labels.",
        ],
    }
    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))

if __name__ == "__main__":
    main()
