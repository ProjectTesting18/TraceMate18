"""
TraceMate - Multimodal Pair Feature Builder

Purpose:
    Build pair-level features for the TraceMate research matching model.

Input:
    dataset-tools/matching-data/matching_pairs.csv

Existing features:
    - MobileNetV2 cosine similarity
    - Category match

Additional features:
    - Image color similarity
    - Image brightness similarity
    - Image size/aspect-ratio similarity

Output:
    dataset-tools/matching-data/multimodal_pair_features.csv

IMPORTANT:
    This is a research/experimental feature builder.
    The current matching_pairs.csv contains category-level labels,
    not real Lost-vs-Found identity labels.
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
    / "matching_pairs.csv"
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
    / "multimodal_pair_features.csv"
)


# ============================================================
# IMAGE PATH RESOLUTION
# ============================================================

def resolve_image_path(path_value):
    """
    Resolve an image path stored in matching_pairs.csv.

    Handles:
        - absolute paths
        - paths relative to project root
        - paths relative to dataset-tools
        - paths relative to the training-data directory
    """

    path_value = str(path_value).strip()

    candidate = Path(path_value)

    if candidate.is_absolute() and candidate.exists():
        return candidate

    candidates = [
        PROJECT_ROOT / path_value,
        PROJECT_ROOT / "dataset-tools" / path_value,
        PROJECT_ROOT / "dataset-tools" / "training-data" / path_value,
        PROJECT_ROOT / "dataset-tools" / "training-data" / "test" / path_value,
    ]

    for item in candidates:
        if item.exists():
            return item

    # Try filename search as a final fallback
    filename = Path(path_value).name

    search_roots = [
        PROJECT_ROOT / "dataset-tools" / "training-data",
        PROJECT_ROOT / "dataset-tools",
    ]

    for root in search_roots:
        if root.exists():
            matches = list(root.rglob(filename))

            if matches:
                return matches[0]

    return None


# ============================================================
# LOAD MOBILENET EMBEDDINGS
# ============================================================

def load_embeddings():
    """
    Load the cached MobileNet embeddings.

    The NPZ is expected to contain:
        paths
        embeddings
    """

    if not EMBEDDING_FILE.exists():
        raise FileNotFoundError(
            f"MobileNet embedding file not found:\n{EMBEDDING_FILE}"
        )

    data = np.load(EMBEDDING_FILE, allow_pickle=True)

    if "paths" not in data:
        raise KeyError("NPZ file does not contain 'paths'.")

    if "embeddings" not in data:
        raise KeyError("NPZ file does not contain 'embeddings'.")

    paths = data["paths"]
    embeddings = data["embeddings"]

    embedding_map = {}

    for path, embedding in zip(paths, embeddings):
        path_str = str(path)

        embedding_map[path_str] = embedding

        # Also store normalized variants for easier lookup.
        embedding_map[path_str.replace("\\", "/")] = embedding

        embedding_map[Path(path_str).name] = embedding

    print(f"Loaded MobileNet embeddings: {len(embeddings)}")

    if len(embeddings) > 0:
        print(f"Embedding dimension: {embeddings.shape[1]}")

    return embedding_map


# ============================================================
# EMBEDDING LOOKUP
# ============================================================

def get_embedding(image_path, embedding_map):
    """
    Find a MobileNet embedding for an image.
    """

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

    # Try matching by filename.
    filename = image_path.name

    for stored_path, embedding in embedding_map.items():
        if Path(stored_path).name == filename:
            return embedding

    return None


# ============================================================
# COSINE SIMILARITY
# ============================================================

def cosine_similarity(vector_a, vector_b):
    """
    Calculate cosine similarity between two vectors.
    """

    if vector_a is None or vector_b is None:
        return np.nan

    vector_a = np.asarray(vector_a, dtype=np.float32)
    vector_b = np.asarray(vector_b, dtype=np.float32)

    denominator = (
        np.linalg.norm(vector_a)
        * np.linalg.norm(vector_b)
    )

    if denominator == 0:
        return np.nan

    return float(
        np.dot(vector_a, vector_b) / denominator
    )


# ============================================================
# IMAGE FEATURES
# ============================================================

def extract_image_features(image_path):
    """
    Extract lightweight visual features from an image.

    Features:
        - RGB mean
        - RGB standard deviation
        - brightness
        - width
        - height
        - aspect ratio
    """

    if image_path is None:
        return None

    try:
        with Image.open(image_path) as image:

            image = image.convert("RGB")

            width, height = image.size

            # Resize for stable low-cost feature extraction.
            small = image.resize((64, 64))

            pixels = np.asarray(
                small,
                dtype=np.float32
            ) / 255.0

            rgb_mean = pixels.mean(axis=(0, 1))

            rgb_std = pixels.std(axis=(0, 1))

            # Perceived brightness.
            brightness = float(
                (
                    0.299 * pixels[:, :, 0]
                    + 0.587 * pixels[:, :, 1]
                    + 0.114 * pixels[:, :, 2]
                ).mean()
            )

            aspect_ratio = (
                float(width) / float(height)
                if height != 0
                else 0.0
            )

            return {
                "r_mean": float(rgb_mean[0]),
                "g_mean": float(rgb_mean[1]),
                "b_mean": float(rgb_mean[2]),

                "r_std": float(rgb_std[0]),
                "g_std": float(rgb_std[1]),
                "b_std": float(rgb_std[2]),

                "brightness": brightness,

                "width": float(width),
                "height": float(height),

                "aspect_ratio": aspect_ratio,
            }

    except Exception as exc:
        print(
            f"Warning: Could not process image "
            f"{image_path}: {exc}"
        )

        return None


# ============================================================
# VISUAL FEATURE COMPARISON
# ============================================================

def calculate_image_pair_features(features_a, features_b):
    """
    Compare two images using low-level visual properties.
    """

    if features_a is None or features_b is None:
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

    color_distance = np.linalg.norm(color_a - color_b)

    max_color_distance = np.sqrt(3.0)

    color_similarity = (
        1.0
        - color_distance / max_color_distance
    )

    color_similarity = float(
        np.clip(color_similarity, 0.0, 1.0)
    )

    # --------------------------------------------------------
    # Brightness similarity
    # --------------------------------------------------------

    brightness_difference = abs(
        features_a["brightness"]
        - features_b["brightness"]
    )

    brightness_similarity = float(
        np.clip(
            1.0 - brightness_difference,
            0.0,
            1.0,
        )
    )

    # --------------------------------------------------------
    # Aspect ratio similarity
    # --------------------------------------------------------

    ratio_a = features_a["aspect_ratio"]
    ratio_b = features_b["aspect_ratio"]

    if ratio_a > 0 and ratio_b > 0:

        ratio_difference = abs(
            ratio_a - ratio_b
        ) / max(ratio_a, ratio_b)

        aspect_ratio_similarity = float(
            np.clip(
                1.0 - ratio_difference,
                0.0,
                1.0,
            )
        )

    else:
        aspect_ratio_similarity = np.nan

    return {
        "color_similarity": color_similarity,
        "brightness_similarity": brightness_similarity,
        "aspect_ratio_similarity": aspect_ratio_similarity,
    }


# ============================================================
# MAIN
# ============================================================

def main():

    print("=" * 70)
    print("TraceMate Multimodal Pair Feature Builder")
    print("=" * 70)

    # --------------------------------------------------------
    # Check pair dataset
    # --------------------------------------------------------

    if not PAIR_FILE.exists():

        print()
        print("ERROR: matching_pairs.csv not found:")
        print(PAIR_FILE)
        sys.exit(1)

    print()
    print("Pair dataset:")
    print(PAIR_FILE)

    pairs = pd.read_csv(PAIR_FILE)

    print()
    print(f"Rows: {len(pairs)}")

    required_columns = [
        "image_a",
        "image_b",
        "category_a",
        "category_b",
        "match",
    ]

    missing_columns = [
        column
        for column in required_columns
        if column not in pairs.columns
    ]

    if missing_columns:

        print()
        print("ERROR: Missing required columns:")
        print(missing_columns)

        sys.exit(1)

    # --------------------------------------------------------
    # Load embeddings
    # --------------------------------------------------------

    print()
    print("-" * 70)
    print("Loading MobileNet embeddings")
    print("-" * 70)

    embedding_map = load_embeddings()

    # --------------------------------------------------------
    # Cache image features
    # --------------------------------------------------------

    print()
    print("-" * 70)
    print("Preparing image features")
    print("-" * 70)

    image_cache = {}

    unique_images = pd.unique(
        pd.concat(
            [
                pairs["image_a"],
                pairs["image_b"],
            ],
            ignore_index=True,
        )
    )

    print(f"Unique images: {len(unique_images)}")

    for index, image_value in enumerate(
        unique_images,
        start=1,
    ):

        image_path = resolve_image_path(image_value)

        if image_path is None:

            print(
                f"Warning: Image not found: "
                f"{image_value}"
            )

            image_cache[str(image_value)] = {
                "path": None,
                "features": None,
                "embedding": get_embedding(
                    None,
                    embedding_map,
                ),
            }

            continue

        image_features = extract_image_features(
            image_path
        )

        image_embedding = get_embedding(
            image_path,
            embedding_map,
        )

        image_cache[str(image_value)] = {
            "path": image_path,
            "features": image_features,
            "embedding": image_embedding,
        }

        if index % 100 == 0 or index == len(unique_images):

            print(
                f"Processed {index}/"
                f"{len(unique_images)} images"
            )

    # --------------------------------------------------------
    # Build pair features
    # --------------------------------------------------------

    print()
    print("-" * 70)
    print("Building multimodal pair features")
    print("-" * 70)

    rows = []

    for index, pair in pairs.iterrows():

        image_a_key = str(pair["image_a"])
        image_b_key = str(pair["image_b"])

        data_a = image_cache.get(image_a_key)
        data_b = image_cache.get(image_b_key)

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
        # MobileNet cosine
        # ----------------------------------------------------

        mobilenet_cosine = cosine_similarity(
            data_a["embedding"],
            data_b["embedding"],
        )

        # ----------------------------------------------------
        # Category match
        # ----------------------------------------------------

        category_match = int(
            str(pair["category_a"]).strip().lower()
            ==
            str(pair["category_b"]).strip().lower()
        )

        # ----------------------------------------------------
        # Low-level visual features
        # ----------------------------------------------------

        visual_features = calculate_image_pair_features(
            data_a["features"],
            data_b["features"],
        )

        rows.append(
            {
                "image_a": pair["image_a"],
                "image_b": pair["image_b"],

                "category_a": pair["category_a"],
                "category_b": pair["category_b"],

                "mobilenet_cosine": mobilenet_cosine,

                "category_match": category_match,

                "color_similarity":
                    visual_features[
                        "color_similarity"
                    ],

                "brightness_similarity":
                    visual_features[
                        "brightness_similarity"
                    ],

                "aspect_ratio_similarity":
                    visual_features[
                        "aspect_ratio_similarity"
                    ],

                "match": int(pair["match"]),
            }
        )

        if (index + 1) % 1000 == 0:

            print(
                f"Built {index + 1}/"
                f"{len(pairs)} pair features"
            )

    # --------------------------------------------------------
    # Create dataframe
    # --------------------------------------------------------

    result = pd.DataFrame(rows)

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
    print("MULTIMODAL FEATURE DATASET COMPLETE")
    print("=" * 70)

    print()
    print(f"Rows: {len(result)}")

    print()
    print("Columns:")

    for column in result.columns:
        print(f"  - {column}")

    print()
    print("Label distribution:")

    print(
        result["match"].value_counts()
        .sort_index()
        .to_string()
    )

    print()
    print("Missing values:")

    print(
        result.isna()
        .sum()
        .to_string()
    )

    print()
    print("Feature summary:")

    feature_columns = [
        "mobilenet_cosine",
        "category_match",
        "color_similarity",
        "brightness_similarity",
        "aspect_ratio_similarity",
    ]

    print(
        result[feature_columns]
        .describe()
        .round(4)
        .to_string()
    )

    print()
    print("Output:")
    print(OUTPUT_FILE)

    print()
    print("=" * 70)
    print("READY FOR MULTIMODAL MODEL TRAINING")
    print("=" * 70)


if __name__ == "__main__":
    main()