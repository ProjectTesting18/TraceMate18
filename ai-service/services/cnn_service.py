"""
TraceMate image feature extraction.

Visual pipeline:

    MobileNetV2
        +
    CLIP
        ↓
    Hybrid visual information

MobileNetV2 remains the primary/backward-compatible embedding exposed
through the existing `embedding` field.

CLIP is added as an additional embedding through `clip_embedding`.

If MobileNetV2 cannot be loaded, the existing deterministic RGB histogram
fallback is still used.

If CLIP cannot be loaded, MobileNetV2 continues to work independently.

Important:
    Similarity percentages are similarity measurements, not model accuracy.
"""

from __future__ import annotations

from io import BytesIO
from functools import lru_cache

import numpy as np
from PIL import Image


# ============================================================
# MOBILE NET V2
# ============================================================

@lru_cache(maxsize=1)
def get_cnn_model():
    """
    Lazily load MobileNetV2.

    This keeps FastAPI startup working even when PyTorch/torchvision
    is unavailable.
    """

    try:
        import torch
        import torch.nn as nn
        from torchvision.models import (
            mobilenet_v2,
            MobileNet_V2_Weights,
        )

        weights = MobileNet_V2_Weights.DEFAULT

        model = mobilenet_v2(
            weights=weights
        )

        # Remove the classifier so we get the feature vector.
        model.classifier = nn.Identity()

        model.eval()

        return (
            model,
            weights.transforms(),
            "MobileNetV2",
        )

    except Exception as exc:
        return (
            None,
            exc,
            "fallback",
        )


def _cnn_embedding(
    image: Image.Image,
) -> tuple[np.ndarray, str]:

    model, transform_or_error, model_name = (
        get_cnn_model()
    )

    # --------------------------------------------------------
    # FALLBACK
    # --------------------------------------------------------

    if model is None:
        return (
            _fallback_embedding(image),
            "ColorHistogramFallback",
        )

    # --------------------------------------------------------
    # MOBILENETV2
    # --------------------------------------------------------

    tensor = (
        transform_or_error(image)
        .unsqueeze(0)
    )

    import torch

    with torch.inference_mode():

        embedding = (
            model(tensor)
            .squeeze(0)
            .cpu()
            .numpy()
            .astype(np.float32)
        )

    return (
        _normalize(embedding),
        model_name,
    )


# ============================================================
# COLOR HISTOGRAM FALLBACK
# ============================================================

def _fallback_embedding(
    image: Image.Image,
) -> np.ndarray:

    # 16 bins x 3 RGB channels = 48 features.
    resized = image.resize(
        (64, 64)
    )

    array = np.asarray(
        resized,
        dtype=np.uint8,
    )

    features = []

    for channel in range(3):

        histogram, _ = np.histogram(
            array[:, :, channel],
            bins=16,
            range=(0, 256),
        )

        histogram = histogram.astype(
            np.float32
        )

        histogram /= max(
            float(histogram.sum()),
            1.0,
        )

        features.extend(
            histogram.tolist()
        )

    return _normalize(
        np.asarray(
            features,
            dtype=np.float32,
        )
    )


# ============================================================
# NORMALIZATION
# ============================================================

def _normalize(
    vector: np.ndarray,
) -> np.ndarray:

    vector = np.asarray(
        vector,
        dtype=np.float32,
    ).reshape(-1)

    norm = float(
        np.linalg.norm(vector)
    )

    if norm <= 1e-12:
        raise ValueError(
            "Image feature vector has zero magnitude."
        )

    return vector / norm


# ============================================================
# CLIP
# ============================================================

@lru_cache(maxsize=1)
def get_clip_model():
    """
    Lazily load pretrained CLIP.

    CLIP is kept independent from MobileNetV2 so that failure to load
    CLIP does not stop the existing CNN pipeline.

    The first successful use may download the pretrained model.
    """

    try:

        import torch
        from transformers import (
            CLIPModel,
            CLIPProcessor,
        )

        model_name = (
            "openai/clip-vit-base-patch32"
        )

        processor = (
            CLIPProcessor.from_pretrained(
                model_name
            )
        )

        model = (
            CLIPModel.from_pretrained(
                model_name
            )
        )

        model.eval()

        return (
            model,
            processor,
            torch,
            model_name,
            None,
        )

    except Exception as exc:

        return (
            None,
            None,
            None,
            "CLIP",
            exc,
        )


