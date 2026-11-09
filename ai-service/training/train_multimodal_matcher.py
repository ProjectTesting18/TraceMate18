"""
TraceMate - Multimodal Matching Model

Purpose:
    Train and evaluate a Random Forest classifier using
    multimodal visual features.

Input:
    dataset-tools/matching-data/multimodal_pair_features.csv

Features:
    - MobileNetV2 cosine similarity
    - Category match
    - Color similarity
    - Brightness similarity
    - Aspect-ratio similarity

Target:
    match

IMPORTANT:
    The current dataset contains category-level matching labels.
    This is an experimental multimodal baseline and NOT a
    real Lost-vs-Found identity-matching evaluation.
"""

from pathlib import Path
import sys
import json
from datetime import datetime, timezone
import joblib

import numpy as np
import pandas as pd

from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    roc_auc_score,
    confusion_matrix,
    classification_report,
)


# ============================================================
# PATHS
# ============================================================

PROJECT_ROOT = Path(__file__).resolve().parents[2]

FEATURE_FILE = (
    PROJECT_ROOT
    / "dataset-tools"
    / "matching-data"
    / "multimodal_pair_features.csv"
)


# ============================================================
# FEATURES
# ============================================================

FEATURE_COLUMNS = [
    "mobilenet_cosine",
    "category_match",
    "color_similarity",
    "brightness_similarity",
    "aspect_ratio_similarity",
]

TARGET_COLUMN = "match"


# ============================================================
# MAIN
# ============================================================

