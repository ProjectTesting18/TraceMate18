"""
TraceMate - Visual Matching Baseline

Trains an explainable baseline classifier using:

1. MobileNetV2 cosine similarity
2. Category match

Target:
    1 = same visual category
    0 = different visual category

IMPORTANT:
This is a category-level visual matching experiment,
not the final Lost-vs-Found identity model.
"""

from pathlib import Path

import numpy as np
import pandas as pd

from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    confusion_matrix,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split


# ============================================================
# PATHS
# ============================================================

ROOT_DIR = Path(__file__).resolve().parents[2]

FEATURE_CSV = (
    ROOT_DIR
    / "dataset-tools"
    / "matching-data"
    / "visual_pair_features.csv"
)


# ============================================================
# SETTINGS
# ============================================================

SEED = 42


# ============================================================
# MAIN
# ============================================================

def main():

    print()
    print("=" * 70)
    print("TraceMate Visual Matching Baseline")
    print("=" * 70)

    # --------------------------------------------------------
    # Load dataset
    # --------------------------------------------------------

    if not FEATURE_CSV.exists():

        raise FileNotFoundError(
            f"Feature dataset not found:\n{FEATURE_CSV}"
        )

    df = pd.read_csv(
        FEATURE_CSV
    )

    print()
    print(
        f"Rows: {len(df)}"
    )

    # --------------------------------------------------------
    # Features
    # --------------------------------------------------------

    feature_columns = [
        "mobilenet_cosine",
        "category_match",
    ]

    X = df[
        feature_columns
    ].astype(
        np.float32
    )

    y = df[
        "match"
    ].astype(
        np.int32
    )

    print()
    print("Features:")
    for feature in feature_columns:
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

    X_train, X_test, y_train, y_test = (
        train_test_split(
            X,
            y,
            test_size=0.20,
            random_state=SEED,
            stratify=y
        )
    )

    print()
    print(
        f"Training rows: {len(X_train)}"
    )

    print(
        f"Testing rows:  {len(X_test)}"
    )

    # --------------------------------------------------------
    # Random Forest
    # --------------------------------------------------------

    print()
    print("=" * 70)
    print("Training Random Forest")
    print("=" * 70)

    model = RandomForestClassifier(
        n_estimators=200,
        max_depth=8,
        min_samples_leaf=4,
        random_state=SEED,
        class_weight="balanced",
        n_jobs=-1
    )

    model.fit(
        X_train,
        y_train
    )

    print(
        "Training completed."
    )

    # --------------------------------------------------------
    # Predictions
    # --------------------------------------------------------

    predictions = model.predict(
        X_test
    )

    probabilities = model.predict_proba(
        X_test
    )[:, 1]

    # --------------------------------------------------------
    # Metrics
    # --------------------------------------------------------

    accuracy = accuracy_score(
        y_test,
        predictions
    )

    precision = precision_score(
        y_test,
        predictions,
        zero_division=0
    )

    recall = recall_score(
        y_test,
        predictions,
        zero_division=0
    )

    f1 = f1_score(
        y_test,
        predictions,
        zero_division=0
    )

    roc_auc = roc_auc_score(
        y_test,
        probabilities
    )

    matrix = confusion_matrix(
        y_test,
        predictions
    )

    # --------------------------------------------------------
    # Results
    # --------------------------------------------------------

    print()
    print("=" * 70)
    print("BASELINE RESULTS")
    print("=" * 70)

    print()
    print(
        f"Accuracy:  {accuracy * 100:.2f}%"
    )

    print(
        f"Precision: {precision * 100:.2f}%"
    )

    print(
        f"Recall:    {recall * 100:.2f}%"
    )

    print(
        f"F1 Score:  {f1 * 100:.2f}%"
    )

    print(
        f"ROC-AUC:   {roc_auc * 100:.2f}%"
    )

    # --------------------------------------------------------
    # Confusion matrix
    # --------------------------------------------------------

    print()
    print("=" * 70)
    print("CONFUSION MATRIX")
    print("=" * 70)

    print()
    print(
        "                    Predicted"
    )

    print(
        "                  Negative Positive"
    )

    print(
        f"Actual Negative   "
        f"{matrix[0, 0]:8d} "
        f"{matrix[0, 1]:8d}"
    )

    print(
        f"Actual Positive   "
        f"{matrix[1, 0]:8d} "
        f"{matrix[1, 1]:8d}"
    )

    # --------------------------------------------------------
    # Feature importance
    # --------------------------------------------------------

    print()
    print("=" * 70)
    print("FEATURE IMPORTANCE")
    print("=" * 70)

    importances = model.feature_importances_

    for name, importance in zip(
        feature_columns,
        importances
    ):

        print(
            f"{name:20s}: "
            f"{importance:.4f}"
        )

    # --------------------------------------------------------
    # Summary
    # --------------------------------------------------------

    print()
    print("=" * 70)
    print("BASELINE COMPLETE")
    print("=" * 70)

    print()
    print(
        "This is a visual-category baseline."
    )

    print(
        "The final TraceMate matching model "
        "will add multimodal features."
    )

    print()
    print("=" * 70)


if __name__ == "__main__":
    main()