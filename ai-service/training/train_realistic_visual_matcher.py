"""
TraceMate - Realistic Visual Matching Model

Purpose:
    Train and evaluate a Random Forest model on the controlled
    realistic visual-pair dataset.

Input:
    dataset-tools/matching-data/realistic_pair_features.csv

Features:
    - MobileNetV2 cosine similarity
    - Category match
    - Color similarity
    - Brightness similarity
    - Aspect-ratio similarity

Target:
    match

IMPORTANT:
    This is a controlled experimental benchmark.

    Positive pairs are identical-image pairs.
    Negative pairs include:
        1. Same-category, different-image pairs
        2. Different-category pairs

    Therefore category_match alone cannot determine the label.

    This is NOT a real Lost-vs-Found identity-matching benchmark.
"""

from pathlib import Path
import sys

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
# PATH
# ============================================================

PROJECT_ROOT = Path(__file__).resolve().parents[2]

FEATURE_FILE = (
    PROJECT_ROOT
    / "dataset-tools"
    / "matching-data"
    / "realistic_pair_features.csv"
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
    print("TraceMate Realistic Visual Matching Model")
    print("=" * 70)

    # --------------------------------------------------------
    # Check dataset
    # --------------------------------------------------------

    if not FEATURE_FILE.exists():

        print()
        print(
            "ERROR: Feature dataset not found:"
        )

        print(
            FEATURE_FILE
        )

        sys.exit(1)

    print()
    print(
        "Feature dataset:"
    )

    print(
        FEATURE_FILE
    )

    # --------------------------------------------------------
    # Load
    # --------------------------------------------------------

    df = pd.read_csv(
        FEATURE_FILE
    )

    print()
    print(
        f"Rows: {len(df)}"
    )

    # --------------------------------------------------------
    # Validate columns
    # --------------------------------------------------------

    required_columns = (
        FEATURE_COLUMNS
        +
        [TARGET_COLUMN]
    )

    missing_columns = [
        column
        for column in required_columns
        if column not in df.columns
    ]

    if missing_columns:

        print()
        print(
            "ERROR: Missing columns:"
        )

        print(
            missing_columns
        )

        sys.exit(1)

    # --------------------------------------------------------
    # Check missing values
    # --------------------------------------------------------

    missing_values = (
        df[required_columns]
        .isna()
        .sum()
    )

    print()
    print(
        "Missing values:"
    )

    print(
        missing_values.to_string()
    )

    if missing_values.sum() > 0:

        print()
        print(
            "ERROR: Missing values detected."
        )

        sys.exit(1)

    # --------------------------------------------------------
    # Pair type distribution
    # --------------------------------------------------------

    if "pair_type" in df.columns:

        print()
        print(
            "Pair types:"
        )

        print(
            df["pair_type"]
            .value_counts()
            .to_string()
        )

    # --------------------------------------------------------
    # Features / target
    # --------------------------------------------------------

    X = df[
        FEATURE_COLUMNS
    ].copy()

    y = df[
        TARGET_COLUMN
    ].astype(int)

    print()
    print(
        "Features:"
    )

    for feature in FEATURE_COLUMNS:

        print(
            f"  - {feature}"
        )

    print()
    print(
        "Labels:"
    )

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
            random_state=42,
            stratify=y,
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
    print(
        "Training Realistic Visual Random Forest"
    )
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
    print(
        "Training completed."
    )

    # --------------------------------------------------------
    # Predictions
    # --------------------------------------------------------

    y_pred = model.predict(
        X_test
    )

    y_probability = (
        model.predict_proba(
            X_test
        )[:, 1]
    )

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
    print(
        "REALISTIC VISUAL MODEL RESULTS"
    )
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

    cm = confusion_matrix(
        y_test,
        y_pred,
        labels=[0, 1],
    )

    print()
    print("=" * 70)
    print(
        "CONFUSION MATRIX"
    )
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
        f"{cm[0, 0]:8d} "
        f"{cm[0, 1]:8d}"
    )

    print(
        f"Actual Positive   "
        f"{cm[1, 0]:8d} "
        f"{cm[1, 1]:8d}"
    )

    # --------------------------------------------------------
    # Classification report
    # --------------------------------------------------------

    print()
    print("=" * 70)
    print(
        "CLASSIFICATION REPORT"
    )
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
    print(
        "FEATURE IMPORTANCE"
    )
    print("=" * 70)

    importance_table = (
        pd.DataFrame(
            {
                "feature": FEATURE_COLUMNS,
                "importance":
                    model.feature_importances_,
            }
        )
        .sort_values(
            "importance",
            ascending=False,
        )
    )

    print()

    for _, row in (
        importance_table.iterrows()
    ):

        print(
            f"{row['feature']:<28} : "
            f"{row['importance']:.4f}"
        )

    # --------------------------------------------------------
    # Pair-type evaluation
    #
    # This is particularly useful because our dataset has:
    #
    #   positive_same_image
    #   negative_same_category
    #   negative_different_category
    #
    # We want to know how well the model handles the
    # difficult same-category negatives.
    # --------------------------------------------------------

    test_indices = X_test.index

    test_results = df.loc[
        test_indices,
        [
            "pair_type",
            "category_match",
            "match",
        ],
    ].copy()

    test_results["prediction"] = y_pred

    print()
    print("=" * 70)
    print(
        "PERFORMANCE BY PAIR TYPE"
    )
    print("=" * 70)

    print()

    for pair_type, group in (
        test_results.groupby(
            "pair_type"
        )
    ):

        pair_accuracy = (
            accuracy_score(
                group["match"],
                group["prediction"],
            )
        )

        print(
            f"{pair_type:<32} "
            f"{pair_accuracy * 100:.2f}%"
        )

    # --------------------------------------------------------
    # Same-category negative analysis
    # --------------------------------------------------------

    hard_negative = test_results[
        (
            test_results[
                "pair_type"
            ]
            ==
            "negative_same_category"
        )
    ]

    if len(hard_negative) > 0:

        hard_negative_rejection = (
            (
                hard_negative[
                    "prediction"
                ]
                == 0
            ).mean()
        )

        print()
        print("=" * 70)
        print(
            "SAME-CATEGORY NEGATIVE ANALYSIS"
        )
        print("=" * 70)

        print()

        print(
            f"Same-category negative test pairs: "
            f"{len(hard_negative)}"
        )

        print(
            f"Correctly rejected: "
            f"{int((hard_negative['prediction'] == 0).sum())}"
        )

        print(
            f"Rejection rate: "
            f"{hard_negative_rejection * 100:.2f}%"
        )

    # --------------------------------------------------------
    # Save feature importance
    # --------------------------------------------------------

    importance_file = (
        PROJECT_ROOT
        / "dataset-tools"
        / "matching-data"
        / "realistic_visual_feature_importance.csv"
    )

    importance_table.to_csv(
        importance_file,
        index=False,
    )

    # --------------------------------------------------------
    # Save test predictions
    # --------------------------------------------------------

    predictions_file = (
        PROJECT_ROOT
        / "dataset-tools"
        / "matching-data"
        / "realistic_visual_test_predictions.csv"
    )

    prediction_output = df.loc[
        test_indices
    ].copy()

    prediction_output[
        "predicted_match"
    ] = y_pred

    prediction_output[
        "match_probability"
    ] = y_probability

    prediction_output.to_csv(
        predictions_file,
        index=False,
    )

    # --------------------------------------------------------
    # Final
    # --------------------------------------------------------

    print()
    print("=" * 70)
    print(
        "REALISTIC VISUAL MODEL COMPLETE"
    )
    print("=" * 70)

    print()
    print(
        "Feature importance saved to:"
    )

    print(
        importance_file
    )

    print()
    print(
        "Test predictions saved to:"
    )

    print(
        predictions_file
    )

    print()
    print(
        "IMPORTANT:"
    )

    print(
        "This is a controlled experimental benchmark."
    )

    print(
        "It is NOT real Lost-vs-Found identity-matching accuracy."
    )

    print()
    print("=" * 70)


if __name__ == "__main__":
    main()