def _clip_embedding(
    image: Image.Image,
) -> tuple[np.ndarray | None, str, str | None]:
    """
    Generate a CLIP image embedding.

    Returns:

        embedding
        model name
        error message
    """

    (
        model,
        processor,
        torch,
        model_name,
        error,
    ) = get_clip_model()

    if model is None:

        return (
            None,
            model_name,
            str(error)
            if error
            else "CLIP unavailable",
        )

    try:

        inputs = processor(
            images=image,
            return_tensors="pt",
        )

        with torch.inference_mode():

            image_features = (
                model.get_image_features(
                    **inputs
                )
            )

        embedding = (
            image_features
            .detach()
            .cpu()
            .numpy()
            .astype(np.float32)
            .reshape(-1)
        )

        embedding = _normalize(
            embedding
        )

        return (
            embedding,
            model_name,
            None,
        )

    except Exception as exc:

        return (
            None,
            model_name,
            str(exc),
        )


# ============================================================
# CLIP IMPORT HELPER
# ============================================================

def get_clip_embedding(
    image_bytes: bytes,
) -> dict:

    """
    Public helper for generating only the CLIP embedding.
    """

    if not image_bytes:
        raise ValueError(
            "Image data is empty."
        )

    image = (
        Image.open(
            BytesIO(image_bytes)
        )
        .convert("RGB")
    )

    (
        embedding,
        model_name,
        error,
    ) = _clip_embedding(image)

    if embedding is None:

        return {
            "available": False,
            "embedding": None,
            "embedding_dimension": 0,
            "model": model_name,
            "error": error,
        }

    return {
        "available": True,
        "embedding": embedding.tolist(),
        "embedding_dimension": int(
            embedding.size
        ),
        "model": model_name,
        "method": (
            "pretrained CLIP image "
            "feature extraction"
        ),
    }


# ============================================================
# IMAGE EMBEDDING
# ============================================================

def image_to_embedding(
    image_bytes: bytes,
) -> dict:

    if not image_bytes:
        raise ValueError(
            "Image data is empty."
        )

    image = (
        Image.open(
            BytesIO(image_bytes)
        )
        .convert("RGB")
    )

    # --------------------------------------------------------
    # MOBILE NET V2
    # --------------------------------------------------------

    embedding, model = _cnn_embedding(
        image
    )

    # --------------------------------------------------------
    # CLIP
    # --------------------------------------------------------

    (
        clip_embedding,
        clip_model,
        clip_error,
    ) = _clip_embedding(
        image
    )

    # --------------------------------------------------------
    # RESULT
    # --------------------------------------------------------

    result = {
        # IMPORTANT:
        # Keep this field for the existing Node backend.
        "embedding": embedding.tolist(),

        "embedding_dimension": int(
            embedding.size
        ),

        "model": model,

        "method": (
            "pretrained MobileNetV2 "
            "feature extraction"
            if model == "MobileNetV2"
            else (
                "deterministic RGB "
                "color histogram fallback"
            )
        ),

        # ----------------------------------------------------
        # CLIP
        # ----------------------------------------------------

        "clip_embedding": (
            clip_embedding.tolist()
            if clip_embedding is not None
            else None
        ),

        "clip_embedding_dimension": (
            int(clip_embedding.size)
            if clip_embedding is not None
            else 0
        ),

        "clip_model": clip_model,

        "clip_available": (
            clip_embedding is not None
        ),
    }

    if clip_error:

        result["clip_error"] = clip_error

    # --------------------------------------------------------
    # VISUAL MODEL INFORMATION
    # --------------------------------------------------------

    models = []

    if model == "MobileNetV2":
        models.append("MobileNetV2")

    elif model == "ColorHistogramFallback":
        models.append(
            "ColorHistogramFallback"
        )

    if clip_embedding is not None:
        models.append("CLIP")

    result["visual_models"] = models

    result["visual_method"] = (
        "MobileNetV2 + CLIP feature extraction"
        if (
            model == "MobileNetV2"
            and clip_embedding is not None
        )
        else (
            "MobileNetV2 feature extraction"
            if model == "MobileNetV2"
            else (
                "Color histogram fallback"
                if clip_embedding is None
                else (
                    "Color histogram fallback "
                    "+ CLIP feature extraction"
                )
            )
        )
    )

    return result


