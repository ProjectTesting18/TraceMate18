"""
TraceMate - MobileNetV2 Embedding Evaluation

Evaluates the trained TraceMate MobileNetV2 embedding space
using the held-out TEST dataset.

Positive pair:
    Two images from the same category.

Negative pair:
    Two images from different categories.

IMPORTANT:
This evaluates category-level visual discrimination.
It is NOT the final Lost-vs-Found identity matching evaluation.
"""

from pathlib import Path
from collections import defaultdict

import numpy as np
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

TEST_DIR = (
    ROOT_DIR
    / "dataset-tools"
    / "training-data"
    / "test"
)


# ============================================================
# SETTINGS
# ============================================================

IMAGE_SIZE = (224, 224)

# Number of positive and negative pairs.
# Keeping these equal gives a balanced evaluation.
NUM_PAIRS_PER_CLASS = 5000

SEED = 42

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
        outputs=trained_model.get_layer("embedding").output,
        name="TraceMate_MobileNetV2_Embedding"
    )

    print(f"Model: {MODEL_PATH}")
    print("Embedding dimensions: 1280")

    return embedding_model


# ============================================================
# FIND TEST IMAGES
# ============================================================

def collect_test_images():

    if not TEST_DIR.exists():
        raise FileNotFoundError(
            f"Test directory not found:\n{TEST_DIR}"
        )

    class_images = defaultdict(list)

    for class_dir in sorted(TEST_DIR.iterdir()):

        if not class_dir.is_dir():
            continue

        for image_path in sorted(class_dir.iterdir()):

            if image_path.suffix.lower() in {
                ".jpg",
                ".jpeg",
                ".png",
                ".bmp",
                ".webp"
            }:
                class_images[class_dir.name].append(
                    image_path
                )

    return dict(class_images)


# ============================================================
# IMAGE LOADING
# ============================================================

def load_image(image_path):

    image = tf.keras.utils.load_img(
        image_path,
        target_size=IMAGE_SIZE
    )

    image_array = tf.keras.utils.img_to_array(
        image
    )

    image_array = tf.keras.applications.mobilenet_v2.preprocess_input(
        image_array
    )

    return image_array


# ============================================================
# EXTRACT ALL EMBEDDINGS
# ============================================================

def extract_all_embeddings(
    embedding_model,
    class_images
):

    image_paths = []
    labels = []

    for class_name in sorted(class_images):

        for image_path in class_images[class_name]:

            image_paths.append(image_path)
            labels.append(class_name)

    print()
    print("=" * 70)
    print("Extracting test-set embeddings")
    print("=" * 70)

    print(f"Images: {len(image_paths)}")
    print(f"Batch size: {BATCH_SIZE}")

    images = np.zeros(
        (
            len(image_paths),
            IMAGE_SIZE[0],
            IMAGE_SIZE[1],
            3
        ),
        dtype=np.float32
    )

    for index, image_path in enumerate(image_paths):

        images[index] = load_image(
            image_path
        )

        if (index + 1) % 100 == 0:

            print(
                f"Loaded {index + 1}/"
                f"{len(image_paths)} images"
            )

    print()
    print("Running MobileNetV2 embedding extraction...")

    embeddings = embedding_model.predict(
        images,
        batch_size=BATCH_SIZE,
        verbose=1
    )

    embeddings = np.asarray(
        embeddings,
        dtype=np.float32
    )

    # --------------------------------------------------------
    # L2 normalize embeddings
    # --------------------------------------------------------

    norms = np.linalg.norm(
        embeddings,
        axis=1,
        keepdims=True
    )

    norms = np.maximum(
        norms,
        1e-12
    )

    embeddings = (
        embeddings / norms
    )

    print()
    print(
        f"Embedding matrix shape: "
        f"{embeddings.shape}"
    )

    return (
        image_paths,
        np.asarray(labels),
        embeddings
    )


# ============================================================
# CREATE BALANCED PAIRS
# ============================================================

