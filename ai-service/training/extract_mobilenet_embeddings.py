"""
TraceMate - MobileNetV2 Visual Embedding Extractor

Loads the trained TraceMate MobileNetV2 model and extracts
the 1280-dimensional embedding from the "embedding" layer.

This embedding can later be used for Lost <-> Found
image similarity using cosine similarity.
"""

import json
import sys
from pathlib import Path

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

LABELS_PATH = (
    ROOT_DIR
    / "ai-service"
    / "models"
    / "mobilenetv2_tracemate_labels.json"
)


# ============================================================
# SETTINGS
# ============================================================

IMAGE_SIZE = (224, 224)


# ============================================================
# LOAD MODEL
# ============================================================

def load_embedding_model():
    """
    Load the trained TraceMate MobileNetV2 model and expose
    its 1280-dimensional embedding layer.
    """

    if not MODEL_PATH.exists():
        raise FileNotFoundError(
            f"Trained model not found:\n{MODEL_PATH}"
        )

    print("Loading TraceMate MobileNetV2 model...")
    print(f"Model: {MODEL_PATH}")

    trained_model = tf.keras.models.load_model(
        MODEL_PATH,
        compile=False
    )

    embedding_model = tf.keras.Model(
        inputs=trained_model.input,
        outputs=trained_model.get_layer("embedding").output,
        name="TraceMate_MobileNetV2_Embedding"
    )

    print("Embedding model loaded successfully.")
    print("Embedding size: 1280")

    return trained_model, embedding_model


# ============================================================
# LOAD LABELS
# ============================================================

def load_labels():
    """
    Load the 10 trained object-category labels.
    """

    if not LABELS_PATH.exists():
        print("Warning: labels file not found.")
        return []

    with open(LABELS_PATH, "r", encoding="utf-8") as file:
        labels = json.load(file)

    return labels


# ============================================================
# IMAGE PREPROCESSING
# ============================================================

def load_image(image_path):
    """
    Load and preprocess one image for MobileNetV2.
    """

    image_path = Path(image_path)

    if not image_path.exists():
        raise FileNotFoundError(
            f"Image not found:\n{image_path}"
        )

    image = tf.keras.utils.load_img(
        image_path,
        target_size=IMAGE_SIZE
    )

    image_array = tf.keras.utils.img_to_array(image)

    image_array = np.expand_dims(
        image_array,
        axis=0
    )

    # MobileNetV2 preprocessing:
    # pixel range [0,255] -> [-1,1]
    image_array = tf.keras.applications.mobilenet_v2.preprocess_input(
        image_array
    )

    return image_array


# ============================================================
# EXTRACT EMBEDDING
# ============================================================

def extract_embedding(embedding_model, image_path):
    """
    Extract the 1280-dimensional MobileNetV2 embedding.
    """

    image = load_image(image_path)

    embedding = embedding_model.predict(
        image,
        verbose=0
    )[0]

    embedding = np.asarray(
        embedding,
        dtype=np.float32
    )

    # L2 normalization makes cosine similarity stable.
    norm = np.linalg.norm(embedding)

    if norm > 0:
        embedding = embedding / norm

    return embedding


# ============================================================
# COSINE SIMILARITY
# ============================================================

def cosine_similarity(vector_a, vector_b):
    """
    Calculate cosine similarity between two embeddings.
    """

    vector_a = np.asarray(
        vector_a,
        dtype=np.float32
    )

    vector_b = np.asarray(
        vector_b,
        dtype=np.float32
    )

    norm_a = np.linalg.norm(vector_a)
    norm_b = np.linalg.norm(vector_b)

    if norm_a == 0 or norm_b == 0:
        return 0.0

    similarity = np.dot(
        vector_a,
        vector_b
    ) / (norm_a * norm_b)

    return float(similarity)


# ============================================================
# MAIN TEST
# ============================================================

def main():

    print()
    print("=" * 60)
    print("TraceMate MobileNetV2 Embedding Test")
    print("=" * 60)

    # --------------------------------------------------------
    # Load model
    # --------------------------------------------------------

    trained_model, embedding_model = load_embedding_model()

    # --------------------------------------------------------
    # Load labels
    # --------------------------------------------------------

    labels = load_labels()

    print()
    print("Classes:")

    for label in labels:
        print(f"  - {label}")

    # --------------------------------------------------------
    # Check command-line images
    # --------------------------------------------------------

    if len(sys.argv) < 2:
        print()
        print("No image supplied.")
        print()
        print("Usage:")
        print(
            'python ".\\ai-service\\training\\'
            'extract_mobilenet_embeddings.py" '
            '"path\\to\\image.jpg"'
        )
        print()
        print("The script is ready to extract:")
        print("1280-dimensional MobileNetV2 embeddings.")
        return

    image_path = sys.argv[1]

    print()
    print(f"Input image: {image_path}")

    # --------------------------------------------------------
    # Extract embedding
    # --------------------------------------------------------

    embedding = extract_embedding(
        embedding_model,
        image_path
    )

    print()
    print("Embedding extraction successful.")
    print(f"Embedding shape: {embedding.shape}")
    print(f"Embedding dimensions: {len(embedding)}")
    print(f"Embedding norm: {np.linalg.norm(embedding):.6f}")

    # --------------------------------------------------------
    # Optional second image
    # --------------------------------------------------------

    if len(sys.argv) >= 3:

        second_image_path = sys.argv[2]

        print()
        print(f"Second image: {second_image_path}")

        second_embedding = extract_embedding(
            embedding_model,
            second_image_path
        )

        similarity = cosine_similarity(
            embedding,
            second_embedding
        )

        similarity_percent = (
            (similarity + 1.0)
            / 2.0
            * 100.0
        )

        print()
        print("-" * 60)
        print("VISUAL SIMILARITY")
        print("-" * 60)

        print(
            f"Cosine similarity: "
            f"{similarity:.6f}"
        )

        print(
            f"Similarity percentage: "
            f"{similarity_percent:.2f}%"
        )

    print()
    print("=" * 60)
    print("Embedding test completed.")
    print("=" * 60)


# ============================================================
# ENTRY POINT
# ============================================================

if __name__ == "__main__":
    main()
