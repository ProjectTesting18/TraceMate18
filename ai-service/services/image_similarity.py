"""
TraceMate hybrid image similarity service.

Visual pipeline:
    MobileNetV2 embedding
          +
    CLIP image embedding
          ↓
    Hybrid visual similarity

This module handles CLIP only. MobileNetV2 remains in cnn_service.py.

The returned CLIP embedding can be stored alongside the existing
imageEmbedding field so the current TraceMate system remains compatible.
"""

from __future__ import annotations

from functools import lru_cache
from io import BytesIO
from typing import Any

import numpy as np
from PIL import Image


# ============================================================
# CLIP CONFIGURATION
# ============================================================

CLIP_MODEL_NAME = "openai/clip-vit-base-patch32"


# ============================================================
# HELPERS
# ============================================================

def _normalize(vector: np.ndarray) -> np.ndarray:
    """
    L2-normalize an embedding.
    """
    vector = np.asarray(vector, dtype=np.float32).reshape(-1)

    norm = float(np.linalg.norm(vector))

    if norm <= 1e-12:
        return vector

    return vector / norm


def _cosine_similarity(
    embedding1: list[float] | np.ndarray,
    embedding2: list[float] | np.ndarray,
) -> float:
    """
    Calculate cosine similarity between two normalized embeddings.
    """
    a = _normalize(np.asarray(embedding1, dtype=np.float32))
    b = _normalize(np.asarray(embedding2, dtype=np.float32))

    if a.size == 0 or b.size == 0:
        return 0.0

    if a.size != b.size:
        raise ValueError(
            f"Embedding dimensions do not match: "
            f"{a.size} vs {b.size}"
        )

    similarity = float(np.dot(a, b))

    return float(np.clip(similarity, -1.0, 1.0))


def _cosine_to_percentage(cosine: float) -> float:
    """
    Convert cosine similarity [-1, 1] into a bounded percentage [0, 100].

    This is a similarity percentage, NOT model accuracy.
    """
    return float(np.clip(((cosine + 1.0) / 2.0) * 100.0, 0.0, 100.0))


# ============================================================
# LAZY CLIP MODEL
# ============================================================

@lru_cache(maxsize=1)
def get_clip_model():
    """
    Load CLIP lazily.

    The FastAPI application can therefore start even if the CLIP
    dependencies/model are unavailable.

    First use may download the pretrained model from Hugging Face.
    """

    try:
        import torch
        from transformers import CLIPModel, CLIPProcessor

        processor = CLIPProcessor.from_pretrained(
            CLIP_MODEL_NAME
        )

        model = CLIPModel.from_pretrained(
            CLIP_MODEL_NAME
        )

        model.eval()

        return (
            model,
            processor,
            torch,
            "CLIP",
        )

    except Exception as exc:
        return (
            None,
            None,
            None,
            f"CLIP unavailable: {exc}",
        )


# ============================================================
# CLIP IMAGE EMBEDDING
# ============================================================

def image_to_clip_embedding(
    image_bytes: bytes,
) -> dict[str, Any]:
    """
    Generate a CLIP image embedding.

    Returns:
        embedding
        embedding_dimension
        model
        method
        available
    """

    if not image_bytes:
        raise ValueError("Image data is empty.")

    image = Image.open(
        BytesIO(image_bytes)
    ).convert("RGB")

    model, processor, torch, model_name = get_clip_model()

    if model is None:
        raise RuntimeError(model_name)

    inputs = processor(
        images=image,
        return_tensors="pt",
    )

    with torch.inference_mode():
        image_features = model.get_image_features(
            **inputs
        )

    embedding = image_features.detach().cpu().numpy()

    embedding = _normalize(embedding)

    return {
        "embedding": embedding.tolist(),
        "embedding_dimension": int(embedding.size),
        "model": CLIP_MODEL_NAME,
        "method": "pretrained CLIP image feature extraction",
        "available": True,
    }


# ============================================================
# CLIP IMAGE SIMILARITY
# ============================================================

def compare_clip_embeddings(
    embedding1: list[float],
    embedding2: list[float],
) -> dict[str, Any]:
    """
    Compare two CLIP embeddings.
    """

    cosine = _cosine_similarity(
        embedding1,
        embedding2,
    )

    percentage = _cosine_to_percentage(
        cosine
    )

    return {
        "cosine_similarity": round(cosine, 6),
        "similarity_percentage": round(
            percentage,
            2,
        ),
        "embedding_dimension": len(
            embedding1
        ),
        "model": CLIP_MODEL_NAME,
    }


