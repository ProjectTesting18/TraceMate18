"""
TraceMate - Lost/Found Matching Pair Dataset Generator

Creates a research dataset of positive and negative image pairs
from the prepared LostNet test dataset.

IMPORTANT:
This is a visual-category pair dataset.
It is NOT a real Lost-vs-Found identity dataset because the
source dataset does not contain Lost/Found report identities.

Positive:
    same category

Negative:
    different category
"""

from pathlib import Path
import csv
import random


# ============================================================
# PATHS
# ============================================================

ROOT_DIR = Path(__file__).resolve().parents[2]

TEST_DIR = (
    ROOT_DIR
    / "dataset-tools"
    / "training-data"
    / "test"
)

OUTPUT_DIR = (
    ROOT_DIR
    / "dataset-tools"
    / "matching-data"
)


# ============================================================
# SETTINGS
# ============================================================

SEED = 42

# Number of positive and negative pairs.
PAIRS_PER_CLASS = 5000


# ============================================================
# COLLECT IMAGES
# ============================================================

def collect_images():

    class_images = {}

    for class_dir in sorted(TEST_DIR.iterdir()):

        if not class_dir.is_dir():
            continue

        images = []

        for image_path in sorted(class_dir.iterdir()):

            if image_path.suffix.lower() in {
                ".jpg",
                ".jpeg",
                ".png",
                ".bmp",
                ".webp"
            }:
                images.append(image_path)

        if images:
            class_images[class_dir.name] = images

    return class_images


# ============================================================
# POSITIVE PAIRS
# ============================================================

def create_positive_pairs(
    class_images,
    target_count,
    rng
):

    candidates = []

    for class_name, images in class_images.items():

        for i in range(len(images)):

            for j in range(
                i + 1,
                len(images)
            ):

                candidates.append(
                    (
                        images[i],
                        images[j],
                        class_name,
                        class_name,
                        1
                    )
                )

    if target_count > len(candidates):

        target_count = len(candidates)

    return rng.sample(
        candidates,
        target_count
    )


# ============================================================
# NEGATIVE PAIRS
# ============================================================

def create_negative_pairs(
    class_images,
    target_count,
    rng
):

    candidates = []

    class_names = sorted(
        class_images.keys()
    )

    for i in range(len(class_names)):

        class_a = class_names[i]

        for j in range(
            i + 1,
            len(class_names)
        ):

            class_b = class_names[j]

            for image_a in class_images[class_a]:

                for image_b in class_images[class_b]:

                    candidates.append(
                        (
                            image_a,
                            image_b,
                            class_a,
                            class_b,
                            0
                        )
                    )

    if target_count > len(candidates):

        target_count = len(candidates)

    return rng.sample(
        candidates,
        target_count
    )


# ============================================================
# SAVE CSV
# ============================================================

def save_pairs(
    pairs,
    output_path
):

    with open(
        output_path,
        "w",
        newline="",
        encoding="utf-8"
    ) as file:

        writer = csv.writer(file)

        writer.writerow(
            [
                "image_a",
                "image_b",
                "category_a",
                "category_b",
                "match"
            ]
        )

        for (
            image_a,
            image_b,
            category_a,
            category_b,
            match
        ) in pairs:

            writer.writerow(
                [
                    str(image_a),
                    str(image_b),
                    category_a,
                    category_b,
                    match
                ]
            )


# ============================================================
# MAIN
# ============================================================

def main():

    print()
    print("=" * 70)
    print("TraceMate Matching Pair Dataset Generator")
    print("=" * 70)

    if not TEST_DIR.exists():

        raise FileNotFoundError(
            f"Test dataset not found:\n{TEST_DIR}"
        )

    OUTPUT_DIR.mkdir(
        parents=True,
        exist_ok=True
    )

    rng = random.Random(
        SEED
    )

    # --------------------------------------------------------
    # Collect images
    # --------------------------------------------------------

    class_images = collect_images()

    print()
    print("Categories:")

    total_images = 0

    for class_name in sorted(
        class_images
    ):

        count = len(
            class_images[class_name]
        )

        total_images += count

        print(
            f"  {class_name:15s} "
            f"{count:4d}"
        )

    print()
    print(
        f"Total images: {total_images}"
    )

    # --------------------------------------------------------
    # Create positive pairs
    # --------------------------------------------------------

    print()
    print(
        "Creating positive pairs..."
    )

    positive_pairs = create_positive_pairs(
        class_images,
        PAIRS_PER_CLASS,
        rng
    )

    print(
        f"Positive pairs: "
        f"{len(positive_pairs)}"
    )

    # --------------------------------------------------------
    # Create negative pairs
    # --------------------------------------------------------

    print()
    print(
        "Creating negative pairs..."
    )

    negative_pairs = create_negative_pairs(
        class_images,
        PAIRS_PER_CLASS,
        rng
    )

    print(
        f"Negative pairs: "
        f"{len(negative_pairs)}"
    )

    # --------------------------------------------------------
    # Combine
    # --------------------------------------------------------

    pairs = (
        positive_pairs +
        negative_pairs
    )

    rng.shuffle(
        pairs
    )

    # --------------------------------------------------------
    # Save
    # --------------------------------------------------------

    output_path = (
        OUTPUT_DIR
        / "matching_pairs.csv"
    )

    save_pairs(
        pairs,
        output_path
    )

    # --------------------------------------------------------
    # Summary
    # --------------------------------------------------------

    print()
    print("=" * 70)
    print("PAIR DATASET CREATED")
    print("=" * 70)

    print(
        f"Positive pairs: "
        f"{len(positive_pairs)}"
    )

    print(
        f"Negative pairs: "
        f"{len(negative_pairs)}"
    )

    print(
        f"Total pairs: "
        f"{len(pairs)}"
    )

    print()
    print(
        f"CSV: {output_path}"
    )

    print()
    print(
        "Label meaning:"
    )

    print(
        "  1 = same visual category"
    )

    print(
        "  0 = different visual category"
    )

    print()
    print("=" * 70)


if __name__ == "__main__":
    main()