def create_pairs(
    labels,
    num_pairs,
    seed
):

    rng = np.random.default_rng(seed)

    positive_candidates = []

    negative_candidates = []

    label_to_indices = defaultdict(list)

    for index, label in enumerate(labels):
        label_to_indices[label].append(index)

    class_names = sorted(
        label_to_indices.keys()
    )

    # --------------------------------------------------------
    # Positive pairs
    # --------------------------------------------------------

    for class_name in class_names:

        indices = label_to_indices[class_name]

        if len(indices) < 2:
            continue

        # Generate combinations.
        for i in range(len(indices)):

            for j in range(
                i + 1,
                len(indices)
            ):

                positive_candidates.append(
                    (
                        indices[i],
                        indices[j]
                    )
                )

    # --------------------------------------------------------
    # Negative pairs
    # --------------------------------------------------------

    for class_a_index in range(
        len(class_names)
    ):

        class_a = class_names[
            class_a_index
        ]

        indices_a = label_to_indices[
            class_a
        ]

        for class_b_index in range(
            class_a_index + 1,
            len(class_names)
        ):

            class_b = class_names[
                class_b_index
            ]

            indices_b = label_to_indices[
                class_b
            ]

            for index_a in indices_a:

                for index_b in indices_b:

                    negative_candidates.append(
                        (
                            index_a,
                            index_b
                        )
                    )

    # --------------------------------------------------------
    # Sample balanced number of pairs
    # --------------------------------------------------------

    num_positive = min(
        num_pairs,
        len(positive_candidates)
    )

    num_negative = min(
        num_pairs,
        len(negative_candidates)
    )

    positive_indices = rng.choice(
        len(positive_candidates),
        size=num_positive,
        replace=False
    )

    negative_indices = rng.choice(
        len(negative_candidates),
        size=num_negative,
        replace=False
    )

    positive_pairs = [
        positive_candidates[index]
        for index in positive_indices
    ]

    negative_pairs = [
        negative_candidates[index]
        for index in negative_indices
    ]

    pairs = (
        positive_pairs +
        negative_pairs
    )

    pair_labels = (
        [1] * len(positive_pairs) +
        [0] * len(negative_pairs)
    )

    # Shuffle pair order.
    permutation = rng.permutation(
        len(pairs)
    )

    pairs = [
        pairs[index]
        for index in permutation
    ]

    pair_labels = np.asarray(
        [
            pair_labels[index]
            for index in permutation
        ],
        dtype=np.int32
    )

    return (
        pairs,
        pair_labels
    )


# ============================================================
# COSINE SIMILARITIES
# ============================================================

def calculate_pair_similarities(
    embeddings,
    pairs
):

    similarities = np.zeros(
        len(pairs),
        dtype=np.float32
    )

    for index, (
        image_a,
        image_b
    ) in enumerate(pairs):

        # Embeddings are already L2 normalized.
        similarities[index] = np.dot(
            embeddings[image_a],
            embeddings[image_b]
        )

    return similarities


# ============================================================
# CLASSIFICATION METRICS
# ============================================================

def calculate_metrics(
    y_true,
    similarities,
    threshold
):

    predictions = (
        similarities >= threshold
    ).astype(np.int32)

    tp = int(
        np.sum(
            (y_true == 1) &
            (predictions == 1)
        )
    )

    tn = int(
        np.sum(
            (y_true == 0) &
            (predictions == 0)
        )
    )

    fp = int(
        np.sum(
            (y_true == 0) &
            (predictions == 1)
        )
    )

    fn = int(
        np.sum(
            (y_true == 1) &
            (predictions == 0)
        )
    )

    accuracy = (
        (tp + tn)
        /
        max(
            tp + tn + fp + fn,
            1
        )
    )

    precision = (
        tp
        /
        max(
            tp + fp,
            1
        )
    )

    recall = (
        tp
        /
        max(
            tp + fn,
            1
        )
    )

    f1 = (
        2
        * precision
        * recall
        /
        max(
            precision + recall,
            1e-12
        )
    )

    return {
        "threshold": float(threshold),
        "accuracy": float(accuracy),
        "precision": float(precision),
        "recall": float(recall),
        "f1": float(f1),
        "tp": tp,
        "tn": tn,
        "fp": fp,
        "fn": fn
    }


# ============================================================
# FIND BEST THRESHOLD
# ============================================================

def find_best_threshold(
    y_true,
    similarities
):

    best_result = None

    # Use the observed similarity range.
    minimum = float(
        np.min(similarities)
    )

    maximum = float(
        np.max(similarities)
    )

    thresholds = np.linspace(
        minimum,
        maximum,
        201
    )

    for threshold in thresholds:

        result = calculate_metrics(
            y_true,
            similarities,
            threshold
        )

        if (
            best_result is None
            or result["f1"]
            > best_result["f1"]
        ):
            best_result = result

    return best_result


# ============================================================
# STATISTICS
# ============================================================

def print_statistics(
    similarities,
    pair_labels
):

    positive_scores = similarities[
        pair_labels == 1
    ]

    negative_scores = similarities[
        pair_labels == 0
    ]

    print()
    print("=" * 70)
    print("SIMILARITY STATISTICS")
    print("=" * 70)

    print()
    print("Positive pairs (same category)")
    print(
        f"Count: {len(positive_scores)}"
    )
    print(
        f"Mean:  "
        f"{np.mean(positive_scores):.6f}"
    )
    print(
        f"Std:   "
        f"{np.std(positive_scores):.6f}"
    )
    print(
        f"Min:   "
        f"{np.min(positive_scores):.6f}"
    )
    print(
        f"Max:   "
        f"{np.max(positive_scores):.6f}"
    )

    print()
    print("Negative pairs (different categories)")
    print(
        f"Count: {len(negative_scores)}"
    )
    print(
        f"Mean:  "
        f"{np.mean(negative_scores):.6f}"
    )
    print(
        f"Std:   "
        f"{np.std(negative_scores):.6f}"
    )
    print(
        f"Min:   "
        f"{np.min(negative_scores):.6f}"
    )
    print(
        f"Max:   "
        f"{np.max(negative_scores):.6f}"
    )