# ============================================================
# BACKWARD COMPATIBILITY
# ============================================================

def _image_to_embedding(
    image_bytes: bytes,
) -> np.ndarray:

    """
    Backward-compatible helper used by older TraceMate code.
    """

    result = image_to_embedding(
        image_bytes
    )

    return np.asarray(
        result["embedding"],
        dtype=np.float32,
    )


# ============================================================
# COSINE SIMILARITY
# ============================================================

def cosine_similarity(
    a: np.ndarray,
    b: np.ndarray,
) -> float:

    if (
        a.shape != b.shape
        or a.size == 0
    ):
        raise ValueError(
            "Image embeddings must have "
            "the same non-zero shape."
        )

    a = _normalize(a)
    b = _normalize(b)

    value = float(
        np.dot(a, b)
    )

    return max(
        -1.0,
        min(1.0, value),
    )


def similarity_percentage(
    cosine: float,
) -> float:

    return (
        (cosine + 1.0)
        / 2.0
    ) * 100.0


# ============================================================
# CLIP COSINE SIMILARITY
# ============================================================

def clip_cosine_similarity(
    a: np.ndarray,
    b: np.ndarray,
) -> float:

    return cosine_similarity(
        a,
        b,
    )


# ============================================================
# HYBRID VISUAL SIMILARITY
# ============================================================

