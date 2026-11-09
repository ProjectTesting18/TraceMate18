"""
TraceMate - Realistic Experimental Matching Dataset

Purpose:
    Create a harder visual matching dataset from the existing
    LostNet category images.

Important:
    LostNet does NOT contain real Lost-vs-Found identity labels.
    Therefore this script creates a controlled experimental
    matching dataset, not a real-world Lost-vs-Found dataset.

Pair types:

    1. SAME CATEGORY + SAME IMAGE
       -> Positive

    2. SAME CATEGORY + DIFFERENT IMAGE
       -> Negative

    3. DIFFERENT CATEGORY + DIFFERENT IMAGE
       -> Negative

The important part is that:

    category_match = 1

    can now correspond to BOTH:

    match = 1
    match = 0

Therefore category_match alone cannot solve the task.

Output:
    dataset-tools/matching-data/realistic_matching_pairs.csv
"""

from pathlib import Path
import random
import sys

import pandas as pd


# ============================================================
# CONFIGURATION
# ============================================================

SEED = 42

POSITIVE_PAIRS = 691
SAME_CATEGORY_NEGATIVE_PAIRS = 691
DIFFERENT_CATEGORY_NEGATIVE_PAIRS = 691


# ============================================================
# PATHS
# ============================================================

PROJECT_ROOT = Path(__file__).resolve().parents[2]

ORIGINAL_PAIR_FILE = (
    PROJECT_ROOT
    / "dataset-tools"
    / "matching-data"
    / "matching_pairs.csv"
)

OUTPUT_FILE = (
    PROJECT_ROOT
    / "dataset-tools"
    / "matching-data"
    / "realistic_matching_pairs.csv"
)


# ============================================================
# HELPERS
# ============================================================

def normalize_path(value):
    """
    Normalize a stored image path for consistent comparison.
    """

    return str(value).replace("\\", "/").strip()


def canonical_pair(path_a, path_b):
    """
    Create an order-independent pair identifier.

    This prevents the same pair from being generated twice
    in reverse order.
    """

    a = normalize_path(path_a)
    b = normalize_path(path_b)

    return tuple(sorted([a, b]))


# ============================================================
# MAIN
# ============================================================