# ============================================================
# MAIN
# ============================================================

def main():

    print()
    print("=" * 70)
    print("TraceMate MobileNetV2 Embedding Evaluation")
    print("=" * 70)

    print()
    print(
        "IMPORTANT:"
    )
    print(
        "This evaluates same-category vs "
        "different-category visual similarity."
    )
    print(
        "It is NOT yet the final Lost-vs-Found "
        "identity matching evaluation."
    )

    # --------------------------------------------------------
    # Load model
    # --------------------------------------------------------

    embedding_model = load_embedding_model()

    # --------------------------------------------------------
    # Collect test images
    # --------------------------------------------------------

    class_images = collect_test_images()

    print()
    print("=" * 70)
    print("TEST DATASET")
    print("=" * 70)

    total_images = 0

    for class_name in sorted(class_images):

        count = len(
            class_images[class_name]
        )

        total_images += count

        print(
            f"{class_name:15s} : {count}"
        )

    print(
        f"\nTotal test images: "
        f"{total_images}"
    )

    # --------------------------------------------------------
    # Extract embeddings
    # --------------------------------------------------------

    (
        image_paths,
        labels,
        embeddings
    ) = extract_all_embeddings(
        embedding_model,
        class_images
    )

    # --------------------------------------------------------
    # Create pairs
    # --------------------------------------------------------

    print()
    print("=" * 70)
    print("CREATING BALANCED PAIRS")
    print("=" * 70)

    (
        pairs,
        pair_labels
    ) = create_pairs(
        labels,
        NUM_PAIRS_PER_CLASS,
        SEED
    )

    positive_count = int(
        np.sum(pair_labels == 1)
    )

    negative_count = int(
        np.sum(pair_labels == 0)
    )

    print(
        f"Positive pairs: {positive_count}"
    )

    print(
        f"Negative pairs: {negative_count}"
    )

    print(
        f"Total pairs: "
        f"{len(pairs)}"
    )

    # --------------------------------------------------------
    # Calculate similarities
    # --------------------------------------------------------

    print()
    print("=" * 70)
    print("CALCULATING COSINE SIMILARITY")
    print("=" * 70)

    similarities = calculate_pair_similarities(
        embeddings,
        pairs
    )

    print(
        "Similarity calculation completed."
    )

    # --------------------------------------------------------
    # Statistics
    # --------------------------------------------------------

    print_statistics(
        similarities,
        pair_labels
    )

    # --------------------------------------------------------
    # Find best threshold
    # --------------------------------------------------------

    print()
    print("=" * 70)
    print("FINDING BEST MATCH THRESHOLD")
    print("=" * 70)

    best_result = find_best_threshold(
        pair_labels,
        similarities
    )

    print()
    print(
        f"Best threshold: "
        f"{best_result['threshold']:.6f}"
    )

    print(
        f"Accuracy: "
        f"{best_result['accuracy'] * 100:.2f}%"
    )

    print(
        f"Precision: "
        f"{best_result['precision'] * 100:.2f}%"
    )

    print(
        f"Recall: "
        f"{best_result['recall'] * 100:.2f}%"
    )

    print(
        f"F1 Score: "
        f"{best_result['f1'] * 100:.2f}%"
    )

    # --------------------------------------------------------
    # Confusion matrix
    # --------------------------------------------------------

    print()
    print("=" * 70)
    print("CONFUSION MATRIX")
    print("=" * 70)

    print()
    print("                    Predicted")
    print("                  Negative Positive")
    print(
        f"Actual Negative   "
        f"{best_result['tn']:8d} "
        f"{best_result['fp']:8d}"
    )

    print(
        f"Actual Positive   "
        f"{best_result['fn']:8d} "
        f"{best_result['tp']:8d}"
    )

    # --------------------------------------------------------
    # Summary
    # --------------------------------------------------------

    print()
    print("=" * 70)
    print("EVALUATION COMPLETE")
    print("=" * 70)

    print()
    print(
        "Model: TraceMate MobileNetV2"
    )

    print(
        "Embedding size: 1280"
    )

    print(
        f"Test images: {total_images}"
    )

    print(
        f"Positive pairs: {positive_count}"
    )

    print(
        f"Negative pairs: {negative_count}"
    )

    print()
    print(
        "Best threshold:"
        f" {best_result['threshold']:.6f}"
    )

    print(
        "F1:"
        f" {best_result['f1'] * 100:.2f}%"
    )

    print()
    print(
        "This threshold is an experimental "
        "category-level visual threshold."
    )

    print(
        "Do NOT yet use it as the final "
        "Lost-vs-Found identity threshold."
    )

    print()
    print("=" * 70)


if __name__ == "__main__":
    main()