def main():

    print("=" * 70)
    print("TraceMate Multimodal Matching Model")
    print("=" * 70)

    # --------------------------------------------------------
    # Load dataset
    # --------------------------------------------------------

    if not FEATURE_FILE.exists():

        print()
        print("ERROR: Feature dataset not found:")
        print(FEATURE_FILE)

        sys.exit(1)

    print()
    print("Feature dataset:")
    print(FEATURE_FILE)

    df = pd.read_csv(FEATURE_FILE)

    print()
    print(f"Rows: {len(df)}")

    # --------------------------------------------------------
    # Validate columns
    # --------------------------------------------------------

    required_columns = FEATURE_COLUMNS + [TARGET_COLUMN]

    missing_columns = [
        column
        for column in required_columns
        if column not in df.columns
    ]

    if missing_columns:

        print()
        print("ERROR: Missing columns:")
        print(missing_columns)

        sys.exit(1)

    # --------------------------------------------------------
    # Check missing values
    # --------------------------------------------------------

    missing_values = (
        df[required_columns]
        .isna()
        .sum()
    )

    if missing_values.sum() > 0:

        print()
        print("ERROR: Missing values detected:")

        print(
            missing_values[
                missing_values > 0
            ].to_string()
        )

        sys.exit(1)

    # --------------------------------------------------------
    # Features and target
    # --------------------------------------------------------

    X = df[FEATURE_COLUMNS].copy()

    y = df[TARGET_COLUMN].astype(int)

    print()
    print("Features:")

    for feature in FEATURE_COLUMNS:
        print(f"  - {feature}")

    print()
    print("Labels:")

    print(
        y.value_counts()
        .sort_index()
        .to_string()
    )

    # --------------------------------------------------------
    # Train/test split
    # --------------------------------------------------------

    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=0.20,
        random_state=42,
        stratify=y,
    )

    print()
    print(f"Training rows: {len(X_train)}")
    print(f"Testing rows:  {len(X_test)}")

    # --------------------------------------------------------
    # Random Forest
    # --------------------------------------------------------

    print()
    print("=" * 70)
    print("Training Multimodal Random Forest")
    print("=" * 70)

    model = RandomForestClassifier(
        n_estimators=300,
        max_depth=10,
        min_samples_leaf=4,
        random_state=42,
        class_weight="balanced",
        n_jobs=-1,
    )

    model.fit(
        X_train,
        y_train,
    )

    print()
    print("Training completed.")

    # --------------------------------------------------------
    # Predictions
    # --------------------------------------------------------

    y_pred = model.predict(X_test)

    y_probability = model.predict_proba(X_test)[:, 1]

    # --------------------------------------------------------
    # Metrics
    # --------------------------------------------------------

    accuracy = accuracy_score(
        y_test,
        y_pred,
    )

    precision = precision_score(
        y_test,
        y_pred,
        zero_division=0,
    )

    recall = recall_score(
        y_test,
        y_pred,
        zero_division=0,
    )

    f1 = f1_score(
        y_test,
        y_pred,
        zero_division=0,
    )

    roc_auc = roc_auc_score(
        y_test,
        y_probability,
    )

    # --------------------------------------------------------
    # Results
    # --------------------------------------------------------

    print()
    print("=" * 70)
    print("MULTIMODAL MODEL RESULTS")
    print("=" * 70)

    print()
    print(f"Accuracy:  {accuracy * 100:.2f}%")
    print(f"Precision: {precision * 100:.2f}%")
    print(f"Recall:    {recall * 100:.2f}%")
    print(f"F1 Score:  {f1 * 100:.2f}%")
    print(f"ROC-AUC:   {roc_auc * 100:.2f}%")

    # --------------------------------------------------------
    # Confusion matrix
    # --------------------------------------------------------

    cm = confusion_matrix(
        y_test,
        y_pred,
        labels=[0, 1],
    )

    print()
    print("=" * 70)
    print("CONFUSION MATRIX")
    print("=" * 70)

    print()
    print("                    Predicted")
    print("                  Negative Positive")
    print(
        f"Actual Negative   "
        f"{cm[0, 0]:8d} {cm[0, 1]:8d}"
    )
    print(
        f"Actual Positive   "
        f"{cm[1, 0]:8d} {cm[1, 1]:8d}"
    )

    # --------------------------------------------------------
    # Classification report
    # --------------------------------------------------------

    print()
    print("=" * 70)
    print("CLASSIFICATION REPORT")
    print("=" * 70)

    print()

    print(
        classification_report(
            y_test,
            y_pred,
            target_names=[
                "Negative",
                "Positive",
            ],
            zero_division=0,
        )
    )

    # --------------------------------------------------------
    # Feature importance
    # --------------------------------------------------------

    print()
    print("=" * 70)
    print("FEATURE IMPORTANCE")
    print("=" * 70)

    importances = model.feature_importances_

    importance_table = (
        pd.DataFrame(
            {
                "feature": FEATURE_COLUMNS,
                "importance": importances,
            }
        )
        .sort_values(
            "importance",
            ascending=False,
        )
    )

    print()

    for _, row in importance_table.iterrows():

        print(
            f"{row['feature']:<28} : "
            f"{row['importance']:.4f}"
        )

    # --------------------------------------------------------
    # Compare category-only importance
    # --------------------------------------------------------

    category_importance = float(
        importance_table.loc[
            importance_table["feature"]
            == "category_match",
            "importance",
        ].iloc[0]
    )

    visual_importance = float(
        importance_table.loc[
            importance_table["feature"]
            != "category_match",
            "importance",
        ].sum()
    )

    print()
    print("=" * 70)
    print("CATEGORY VS OTHER FEATURES")
    print("=" * 70)

    print()
    print(
        f"Category-match importance : "
        f"{category_importance * 100:.2f}%"
    )

    print(
        f"Other-feature importance  : "
        f"{visual_importance * 100:.2f}%"
    )

    # Save trained model and a metrics report. This is a category-level baseline,
    # not a calibrated same-physical-item identity matcher.
    model_dir = PROJECT_ROOT / "ai-service" / "models"
    model_dir.mkdir(parents=True, exist_ok=True)
    model_path = model_dir / "multimodal_matcher.joblib"
    joblib.dump({"model": model, "feature_columns": FEATURE_COLUMNS}, model_path)
    metrics_path = model_dir / "multimodal_matcher_metrics.json"
    metrics = {
        "created_at_utc": datetime.now(timezone.utc).isoformat(),
        "dataset": str(FEATURE_FILE.relative_to(PROJECT_ROOT)),
        "rows": int(len(df)),
        "train_rows": int(len(X_train)),
        "test_rows": int(len(X_test)),
        "accuracy": float(accuracy),
        "precision": float(precision),
        "recall": float(recall),
        "f1": float(f1),
        "roc_auc": float(roc_auc),
        "feature_columns": FEATURE_COLUMNS,
        "target_column": TARGET_COLUMN,
        "limitation": "Controlled category-level pair labels; 100% held-out scores indicate this dataset is too easy/leaky for real-world lost/found identity claims. Not calibrated and not wired into runtime matching automatically."
    }
    metrics_path.write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    print(f"Trained model saved to: {model_path}")
    print(f"Metrics report saved to: {metrics_path}")

    # --------------------------------------------------------
    # Save feature importance
    # --------------------------------------------------------

    importance_file = (
        PROJECT_ROOT
        / "dataset-tools"
        / "matching-data"
        / "multimodal_feature_importance.csv"
    )

    importance_table.to_csv(
        importance_file,
        index=False,
    )

    # --------------------------------------------------------
    # Final message
    # --------------------------------------------------------

    print()
    print("=" * 70)
    print("MULTIMODAL BASELINE COMPLETE")
    print("=" * 70)

    print()
    print(
        "Feature importance saved to:"
    )

    print(importance_file)

    print()
    print(
        "IMPORTANT:"
    )

    print(
        "This experiment uses category-level pair labels."
    )

    print(
        "It should not be reported as real-world "
        "Lost-vs-Found identity matching accuracy."
    )

    print()
    print("=" * 70)


if __name__ == "__main__":
    main()