def main():

    print("=" * 70)
    print("TraceMate Realistic Experimental Matching Dataset")
    print("=" * 70)

    random.seed(SEED)

    # --------------------------------------------------------
    # Check input
    # --------------------------------------------------------

    if not ORIGINAL_PAIR_FILE.exists():

        print()
        print("ERROR: Existing pair dataset not found:")
        print(ORIGINAL_PAIR_FILE)

        sys.exit(1)

    # --------------------------------------------------------
    # Load original dataset
    # --------------------------------------------------------

    print()
    print("Loading source pair dataset:")
    print(ORIGINAL_PAIR_FILE)

    source = pd.read_csv(
        ORIGINAL_PAIR_FILE
    )

    required_columns = [
        "image_a",
        "image_b",
        "category_a",
        "category_b",
    ]

    missing = [
        column
        for column in required_columns
        if column not in source.columns
    ]

    if missing:

        print()
        print("ERROR: Missing columns:")
        print(missing)

        sys.exit(1)

    # --------------------------------------------------------
    # Build unique image -> category mapping
    # --------------------------------------------------------

    image_category = {}

    for _, row in source.iterrows():

        image_a = normalize_path(
            row["image_a"]
        )

        image_b = normalize_path(
            row["image_b"]
        )

        category_a = str(
            row["category_a"]
        ).strip()

        category_b = str(
            row["category_b"]
        ).strip()

        image_category[image_a] = category_a
        image_category[image_b] = category_b

    print()
    print(
        f"Unique images: {len(image_category)}"
    )

    # --------------------------------------------------------
    # Group images by category
    # --------------------------------------------------------

    category_images = {}

    for image, category in image_category.items():

        category_images.setdefault(
            category,
            []
        ).append(image)

    print()
    print(
        f"Categories: {len(category_images)}"
    )

    for category in sorted(category_images):

        print(
            f"  {category:<20} "
            f"{len(category_images[category])} images"
        )

    # --------------------------------------------------------
    # Create all candidate same-category pairs
    # --------------------------------------------------------

    same_category_candidates = []

    for category, images in category_images.items():

        if len(images) < 2:
            continue

        for i in range(len(images)):

            for j in range(
                i + 1,
                len(images)
            ):

                image_a = images[i]
                image_b = images[j]

                same_category_candidates.append(
                    (
                        image_a,
                        image_b,
                        category,
                        category,
                    )
                )

    # --------------------------------------------------------
    # Create different-category candidates
    # --------------------------------------------------------

    categories = sorted(
        category_images.keys()
    )

    different_category_candidates = []

    for i in range(len(categories)):

        for j in range(
            i + 1,
            len(categories)
        ):

            category_a = categories[i]
            category_b = categories[j]

            images_a = category_images[
                category_a
            ]

            images_b = category_images[
                category_b
            ]

            # Generate combinations.
            for image_a in images_a:

                for image_b in images_b:

                    different_category_candidates.append(
                        (
                            image_a,
                            image_b,
                            category_a,
                            category_b,
                        )
                    )

    print()
    print(
        f"Same-category candidates: "
        f"{len(same_category_candidates)}"
    )

    print(
        f"Different-category candidates: "
        f"{len(different_category_candidates)}"
    )

    # --------------------------------------------------------
    # Shuffle candidates
    # --------------------------------------------------------

    random.shuffle(
        same_category_candidates
    )

    random.shuffle(
        different_category_candidates
    )

    # --------------------------------------------------------
    # Generate dataset
    # --------------------------------------------------------

    rows = []

    used_pairs = set()

    # --------------------------------------------------------
    # POSITIVE PAIRS
    #
    # Positive means same image.
    #
    # The source dataset contains one copy of each image,
    # so we represent the same visual item by pairing the
    # image with itself.
    #
    # This is intentionally documented as a synthetic
    # experimental positive.
    # --------------------------------------------------------

    all_images = list(
        image_category.keys()
    )

    if len(all_images) < POSITIVE_PAIRS:

        print()
        print(
            "ERROR: Not enough unique images "
            "for requested positive pairs."
        )

        sys.exit(1)

    random.shuffle(all_images)

    positive_images = all_images[
        :POSITIVE_PAIRS
    ]

    for image in positive_images:

        category = image_category[
            image
        ]

        rows.append(
            {
                "image_a": image,
                "image_b": image,
                "category_a": category,
                "category_b": category,
                "pair_type": "positive_same_image",
                "category_match": 1,
                "match": 1,
            }
        )

    # --------------------------------------------------------
    # SAME CATEGORY NEGATIVES
    # --------------------------------------------------------

    same_negative_count = 0

    for (
        image_a,
        image_b,
        category_a,
        category_b,
    ) in same_category_candidates:

        pair_id = canonical_pair(
            image_a,
            image_b
        )

        if pair_id in used_pairs:
            continue

        used_pairs.add(pair_id)

        rows.append(
            {
                "image_a": image_a,
                "image_b": image_b,
                "category_a": category_a,
                "category_b": category_b,
                "pair_type": "negative_same_category",
                "category_match": 1,
                "match": 0,
            }
        )

        same_negative_count += 1

        if (
            same_negative_count
            >= SAME_CATEGORY_NEGATIVE_PAIRS
        ):
            break

    # --------------------------------------------------------
    # DIFFERENT CATEGORY NEGATIVES
    # --------------------------------------------------------

    different_negative_count = 0

    for (
        image_a,
        image_b,
        category_a,
        category_b,
    ) in different_category_candidates:

        pair_id = canonical_pair(
            image_a,
            image_b
        )

        if pair_id in used_pairs:
            continue

        used_pairs.add(pair_id)

        rows.append(
            {
                "image_a": image_a,
                "image_b": image_b,
                "category_a": category_a,
                "category_b": category_b,
                "pair_type": "negative_different_category",
                "category_match": 0,
                "match": 0,
            }
        )

        different_negative_count += 1

        if (
            different_negative_count
            >= DIFFERENT_CATEGORY_NEGATIVE_PAIRS
        ):
            break

    # --------------------------------------------------------
    # Check counts
    # --------------------------------------------------------

    result = pd.DataFrame(rows)

    print()
    print("-" * 70)
    print("DATASET COMPOSITION")
    print("-" * 70)

    print()
    print(
        result["pair_type"]
        .value_counts()
        .to_string()
    )

    print()
    print("Total rows:")
    print(len(result))

    # --------------------------------------------------------
    # Validate requested counts
    # --------------------------------------------------------

    if same_negative_count < SAME_CATEGORY_NEGATIVE_PAIRS:

        print()
        print(
            "WARNING: Could not create the requested "
            "number of same-category negative pairs."
        )

    if (
        different_negative_count
        < DIFFERENT_CATEGORY_NEGATIVE_PAIRS
    ):

        print()
        print(
            "WARNING: Could not create the requested "
            "number of different-category negative pairs."
        )

    # --------------------------------------------------------
    # Verify category_match is no longer equal to match
    # --------------------------------------------------------

    print()
    print("-" * 70)
    print("CATEGORY MATCH VS LABEL")
    print("-" * 70)

    cross_tab = pd.crosstab(
        result["category_match"],
        result["match"],
        rownames=["category_match"],
        colnames=["match"],
    )

    print()
    print(cross_tab.to_string())

    # --------------------------------------------------------
    # Verify same-category negatives exist
    # --------------------------------------------------------

    same_category_negative = result[
        (
            result["category_match"] == 1
        )
        &
        (
            result["match"] == 0
        )
    ]

    print()
    print(
        "Same-category negative pairs: "
        f"{len(same_category_negative)}"
    )

    # --------------------------------------------------------
    # Verify positive pairs
    # --------------------------------------------------------

    positive_count = int(
        (
            result["match"] == 1
        ).sum()
    )

    negative_count = int(
        (
            result["match"] == 0
        ).sum()
    )

    print()
    print(
        f"Positive pairs: {positive_count}"
    )

    print(
        f"Negative pairs: {negative_count}"
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
    # Final output
    # --------------------------------------------------------

    print()
    print("=" * 70)
    print("REALISTIC EXPERIMENTAL DATASET COMPLETE")
    print("=" * 70)

    print()
    print("Output:")
    print(OUTPUT_FILE)

    print()
    print("Columns:")

    for column in result.columns:

        print(
            f"  - {column}"
        )

    print()
    print(
        "IMPORTANT:"
    )

    print(
        "This is a controlled experimental dataset."
    )

    print(
        "It is NOT a real Lost-vs-Found identity dataset."
    )

    print(
        "Positive pairs use the same image as a synthetic "
        "positive example."
    )

    print()
    print("=" * 70)


if __name__ == "__main__":
    main()