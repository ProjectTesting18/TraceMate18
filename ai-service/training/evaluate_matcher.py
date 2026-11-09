"""Evaluate the trained TraceMate matcher on a held-out test set."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import joblib
import pandas as pd
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--test", required=True)
    parser.add_argument("--model", default="ai-service/models/tracemate_matcher.joblib")
    parser.add_argument("--report-out", default="ai-service/models/evaluation_report.json")
    args = parser.parse_args()

    bundle = joblib.load(args.model)
    model = bundle["model"]
    features = bundle["features"]

    df = pd.read_csv(args.test)
    missing = [c for c in features + ["label"] if c not in df.columns]
    if missing:
        raise ValueError(f"Missing test columns: {', '.join(missing)}")

    X = df[features].apply(pd.to_numeric, errors="coerce").fillna(0.0).clip(0, 1)
    y = pd.to_numeric(df["label"], errors="coerce").astype(int)
    pred = model.predict(X)
    probability = model.predict_proba(X)[:, 1]

    report = {
        "test_rows": int(len(df)),
        "accuracy": round(float(accuracy_score(y, pred)), 4),
        "precision": round(float(precision_score(y, pred, zero_division=0)), 4),
        "recall": round(float(recall_score(y, pred, zero_division=0)), 4),
        "f1": round(float(f1_score(y, pred, zero_division=0)), 4),
        "confusion_matrix": confusion_matrix(y, pred).tolist(),
        "classification_report": classification_report(y, pred, output_dict=True, zero_division=0),
    }
    if y.nunique() == 2:
        report["roc_auc"] = round(float(roc_auc_score(y, probability)), 4)

    Path(args.report_out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.report_out).write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