def hybrid_visual_similarity(
    mobilenet_percentage: float | None,
    clip_percentage: float | None,
    mobilenet_weight: float = 0.40,
    clip_weight: float = 0.60,
) -> dict:

    """
    Combine MobileNetV2 and CLIP similarity.

    Default:
        MobileNetV2 = 40%
        CLIP       = 60%

    If only one model is available, that model is used.

    This is a similarity score, NOT model accuracy.
    """

    mobile_available = (
        mobilenet_percentage is not None
    )

    clip_available = (
        clip_percentage is not None
    )

    if (
        not mobile_available
        and not clip_available
    ):
        return {
            "available": False,
            "similarity_percentage": None,
            "models_used": [],
        }

    if (
        mobile_available
        and clip_available
    ):

        total_weight = (
            mobilenet_weight
            + clip_weight
        )

        if total_weight <= 0:
            raise ValueError(
                "Visual model weights "
                "must be greater than zero."
            )

        mobile_weight = (
            mobilenet_weight
            / total_weight
        )

        clip_weight_normalized = (
            clip_weight
            / total_weight
        )

        combined = (
            float(mobilenet_percentage)
            * mobile_weight
            +
            float(clip_percentage)
            * clip_weight_normalized
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

        combined = float(
            clip_percentage
        )

        models_used = [
            "CLIP"
        ]

        method = (
            "CLIP visual similarity"
        )

    else:

        combined = float(
            mobilenet_percentage
        )

        models_used = [
            "MobileNetV2"
        ]

        method = (
            "MobileNetV2 visual similarity"
        )

    combined = float(
        np.clip(
            combined,
            0.0,
            100.0,
        )
    )

    return {
        "available": True,

        "similarity_percentage": round(
            combined,
            2,
        ),

        "mobilenet_similarity_percentage": (
            round(
                float(
                    mobilenet_percentage
                ),
                2,
            )
            if mobile_available
            else None
        ),

        "clip_similarity_percentage": (
            round(
                float(
                    clip_percentage
                ),
                2,
            )
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
# IMAGE-TO-IMAGE COMPARISON
# ============================================================

def compare_images(
    image1: bytes,
    image2: bytes,
) -> dict:

    result1 = image_to_embedding(
        image1
    )

    result2 = image_to_embedding(
        image2
    )

    # --------------------------------------------------------
    # MOBILENETV2
    # --------------------------------------------------------

    emb1 = np.asarray(
        result1["embedding"],
        dtype=np.float32,
    )

    emb2 = np.asarray(
        result2["embedding"],
        dtype=np.float32,
    )

    mobile_similarity = (
        cosine_similarity(
            emb1,
            emb2,
        )
    )

    mobile_percentage = (
        similarity_percentage(
            mobile_similarity
        )
    )

    # --------------------------------------------------------
    # CLIP
    # --------------------------------------------------------

    clip_similarity = None
    clip_percentage = None

    clip_emb1 = result1.get(
        "clip_embedding"
    )

    clip_emb2 = result2.get(
        "clip_embedding"
    )

    if (
        isinstance(
            clip_emb1,
            list,
        )
        and isinstance(
            clip_emb2,
            list,
        )
        and len(clip_emb1)
        and len(clip_emb2)
    ):

        clip_array1 = np.asarray(
            clip_emb1,
            dtype=np.float32,
        )

        clip_array2 = np.asarray(
            clip_emb2,
            dtype=np.float32,
        )

        if (
            clip_array1.shape
            == clip_array2.shape
        ):

            clip_similarity = (
                clip_cosine_similarity(
                    clip_array1,
                    clip_array2,
                )
            )

            clip_percentage = (
                similarity_percentage(
                    clip_similarity
                )
            )

    # --------------------------------------------------------
    # HYBRID
    # --------------------------------------------------------

    hybrid = hybrid_visual_similarity(
        mobilenet_percentage=(
            mobile_percentage
        ),
        clip_percentage=(
            clip_percentage
        ),
    )

    # --------------------------------------------------------
    # MODEL DESCRIPTION
    # --------------------------------------------------------

    mobile_model = result1.get(
        "model",
        "MobileNetV2",
    )

    clip_model = result1.get(
        "clip_model",
        "CLIP",
    )

    return {
        # Existing-compatible information
        "model": mobile_model,

        "method": (
            "hybrid MobileNetV2 + CLIP "
            "image similarity"
            if clip_percentage is not None
            else (
                "MobileNetV2 "
                "image similarity"
            )
        ),

        "embedding_dimension": int(
            emb1.size
        ),

        "cosine_similarity": round(
            mobile_similarity,
            6,
        ),

        "similarity_percentage": round(
            mobile_percentage,
            2,
        ),

        # ----------------------------------------------------
        # MobileNetV2
        # ----------------------------------------------------

        "mobilenet_model": mobile_model,

        "mobilenet_cosine_similarity": round(
            mobile_similarity,
            6,
        ),

        "mobilenet_similarity_percentage": (
            round(
                mobile_percentage,
                2,
            )
        ),

        # ----------------------------------------------------
        # CLIP
        # ----------------------------------------------------

        "clip_model": clip_model,

        "clip_cosine_similarity": (
            round(
                clip_similarity,
                6,
            )
            if clip_similarity is not None
            else None
        ),

        "clip_similarity_percentage": (
            round(
                clip_percentage,
                2,
            )
            if clip_percentage is not None
            else None
        ),

        "clip_available": (
            clip_percentage is not None
        ),

        # ----------------------------------------------------
        # HYBRID
        # ----------------------------------------------------

        "hybrid_similarity_percentage": (
            hybrid[
                "similarity_percentage"
            ]
        ),

        "hybrid_models_used": (
            hybrid[
                "models_used"
            ]
        ),

        "hybrid_method": (
            hybrid[
                "method"
            ]
        ),

        "hybrid_mobilenet_weight": (
            hybrid.get(
                "mobilenet_weight",
                0.40,
            )
        ),

        "hybrid_clip_weight": (
            hybrid.get(
                "clip_weight",
                0.60,
            )
        ),

        "note": (
            "Similarity percentages are "
            "normalized similarity scores, "
            "not model accuracy."
        ),
    }


# ============================================================
# MODEL STATUS
# ============================================================

def get_visual_model_status() -> dict:

    # MobileNet status
    cnn_model, _, cnn_name = (
        get_cnn_model()
    )

    mobilenet_available = (
        cnn_model is not None
    )

    # CLIP status
    (
        clip_model,
        _,
        _,
        clip_name,
        clip_error,
    ) = get_clip_model()

    clip_available = (
        clip_model is not None
    )

    return {
        "mobilenet_v2": {
            "available": mobilenet_available,
            "model": (
                "MobileNetV2"
                if mobilenet_available
                else "ColorHistogramFallback"
            ),
        },

        "clip": {
            "available": clip_available,
            "model": clip_name,
            "error": (
                str(clip_error)
                if clip_error
                else None
            ),
        },

        "hybrid": {
            "available": (
                mobilenet_available
                or clip_available
            ),
            "models": [
                model
                for model, available in [
                    (
                        "MobileNetV2",
                        mobilenet_available,
                    ),
                    (
                        "CLIP",
                        clip_available,
                    ),
                ]
                if available
            ],
        },
    }