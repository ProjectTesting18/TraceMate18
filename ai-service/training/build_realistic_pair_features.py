"""
TraceMate - Realistic Pair Feature Builder

Purpose:
    Build visual pair-level features for the controlled
    experimental matching dataset.

Input:
    dataset-tools/matching-data/realistic_matching_pairs.csv

Features:
    - MobileNetV2 cosine similarity
    - Category match
    - Color similarity
    - Brightness similarity
    - Aspect-ratio similarity

Output:
    dataset-tools/matching-data/realistic_pair_features.csv

IMPORTANT:
    This is a controlled experimental dataset.

    Positive pairs are same-image pairs.
    Negative pairs are either:
        - same category but different image
        - different category

    This is NOT a real Lost-vs-Found identity dataset.
"""

from pathlib import Path
import sys

import numpy as np
import pandas as pd
from PIL import Image


# ============================================================
# PATHS
# ============================================================

PROJECT_ROOT = Path(__file__).resolve().parents[2]

PAIR_FILE = (
    PROJECT_ROOT
    / "dataset-tools"
    / "matching-data"
    / "realistic_matching_pairs.csv"
)

EMBEDDING_FILE = (
    PROJECT_ROOT
    / "dataset-tools"
    / "matching-data"
    / "mobilenet_embeddings.npz"
)

OUTPUT_FILE = (
    PROJECT_ROOT
    / "dataset-tools"
    / "matching-data"
    / "realistic_pair_features.csv"
)


# ============================================================
# IMAGE PATH RESOLUTION
# ============================================================

def resolve_image_path(path_value):
    """
    Resolve an image path stored in the CSV.
    """

    path_value = str(path_value).strip()

    candidate = Path(path_value)

    if candidate.is_absolute() and candidate.exists():
        return candidate

    candidates = [
        PROJECT_ROOT / path_value,
        PROJECT_ROOT / "dataset-tools" / path_value,
        PROJECT_ROOT / "dataset-tools" / "training-data" / path_value,
    ]

    for candidate_path in candidates:

        if candidate_path.exists():
            return candidate_path

    filename = Path(path_value).name

    search_roots = [
        PROJECT_ROOT / "dataset-tools" / "training-data",
        PROJECT_ROOT / "dataset-tools",
    ]

    for root in search_roots:

        if not root.exists():
            continue

        matches = list(
            root.rglob(filename)
        )

        if matches:
            return matches[0]

    return None


# ============================================================
# LOAD EMBEDDINGS
# ============================================================

def load_embeddings():

    if not EMBEDDING_FILE.exists():

        raise FileNotFoundError(
            f"MobileNet embedding file not found:\n"
            f"{EMBEDDING_FILE}"
        )

    data = np.load(
        EMBEDDING_FILE,
        allow_pickle=True,
    )

    if "paths" not in data:
        raise KeyError(
            "NPZ file does not contain 'paths'."
        )

    if "embeddings" not in data:
        raise KeyError(
            "NPZ file does not contain 'embeddings'."
        )

    paths = data["paths"]
    embeddings = data["embeddings"]

    embedding_map = {}

    for path, embedding in zip(
        paths,
        embeddings,
    ):

        path_string = str(path)

        embedding_map[path_string] = embedding

        embedding_map[
            path_string.replace("\\", "/")
        ] = embedding

        embedding_map[
            Path(path_string).name
        ] = embedding

    print(
        f"Loaded MobileNet embeddings: "
        f"{len(embeddings)}"
    )

    print(
        f"Embedding dimension: "
        f"{embeddings.shape[1]}"
    )

    return embedding_map


# ============================================================
# GET EMBEDDING
# ============================================================

def get_embedding(
    image_path,
    embedding_map,
):

    if image_path is None:
        return None

    candidates = [
        str(image_path),
        str(image_path).replace("\\", "/"),
        image_path.name,
    ]

    for candidate in candidates:

        if candidate in embedding_map:
            return embedding_map[candidate]

    filename = image_path.name

    for stored_path, embedding in embedding_map.items():

        if Path(stored_path).name == filename:
            return embedding

    return None


