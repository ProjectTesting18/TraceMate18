"""
TraceMate - Build Visual Pair Features

Reads the generated matching_pairs.csv, extracts the trained
TraceMate MobileNetV2 embedding for each unique image, and
creates pair-level visual features.

IMPORTANT:
Current labels:
    1 = same visual category
    0 = different visual category

This is NOT yet a real Lost-vs-Found identity dataset.
"""

from pathlib import Path
import json
import hashlib

import numpy as np
import pandas as pd
import tensorflow as tf


# ============================================================
# PATHS
# ============================================================

ROOT_DIR = Path(__file__).resolve().parents[2]

MODEL_PATH = (
    ROOT_DIR
    / "ai-service"
    / "models"
    / "mobilenetv2_tracemate.keras"
)

PAIR_CSV = (
    ROOT_DIR
    / "dataset-tools"
    / "matching-data"
    / "matching_pairs.csv"
)

OUTPUT_DIR = (
    ROOT_DIR
    / "dataset-tools"
    / "matching-data"
)

EMBEDDING_CACHE = (
    OUTPUT_DIR
    / "mobilenet_embeddings.npz"
)

FEATURE_CSV = (
    OUTPUT_DIR
    / "visual_pair_features.csv"
)

IMAGE_SIZE = (224, 224)

BATCH_SIZE = 32


# ============================================================
# LOAD MODEL
# ============================================================

def load_embedding_model():

    print()
    print("=" * 70)
    print("Loading TraceMate MobileNetV2")
    print("=" * 70)

    if not MODEL_PATH.exists():
        raise FileNotFoundError(
            f"Model not found:\n{MODEL_PATH}"
        )

    trained_model = tf.keras.models.load_model(
        MODEL_PATH,
        compile=False
    )

    embedding_model = tf.keras.Model(
        inputs=trained_model.input,
        outputs=trained_model.get_layer(
            "embedding"
        ).output,
        name="TraceMate_MobileNetV2_Embedding"
    )

    print(
        f"Model: {MODEL_PATH}"
    )

    print(
        "Embedding dimensions: 1280"
    )

    return embedding_model


# ============================================================
# IMAGE PREPROCESSING
# ============================================================

def load_image(image_path):

    image = tf.keras.utils.load_img(
        image_path,
        target_size=IMAGE_SIZE
    )

    image_array = (
        tf.keras.utils.img_to_array(
            image
        )
    )

    image_array = (
        tf.keras.applications.mobilenet_v2
        .preprocess_input(
            image_array
        )
    )

    return image_array


# ============================================================
# NORMALIZE EMBEDDINGS
# ============================================================

def normalize_embeddings(
    embeddings
):

    norms = np.linalg.norm(
        embeddings,
        axis=1,
        keepdims=True
    )

    norms = np.maximum(
        norms,
        1e-12
    )

    return (
        embeddings / norms
    )


# ============================================================
# EXTRACT EMBEDDINGS
# ============================================================

def extract_embeddings(
    model,
    image_paths
):

    print()
    print("=" * 70)
    print("Extracting MobileNetV2 embeddings")
    print("=" * 70)

    print(
        f"Unique images: {len(image_paths)}"
    )

    images = np.zeros(
        (
            len(image_paths),
            IMAGE_SIZE[0],
            IMAGE_SIZE[1],
            3
        ),
        dtype=np.float32
    )

    for index, image_path in enumerate(
        image_paths
    ):

        images[index] = load_image(
            image_path
        )

        if (
            (index + 1) % 100 == 0
            or index == len(image_paths) - 1
        ):

            print(
                f"Loaded "
                f"{index + 1}/"
                f"{len(image_paths)}"
            )

    print()
    print(
        "Running MobileNetV2..."
    )

    embeddings = model.predict(
        images,
        batch_size=BATCH_SIZE,
        verbose=1
    )

    embeddings = np.asarray(
        embeddings,
        dtype=np.float32
    )

    embeddings = normalize_embeddings(
        embeddings
    )

    print()
    print(
        f"Embedding matrix: "
        f"{embeddings.shape}"
    )

    return embeddings


# ============================================================
# COSINE SIMILARITY
# ============================================================

def cosine_similarity(
    a,
    b
):

    return float(
        np.dot(a, b)
    )


# ============================================================
# MAIN
# ============================================================

