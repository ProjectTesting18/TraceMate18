"""Prepare TraceMate lost/found pair data for model training.

Expected input CSV columns:
    lost_id, found_id, lost_description, found_description, label
Optional columns:
    category_match, color_match, location_similarity, date_similarity,
    image_similarity_mobilenet, image_similarity_clip

label must be 0 (different item) or 1 (same/matching item).
The script performs a stratified 70/15/15 split and writes train/validation/test CSVs.
It does not invent missing labels or synthetic data.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd
from sklearn.model_selection import train_test_split

REQUIRED = ["lost_id", "found_id", "lost_description", "found_description", "label"]
OPTIONAL = [
    "category_match",
    "color_match",
    "location_similarity",
    "date_similarity",
    "image_similarity_mobilenet",
    "image_similarity_clip",
]


def clean(df: pd.DataFrame) -> pd.DataFrame:
    missing = [c for c in REQUIRED if c not in df.columns]
    if missing:
        raise ValueError(f"Missing required columns: {', '.join(missing)}")

    out = df.copy()
    out["lost_description"] = out["lost_description"].fillna("").astype(str).str.strip()
    out["found_description"] = out["found_description"].fillna("").astype(str).str.strip()
    out["label"] = pd.to_numeric(out["label"], errors="coerce")
    if out["label"].isna().any() or not out["label"].isin([0, 1]).all():
        raise ValueError("label must contain only 0 or 1")
    out["label"] = out["label"].astype(int)

    for col in OPTIONAL:
        if col not in out.columns:
            out[col] = 0.0
        out[col] = pd.to_numeric(out[col], errors="coerce").fillna(0.0)
        if col.endswith("match"):
            out[col] = out[col].clip(0, 1)
        else:
            out[col] = out[col].clip(0, 1)

    return out[REQUIRED + OPTIONAL]


def split_data(df: pd.DataFrame):
    if len(df) < 20:
        raise ValueError(
            "At least 20 labeled pairs are recommended before creating train/validation/test splits. "
            "Add real dataset rows first."
        )
    if df["label"].nunique() < 2:
        raise ValueError("The dataset must contain both label 0 and label 1 examples.")

    train, temp = train_test_split(
        df, test_size=0.30, random_state=42, stratify=df["label"]
    )
    validation, test = train_test_split(
        temp, test_size=0.50, random_state=42, stratify=temp["label"]
    )
    return train, validation, test


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="Raw labeled pair CSV")
    parser.add_argument("--output-dir", default="training-data", help="Training-data root")
    args = parser.parse_args()

    df = clean(pd.read_csv(args.input))
    train, validation, test = split_data(df)

    root = Path(args.output_dir)
    (root / "processed").mkdir(parents=True, exist_ok=True)
    (root / "train").mkdir(parents=True, exist_ok=True)
    (root / "validation").mkdir(parents=True, exist_ok=True)
    (root / "test").mkdir(parents=True, exist_ok=True)

    df.to_csv(root / "processed" / "pairs_clean.csv", index=False)
    train.to_csv(root / "train" / "pairs.csv", index=False)
    validation.to_csv(root / "validation" / "pairs.csv", index=False)
    test.to_csv(root / "test" / "pairs.csv", index=False)

    print(f"Total pairs: {len(df)}")
    print(f"Train: {len(train)} | Validation: {len(validation)} | Test: {len(test)}")
    print("Class distribution:")
    print(df["label"].value_counts().sort_index().to_string())


if __name__ == "__main__":
    main()
