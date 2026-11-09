"""Train TraceMate's multimodal matching classifier.

The model learns from similarity/metadata features. SBERT remains the text
encoder; MobileNetV2/CLIP can supply image similarity features. This script
trains only the lightweight final matching layer, not the foundation models.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import joblib
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

FEATURES = [
    "text_similarity",
    "category_match",
    "color_match",
    "location_similarity",
    "date_similarity",
    "image_similarity_mobilenet",
    "image_similarity_clip",
]


def load_features(path: str):
    df = pd.read_csv(path)
    missing = [c for c in FEATURES + ["label"] if c not in df.columns]
    if missing:
        raise ValueError(f"Missing training columns: {', '.join(missing)}")
    X = df[FEATURES].apply(pd.to_numeric, errors="coerce").fillna(0.0).clip(0, 1)
    y = pd.to_numeric(df["label"], errors="coerce")
    if y.isna().any() or not y.isin([0, 1]).all():
        raise ValueError("label must contain only 0 or 1")
    return X, y.astype(int)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--train", required=True)
    parser.add_argument("--validation", required=False)
    parser.add_argument("--model-out", default="ai-service/models/tracemate_matcher.joblib")
    args = parser.parse_args()

    X, y = load_features(args.train)
    if y.nunique() < 2:
        raise ValueError("Training data must contain both positive and negative matches.")

    pipeline = Pipeline([
        ("scaler", StandardScaler()),
        ("classifier", LogisticRegression(max_iter=1000, class_weight="balanced", random_state=42)),
    ])
    pipeline.fit(X, y)

    Path(args.model_out).parent.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": pipeline, "features": FEATURES, "version": 1}, args.model_out)

    result = {"training_rows": int(len(X)), "features": FEATURES, "model": args.model_out}

    if args.validation:
        Xv, yv = load_features(args.validation)
        pred = pipeline.predict(Xv)
        result["validation"] = {
            "rows": int(len(Xv)),
            "accuracy": round(float(accuracy_score(yv, pred)), 4),
            "precision": round(float(precision_score(yv, pred, zero_division=0)), 4),
            "recall": round(float(recall_score(yv, pred, zero_division=0)), 4),
            "f1": round(float(f1_score(yv, pred, zero_division=0)), 4),
        }

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