def main():

    print()
    print("=" * 70)
    print("TraceMate Visual Pair Feature Builder")
    print("=" * 70)

    # --------------------------------------------------------
    # Check files
    # --------------------------------------------------------

    if not PAIR_CSV.exists():

        raise FileNotFoundError(
            f"Pair CSV not found:\n{PAIR_CSV}"
        )

    OUTPUT_DIR.mkdir(
        parents=True,
        exist_ok=True
    )

    # --------------------------------------------------------
    # Read pairs
    # --------------------------------------------------------

    print()
    print(
        "Reading pair dataset..."
    )

    df = pd.read_csv(
        PAIR_CSV
    )

    required_columns = {
        "image_a",
        "image_b",
        "category_a",
        "category_b",
        "match"
    }

    missing = (
        required_columns
        - set(df.columns)
    )

    if missing:

        raise ValueError(
            "Missing columns: "
            + str(sorted(missing))
        )

    print(
        f"Pairs: {len(df)}"
    )

    # --------------------------------------------------------
    # Unique images
    # --------------------------------------------------------

    unique_paths = sorted(
        set(
            df["image_a"].tolist()
            +
            df["image_b"].tolist()
        )
    )

    print()
    print(
        f"Unique images: "
        f"{len(unique_paths)}"
    )

    # --------------------------------------------------------
    # Load model
    # --------------------------------------------------------

    model = load_embedding_model()

    # --------------------------------------------------------
    # Extract embeddings
    # --------------------------------------------------------

    embeddings = extract_embeddings(
        model,
        unique_paths
    )

    embedding_map = {
        path: embeddings[index]
        for index, path in enumerate(
            unique_paths
        )
    }

    # --------------------------------------------------------
    # Cache embeddings
    # --------------------------------------------------------

    print()
    print(
        "Saving embedding cache..."
    )

    np.savez_compressed(
        EMBEDDING_CACHE,
        paths=np.asarray(
            unique_paths
        ),
        embeddings=embeddings
    )

    print(
        f"Cache: {EMBEDDING_CACHE}"
    )

    # --------------------------------------------------------
    # Build pair features
    # --------------------------------------------------------

    print()
    print("=" * 70)
    print("Building pair-level visual features")
    print("=" * 70)

    output_rows = []

    total = len(df)

    for index, row in df.iterrows():

        image_a = str(
            row["image_a"]
        )

        image_b = str(
            row["image_b"]
        )

        embedding_a = (
            embedding_map[image_a]
        )

        embedding_b = (
            embedding_map[image_b]
        )

        similarity = (
            cosine_similarity(
                embedding_a,
                embedding_b
            )
        )

        category_match = int(
            str(row["category_a"])
            ==
            str(row["category_b"])
        )

        output_rows.append(
            {
                "image_a": image_a,
                "image_b": image_b,
                "category_a": str(
                    row["category_a"]
                ),
                "category_b": str(
                    row["category_b"]
                ),

                # Visual feature
                "mobilenet_cosine": similarity,

                # Explicit category feature
                "category_match": category_match,

                # Target
                "match": int(
                    row["match"]
                )
            }
        )

        if (
            (index + 1) % 1000 == 0
            or index == total - 1
        ):

            print(
                f"Processed "
                f"{index + 1}/"
                f"{total} pairs"
            )

    # --------------------------------------------------------
    # Save
    # --------------------------------------------------------

    feature_df = pd.DataFrame(
        output_rows
    )

    feature_df.to_csv(
        FEATURE_CSV,
        index=False
    )

    # --------------------------------------------------------
    # Summary
    # --------------------------------------------------------

    print()
    print("=" * 70)
    print("VISUAL FEATURE DATASET CREATED")
    print("=" * 70)

    print(
        f"Rows: {len(feature_df)}"
    )

    print(
        f"Columns: "
        f"{list(feature_df.columns)}"
    )

    print()
    print(
        "Match labels:"
    )

    print(
        feature_df[
            "match"
        ].value_counts()
        .sort_index()
        .to_string()
    )

    print()
    print(
        "MobileNet cosine statistics:"
    )

    print(
        feature_df[
            "mobilenet_cosine"
        ].describe()
        .to_string()
    )

    print()
    print(
        f"Feature CSV:"
    )

    print(
        FEATURE_CSV
    )

    print()
    print(
        f"Embedding cache:"
    )

    print(
        EMBEDDING_CACHE
    )

    print()
    print("=" * 70)


if __name__ == "__main__":
    main()