# ============================================================
# IMAGE-TO-IMAGE CLIP COMPARISON
# ============================================================

def compare_clip_images(
    image1_bytes: bytes,
    image2_bytes: bytes,
) -> dict[str, Any]:
    """
    Generate CLIP embeddings for two images and compare them.
    """

    result1 = image_to_clip_embedding(
        image1_bytes
    )

    result2 = image_to_clip_embedding(
        image2_bytes
    )

    comparison = compare_clip_embeddings(
        result1["embedding"],
        result2["embedding"],
    )

    return {
        "model": CLIP_MODEL_NAME,
        "method": "CLIP image-to-image cosine similarity",
        **comparison,
    }


# ============================================================
# HYBRID VISUAL SCORE
# ============================================================

def hybrid_visual_similarity(
    mobilenet_percentage: float | None = None,
    clip_percentage: float | None = None,
    mobilenet_weight: float = 0.40,
    clip_weight: float = 0.60,
) -> dict[str, Any]:
    """
    Combine MobileNetV2 and CLIP visual similarity.

    Default configuration:
        MobileNetV2 = 40%
        CLIP       = 60%

    If only one model is available, the available model is used
    instead of incorrectly treating the missing model as zero.

    IMPORTANT:
    This is a visual similarity score, NOT measured accuracy.
    """

    mobile = (
        float(mobilenet_percentage)
        if mobilenet_percentage is not None
        else None
    )

    clip = (
        float(clip_percentage)
        if clip_percentage is not None
        else None
    )

    mobile_available = (
        mobile is not None
        and np.isfinite(mobile)
    )

    clip_available = (
        clip is not None
        and np.isfinite(clip)
    )

    if not mobile_available and not clip_available:
        return {
            "available": False,
            "similarity_percentage": None,
            "mobilenet_similarity_percentage": None,
            "clip_similarity_percentage": None,
            "mobilenet_weight": mobilenet_weight,
            "clip_weight": clip_weight,
            "models_used": [],
            "method": "No visual embedding available",
        }

    if mobile_available and clip_available:
        total_weight = (
            mobilenet_weight +
            clip_weight
        )

        if total_weight <= 0:
            raise ValueError(
                "Visual model weights must be greater than zero."
            )

        normalized_mobile_weight = (
            mobilenet_weight /
            total_weight
        )

        normalized_clip_weight = (
            clip_weight /
            total_weight
        )

        combined = (
            mobile *
            normalized_mobile_weight
            +
            clip *
            normalized_clip_weight
        )

        models_used = [
            "MobileNetV2",
            "CLIP",
        ]

        method = (
            "Hybrid MobileNetV2 + CLIP "
            "visual similarity"
        )

    elif clip_available:
        combined = clip
        models_used = ["CLIP"]
        method = "CLIP visual similarity"

    else:
        combined = mobile
        models_used = ["MobileNetV2"]
        method = "MobileNetV2 visual similarity"

    return {
        "available": True,
        "similarity_percentage": round(
            float(np.clip(combined, 0.0, 100.0)),
            2,
        ),
        "mobilenet_similarity_percentage": (
            round(mobile, 2)
            if mobile_available
            else None
        ),
        "clip_similarity_percentage": (
            round(clip, 2)
            if clip_available
            else None
        ),
        "mobilenet_weight": (
            mobilenet_weight
        ),
        "clip_weight": (
            clip_weight
        ),
        "models_used": models_used,
        "method": method,
    }


# ============================================================
# HEALTH / MODEL STATUS
# ============================================================

def clip_status() -> dict[str, Any]:
    """
    Return CLIP availability without crashing the service.
    """

    model, processor, torch, status = get_clip_model()

    if model is None:
        return {
            "available": False,
            "model": CLIP_MODEL_NAME,
            "status": status,
        }

    return {
        "available": True,
        "model": CLIP_MODEL_NAME,
        "status": "loaded",
        "device": "cpu",
    }


# ============================================================
# BACKWARD-COMPATIBLE ALIASES
# ============================================================

def cosine_similarity(
    embedding1: list[float],
    embedding2: list[float],
) -> float:
    """
    Public cosine similarity helper.
    """
    return _cosine_similarity(
        embedding1,
        embedding2,
    )


def similarity_percentage(
    cosine: float,
) -> float:
    """
    Public cosine-to-percentage helper.
    """
    return _cosine_to_percentage(
        cosine
    )