# ============================================================
# COSINE SIMILARITY
# ============================================================

def cosine_similarity(
    vector_a,
    vector_b,
):

    if vector_a is None or vector_b is None:
        return np.nan

    vector_a = np.asarray(
        vector_a,
        dtype=np.float32,
    )

    vector_b = np.asarray(
        vector_b,
        dtype=np.float32,
    )

    denominator = (
        np.linalg.norm(vector_a)
        *
        np.linalg.norm(vector_b)
    )

    if denominator == 0:
        return np.nan

    return float(
        np.dot(vector_a, vector_b)
        / denominator
    )


# ============================================================
# IMAGE FEATURES
# ============================================================

def extract_image_features(
    image_path,
):

    if image_path is None:
        return None

    try:

        with Image.open(image_path) as image:

            image = image.convert("RGB")

            width, height = image.size

            small = image.resize(
                (64, 64)
            )

            pixels = (
                np.asarray(
                    small,
                    dtype=np.float32,
                )
                / 255.0
            )

            rgb_mean = pixels.mean(
                axis=(0, 1)
            )

            rgb_std = pixels.std(
                axis=(0, 1)
            )

            brightness = float(
                (
                    0.299
                    * pixels[:, :, 0]
                    +
                    0.587
                    * pixels[:, :, 1]
                    +
                    0.114
                    * pixels[:, :, 2]
                ).mean()
            )

            aspect_ratio = (
                float(width)
                /
                float(height)
                if height != 0
                else 0.0
            )

            return {
                "r_mean": float(
                    rgb_mean[0]
                ),
                "g_mean": float(
                    rgb_mean[1]
                ),
                "b_mean": float(
                    rgb_mean[2]
                ),

                "r_std": float(
                    rgb_std[0]
                ),
                "g_std": float(
                    rgb_std[1]
                ),
                "b_std": float(
                    rgb_std[2]
                ),

                "brightness": brightness,

                "width": float(width),
                "height": float(height),

                "aspect_ratio": aspect_ratio,
            }

    except Exception as exc:

        print(
            f"Warning: Could not process "
            f"{image_path}: {exc}"
        )

        return None


# ============================================================
# VISUAL COMPARISON
# ============================================================

def calculate_visual_features(
    features_a,
    features_b,
):

    if (
        features_a is None
        or
        features_b is None
    ):

        return {
            "color_similarity": np.nan,
            "brightness_similarity": np.nan,
            "aspect_ratio_similarity": np.nan,
        }

    # --------------------------------------------------------
    # Color similarity
    # --------------------------------------------------------

    color_a = np.array(
        [
            features_a["r_mean"],
            features_a["g_mean"],
            features_a["b_mean"],
        ],
        dtype=np.float32,
    )

    color_b = np.array(
        [
            features_b["r_mean"],
            features_b["g_mean"],
            features_b["b_mean"],
        ],
        dtype=np.float32,
    )

    color_distance = np.linalg.norm(
        color_a - color_b
    )

    max_color_distance = np.sqrt(3.0)

    color_similarity = (
        1.0
        -
        (
            color_distance
            /
            max_color_distance
        )
    )

    color_similarity = float(
        np.clip(
            color_similarity,
            0.0,
            1.0,
        )
    )

    # --------------------------------------------------------
    # Brightness similarity
    # --------------------------------------------------------

    brightness_difference = abs(
        features_a["brightness"]
        -
        features_b["brightness"]
    )

    brightness_similarity = float(
        np.clip(
            1.0
            -
            brightness_difference,
            0.0,
            1.0,
        )
    )

    # --------------------------------------------------------
    # Aspect ratio similarity
    # --------------------------------------------------------

    ratio_a = features_a[
        "aspect_ratio"
    ]

    ratio_b = features_b[
        "aspect_ratio"
    ]

    if ratio_a > 0 and ratio_b > 0:

        ratio_difference = (
            abs(ratio_a - ratio_b)
            /
            max(ratio_a, ratio_b)
        )

        aspect_ratio_similarity = float(
            np.clip(
                1.0
                -
                ratio_difference,
                0.0,
                1.0,
            )
        )

    else:

        aspect_ratio_similarity = np.nan

    return {
        "color_similarity":
            color_similarity,

        "brightness_similarity":
            brightness_similarity,

        "aspect_ratio_similarity":
            aspect_ratio_similarity,
    }


# ============================================================
# MAIN
# ============================================================

def main():

    print("=" * 70)
    print(
        "TraceMate Realistic Pair Feature Builder"
    )
    print("=" * 70)

    # --------------------------------------------------------
    # Check input
    # --------------------------------------------------------

    if not PAIR_FILE.exists():

        print()
        print(
            "ERROR: Realistic pair dataset not found:"
        )

        print(
            PAIR_FILE
        )

        sys.exit(1)

    # --------------------------------------------------------
    # Load dataset
    # --------------------------------------------------------

    print()
    print(
        "Pair dataset:"
    )

    print(
        PAIR_FILE
    )

    pairs = pd.read_csv(
        PAIR_FILE
    )

    print()
    print(
        f"Rows: {len(pairs)}"
    )

    required_columns = [
        "image_a",
        "image_b",
        "category_a",
        "category_b",
        "category_match",
        "match",
    ]

    missing_columns = [
        column
        for column in required_columns
        if column not in pairs.columns
    ]

    if missing_columns:

        print()
        print(
            "ERROR: Missing required columns:"
        )

        print(
            missing_columns
        )

        sys.exit(1)

    # --------------------------------------------------------
    # Load MobileNet embeddings
    # --------------------------------------------------------

    print()
    print("-" * 70)
    print(
        "Loading MobileNet embeddings"
    )
    print("-" * 70)

    embedding_map = (
        load_embeddings()
    )

    # --------------------------------------------------------
    # Prepare unique images
    # --------------------------------------------------------

    print()
    print("-" * 70)
    print(
        "Preparing image features"
    )
    print("-" * 70)

    unique_images = pd.unique(
        pd.concat(
            [
                pairs["image_a"],
                pairs["image_b"],
            ],
            ignore_index=True,
        )
    )

    print(
        f"Unique images: "
        f"{len(unique_images)}"
    )

    image_cache = {}

    for index, image_value in enumerate(
        unique_images,
        start=1,
    ):

        image_path = (
            resolve_image_path(
                image_value
            )
        )

        if image_path is None:

            print(
                "Warning: Image not found: "
                f"{image_value}"
            )

            image_cache[
                str(image_value)
            ] = {
                "path": None,
                "features": None,
                "embedding": None,
            }

            continue

        image_features = (
            extract_image_features(
                image_path
            )
        )

        image_embedding = (
            get_embedding(
                image_path,
                embedding_map,
            )
        )

        image_cache[
            str(image_value)
        ] = {
            "path": image_path,
            "features": image_features,
            "embedding": image_embedding,
        }

        if (
            index % 100 == 0
            or
            index == len(unique_images)
        ):

            print(
                f"Processed "
                f"{index}/"
                f"{len(unique_images)} "
                f"images"
            )

    # --------------------------------------------------------
    # Build pair features
    # --------------------------------------------------------

    print()
    print("-" * 70)
    print(
        "Building realistic pair features"
    )
    print("-" * 70)

    rows = []

    for index, pair in pairs.iterrows():

        image_a_key = str(
            pair["image_a"]
        )

        image_b_key = str(
            pair["image_b"]
        )

        data_a = image_cache.get(
            image_a_key
        )

        data_b = image_cache.get(
            image_b_key
        )

        if data_a is None:

            data_a = {
                "path": None,
                "features": None,
                "embedding": None,
            }

        if data_b is None:

            data_b = {
                "path": None,
                "features": None,
                "embedding": None,
            }

        # ----------------------------------------------------
        # MobileNet similarity
        # ----------------------------------------------------

        mobilenet_cosine = (
            cosine_similarity(
                data_a["embedding"],
                data_b["embedding"],
            )
        )

        # ----------------------------------------------------
        # Category match
        # ----------------------------------------------------

        category_match = int(
            str(
                pair["category_a"]
            ).strip().lower()
            ==
            str(
                pair["category_b"]
            ).strip().lower()
        )

        # ----------------------------------------------------
        # Low-level visual features
        # ----------------------------------------------------

        visual = (
            calculate_visual_features(
                data_a["features"],
                data_b["features"],
            )
        )

        # ----------------------------------------------------
        # Store row
        # ----------------------------------------------------

        rows.append(
            {
                "image_a":
                    pair["image_a"],

                "image_b":
                    pair["image_b"],

                "category_a":
                    pair["category_a"],

                "category_b":
                    pair["category_b"],

                "pair_type":
                    pair["pair_type"],

                "mobilenet_cosine":
                    mobilenet_cosine,

                "category_match":
                    category_match,

                "color_similarity":
                    visual[
                        "color_similarity"
                    ],

                "brightness_similarity":
                    visual[
                        "brightness_similarity"
                    ],

                "aspect_ratio_similarity":
                    visual[
                        "aspect_ratio_similarity"
                    ],

                "match":
                    int(pair["match"]),
            }
        )

        if (
            (index + 1) % 500 == 0
            or
            index + 1 == len(pairs)
        ):

            print(
                f"Built "
                f"{index + 1}/"
                f"{len(pairs)} "
                f"pair features"
            )

    # --------------------------------------------------------
    # DataFrame
    # --------------------------------------------------------

    result = pd.DataFrame(
        rows
    )

    # --------------------------------------------------------
    # Missing-value check
    # --------------------------------------------------------

    feature_columns = [
        "mobilenet_cosine",
        "category_match",
        "color_similarity",
        "brightness_similarity",
        "aspect_ratio_similarity",
    ]

    missing_values = (
        result[feature_columns]
        .isna()
        .sum()
    )

    # --------------------------------------------------------
    # Save
    # --------------------------------------------------------

    OUTPUT_FILE.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    result.to_csv(
        OUTPUT_FILE,
        index=False,
    )

    # --------------------------------------------------------
    # Summary
    # --------------------------------------------------------

    print()
    print("=" * 70)
    print(
        "REALISTIC PAIR FEATURES COMPLETE"
    )
    print("=" * 70)

    print()
    print(
        f"Rows: {len(result)}"
    )

    print()
    print(
        "Columns:"
    )

    for column in result.columns:

        print(
            f"  - {column}"
        )

    print()
    print(
        "Label distribution:"
    )

    print(
        result["match"]
        .value_counts()
        .sort_index()
        .to_string()
    )

    print()
    print(
        "Pair type distribution:"
    )

    print(
        result["pair_type"]
        .value_counts()
        .to_string()
    )

    print()
    print(
        "Missing values:"
    )

    print(
        missing_values
        .to_string()
    )

    print()
    print(
        "Feature summary:"
    )

    print(
        result[feature_columns]
        .describe()
        .round(4)
        .to_string()
    )

    # --------------------------------------------------------
    # Critical category-vs-label check
    # --------------------------------------------------------

    print()
    print("-" * 70)
    print(
        "CATEGORY MATCH VS LABEL"
    )
    print("-" * 70)

    cross_tab = pd.crosstab(
        result["category_match"],
        result["match"],
        rownames=[
            "category_match"
        ],
        colnames=[
            "match"
        ],
    )

    print()
    print(
        cross_tab.to_string()
    )

    # --------------------------------------------------------
    # Output
    # --------------------------------------------------------

    print()
    print(
        "Output:"
    )

    print(
        OUTPUT_FILE
    )

    print()
    print("=" * 70)
    print(
        "READY FOR REALISTIC EXPERIMENTAL MODEL"
    )
    print("=" * 70)

    print()
    print(
        "IMPORTANT:"
    )

    print(
        "This dataset uses synthetic same-image "
        "positive pairs."
    )

    print(
        "It is not a real Lost-vs-Found identity "
        "matching benchmark."
    )


if __name__ == "__main__":
    main()