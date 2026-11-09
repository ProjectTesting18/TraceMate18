"""
TraceMate Generic Fine-Grained Visual Details

Object-agnostic visual analysis for lost/found item matching.

This module does NOT replace MobileNetV2 or CLIP.
It extracts additional visual structure that can be compared
between two images:

- dominant / mean colour
- brightness / saturation
- shape proxies
- foreground bounding-box proxy
- 3x3 local regions
- local texture / edge density
- high-detail regions
- optional OCR text

Important:
These are image descriptors and similarity features.
They are not model-accuracy measurements.
"""

from __future__ import annotations

from io import BytesIO
import os
from typing import Any

import numpy as np
from PIL import Image, ImageFilter

# ============================================================
# TESSERACT OCR CONFIGURATION
# ============================================================

try:
    import pytesseract

    _TESSERACT_EXE = r"C:\Program Files\Tesseract-OCR\tesseract.exe"

    if os.path.isfile(_TESSERACT_EXE):
        pytesseract.pytesseract.tesseract_cmd = _TESSERACT_EXE

except Exception:
    pytesseract = None


# ============================================================
# BASIC HELPERS
# ============================================================

def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        value = float(value)

        if np.isfinite(value):
            return value

    except Exception:
        pass

    return default


def _clip01(value: float) -> float:
    return float(
        np.clip(
            _safe_float(value),
            0.0,
            1.0,
        )
    )


def _rgb_distance(a: np.ndarray, b: np.ndarray) -> float:
    a = np.asarray(a, dtype=np.float32)
    b = np.asarray(b, dtype=np.float32)

    if a.shape != b.shape or a.size == 0:
        return 1.0

    distance = np.linalg.norm(a - b)

    return float(
        np.clip(
            distance / 441.67296,
            0.0,
            1.0,
        )
    )


def _rgb_to_hsv(rgb: np.ndarray) -> tuple[float, float, float]:
    """
    RGB values expected in [0, 1].
    """

    r, g, b = [
        float(np.clip(v, 0.0, 1.0))
        for v in rgb
    ]

    maximum = max(r, g, b)
    minimum = min(r, g, b)

    delta = maximum - minimum

    value = maximum

    saturation = (
        0.0
        if maximum <= 1e-8
        else delta / maximum
    )

    if delta <= 1e-8:
        hue = 0.0

    elif maximum == r:
        hue = (
            ((g - b) / delta) % 6.0
        ) / 6.0

    elif maximum == g:
        hue = (
            ((b - r) / delta) + 2.0
        ) / 6.0

    else:
        hue = (
            ((r - g) / delta) + 4.0
        ) / 6.0

    return (
        _clip01(hue),
        _clip01(saturation),
        _clip01(value),
    )


def _colour_name(rgb: np.ndarray) -> str:
    """
    Deterministic generic colour description.
    """

    rgb01 = np.asarray(
        rgb,
        dtype=np.float32,
    ) / 255.0

    hue, saturation, value = _rgb_to_hsv(
        rgb01
    )

    if value < 0.18:
        return "black"

    if value > 0.88 and saturation < 0.12:
        return "white"

    if saturation < 0.12:
        if value < 0.42:
            return "dark gray"
        if value < 0.72:
            return "gray"
        return "light gray"

    # Hue sectors
    if hue < 0.05 or hue >= 0.95:
        return "red"

    if hue < 0.11:
        return "orange"

    if hue < 0.18:
        return "yellow"

    if hue < 0.45:
        return "green"

    if hue < 0.56:
        return "cyan"

    if hue < 0.72:
        return "blue"

    if hue < 0.86:
        return "purple"

    return "pink"


def _dominant_colour(
    rgb_pixels: np.ndarray,
    bins: int = 8,
) -> dict:
    """
    Quantize RGB space and select the most frequent colour bin.
    """

    if rgb_pixels.size == 0:
        return {
            "name": "unknown",
            "rgb": [0, 0, 0],
            "percentage": 0.0,
        }

    pixels = np.asarray(
        rgb_pixels,
        dtype=np.float32,
    ).reshape(-1, 3)

    quantized = (
        np.clip(
            pixels,
            0,
            255,
        ) / 256.0 * bins
    ).astype(int)

    quantized = np.clip(
        quantized,
        0,
        bins - 1,
    )

    keys = (
        quantized[:, 0]
        * bins
        * bins
        +
        quantized[:, 1]
        * bins
        +
        quantized[:, 2]
    )

    values, counts = np.unique(
        keys,
        return_counts=True,
    )

    winner = int(
        values[
            int(np.argmax(counts))
        ]
    )

    r_bin = winner // (bins * bins)

    g_bin = (
        winner % (bins * bins)
    ) // bins

    b_bin = winner % bins

    rgb = np.array(
        [
            (r_bin + 0.5)
            * 256.0
            / bins,

            (g_bin + 0.5)
            * 256.0
            / bins,

            (b_bin + 0.5)
            * 256.0
            / bins,
        ],
        dtype=np.float32,
    )

    percentage = (
        float(
            np.max(counts)
        )
        /
        float(
            len(pixels)
        )
        *
        100.0
    )

    return {
        "name": _colour_name(rgb),
        "rgb": [
            round(float(v), 2)
            for v in rgb
        ],
        "percentage": round(
            percentage,
            2,
        ),
    }


def _edge_density(gray: np.ndarray) -> float:
    """
    Simple gradient-based edge density.
    """

    if gray.size == 0:
        return 0.0

    gray = gray.astype(
        np.float32
    )

    dx = np.diff(
        gray,
        axis=1,
    )

    dy = np.diff(
        gray,
        axis=0,
    )

    magnitude_x = np.abs(dx)
    magnitude_y = np.abs(dy)

    score_x = float(
        np.mean(
            magnitude_x > 18.0
        )
    ) if magnitude_x.size else 0.0

    score_y = float(
        np.mean(
            magnitude_y > 18.0
        )
    ) if magnitude_y.size else 0.0

    return _clip01(
        (score_x + score_y) / 2.0
    )


def _texture_score(gray: np.ndarray) -> float:
    """
    Local intensity variance as a lightweight texture proxy.
    """

    if gray.size == 0:
        return 0.0

    value = float(
        np.std(
            gray.astype(
                np.float32
            )
        )
    )

    return _clip01(
        value / 64.0
    )


def _scratch_like_screening(gray: np.ndarray) -> dict:
    """Conservative line/contrast heuristic; not a trained scratch detector."""
    gray = np.asarray(gray, dtype=np.float32)
    if gray.ndim != 2 or min(gray.shape, default=0) < 3:
        return {
            "available": False,
            "possible_mark": None,
            "score": 0.0,
            "confidence": "unavailable",
            "method": "local contrast and directional line response",
        }

    center = gray[1:-1, 1:-1]
    horizontal_neighbours = (gray[1:-1, :-2] + gray[1:-1, 2:]) / 2.0
    vertical_neighbours = (gray[:-2, 1:-1] + gray[2:, 1:-1]) / 2.0
    response = np.maximum(
        np.abs(center - horizontal_neighbours),
        np.abs(center - vertical_neighbours),
    )
    threshold = response >= 22.0
    mark_pixels = int(np.count_nonzero(threshold))
    fraction = mark_pixels / float(max(gray.size, 1))

    # Require a continuous run so isolated texture/noise is less likely to flag.
    longest_run = 0
    for row in threshold:
        run = 0
        for value in row:
            run = run + 1 if value else 0
            longest_run = max(longest_run, run)
    for column in threshold.T:
        run = 0
        for value in column:
            run = run + 1 if value else 0
            longest_run = max(longest_run, run)

    possible_mark = bool(
        mark_pixels >= max(12, int(gray.size * 0.001)) and longest_run >= 10
    )
    score = _clip01(fraction / 0.02)
    return {
        "available": True,
        "possible_mark": possible_mark,
        "score": round(score, 4),
        "contrast_pixel_fraction": round(fraction, 5),
        "longest_line_response": int(longest_run),
        "confidence": "low" if possible_mark else "low/none",
        "method": "local contrast and directional line response",
        "note": "May flag text, seams, edges, texture, or lighting artifacts; not proof of a scratch.",
    }


# ============================================================
# REGION DESCRIPTOR
# ============================================================

def _region_descriptor(
    rgb_region: np.ndarray,
) -> dict:

    if rgb_region.size == 0:
        return {
            "mean_rgb": [0, 0, 0],
            "dominant_color": "unknown",
            "dominant_color_rgb": [0, 0, 0],
            "dominant_color_percentage": 0.0,
            "brightness": 0.0,
            "saturation": 0.0,
            "edge_density": 0.0,
            "texture": 0.0,
        }

    pixels = rgb_region.reshape(-1, 3)

    mean_rgb = np.mean(
        pixels,
        axis=0,
    )

    rgb01 = mean_rgb / 255.0

    (
        _hue,
        saturation,
        brightness,
    ) = _rgb_to_hsv(
        rgb01
    )

    gray = (
        0.299 * rgb_region[:, :, 0]
        +
        0.587 * rgb_region[:, :, 1]
        +
        0.114 * rgb_region[:, :, 2]
    )

    dominant = _dominant_colour(
        pixels
    )

    return {
        "mean_rgb": [
            round(
                float(v),
                2,
            )
            for v in mean_rgb
        ],

        "dominant_color":
            dominant["name"],

        "dominant_color_rgb":
            dominant["rgb"],

        "dominant_color_percentage":
            dominant["percentage"],

        "brightness":
            round(
                _clip01(
                    brightness
                ),
                4,
            ),

        "saturation":
            round(
                _clip01(
                    saturation
                ),
                4,
            ),

        "edge_density":
            round(
                _edge_density(gray),
                4,
            ),

        "texture":
            round(
                _texture_score(gray),
                4,
            ),
    }


# ============================================================
# SHAPE PROFILE / SILHOUETTE
# ============================================================

def _clean_shape_mask(mask: np.ndarray) -> np.ndarray:
    """
    Remove isolated noise and bridge tiny gaps in a binary mask.

    This is intentionally dependency-free so the TraceMate AI service
    does not require OpenCV/scikit-image just for fine shape descriptors.
    """
    mask = np.asarray(mask, dtype=bool)

    if mask.size == 0:
        return mask

    result = mask.copy()

    # Small binary dilation followed by erosion.
    for _ in range(1):
        padded = np.pad(
            result,
            1,
            mode="edge",
        )

        neighbors = [
            padded[:-2, :-2],
            padded[:-2, 1:-1],
            padded[:-2, 2:],
            padded[1:-1, :-2],
            padded[1:-1, 1:-1],
            padded[1:-1, 2:],
            padded[2:, :-2],
            padded[2:, 1:-1],
            padded[2:, 2:],
        ]

        dilated = np.logical_or.reduce(neighbors)

        padded = np.pad(
            dilated,
            1,
            mode="edge",
        )

        neighbors = [
            padded[:-2, :-2],
            padded[:-2, 1:-1],
            padded[:-2, 2:],
            padded[1:-1, :-2],
            padded[1:-1, 1:-1],
            padded[1:-1, 2:],
            padded[2:, :-2],
            padded[2:, 1:-1],
            padded[2:, 2:],
        ]

        result = np.logical_and.reduce(neighbors)

    return result


def _foreground_mask(
    rgb: np.ndarray,
    gray: np.ndarray,
) -> np.ndarray:
    """
    Estimate the object silhouette without assuming a specific object.

    The mask uses both luminance difference and RGB colour distance
    from the image border, then falls back to a looser threshold when
    the first pass is too sparse.
    """
    height, width = gray.shape

    if height <= 0 or width <= 0:
        return np.zeros_like(gray, dtype=bool)

    border_pixels = np.concatenate(
        [
            rgb[0, :, :].reshape(-1, 3),
            rgb[-1, :, :].reshape(-1, 3),
            rgb[:, 0, :].reshape(-1, 3),
            rgb[:, -1, :].reshape(-1, 3),
        ],
        axis=0,
    ).astype(np.float32)

    background_rgb = np.median(
        border_pixels,
        axis=0,
    )

    background_gray = float(
        np.median(
            border_pixels @ np.asarray(
                [0.299, 0.587, 0.114],
                dtype=np.float32,
            )
        )
    )

    rgb_distance = np.linalg.norm(
        rgb.astype(np.float32) -
        background_rgb.reshape(1, 1, 3),
        axis=2,
    )

    gray_distance = np.abs(
        gray -
        background_gray
    )

    combined_difference = (
        0.55 * gray_distance +
        0.45 * rgb_distance
    )

    threshold = max(
        14.0,
        float(
            np.percentile(
                combined_difference,
                72,
            )
        ),
    )

    mask = (
        combined_difference >
        threshold
    )

    minimum_pixels = max(
        24,
        int(
            0.008 *
            gray.size
        ),
    )

    if int(np.sum(mask)) < minimum_pixels:
        threshold = max(
            9.0,
            float(
                np.percentile(
                    combined_difference,
                    55,
                )
            ),
        )

        mask = (
            combined_difference >
            threshold
        )

    # A second relaxed pass helps when the object has similar
    # brightness to the background but still differs in colour.
    if int(np.sum(mask)) < minimum_pixels:
        mask = (
            rgb_distance >
            max(
                10.0,
                float(
                    np.percentile(
                        rgb_distance,
                        60,
                    )
                ),
            )
        )

    mask = _clean_shape_mask(
        mask
    )

    return mask


def _vertical_width_profile(
    mask: np.ndarray,
    bbox: dict,
    bins: int = 12,
) -> list[float]:
    """
    Measure silhouette width at several vertical levels.

    Each value is the occupied silhouette width divided by the
    foreground bounding-box width. This captures structures such as:

        narrow neck -> shoulders -> wider body

    versus:

        nearly constant-width can/cylinder.
    """
    if mask.size == 0:
        return [0.0] * bins

    height, width = mask.shape

    left = int(
        round(
            _clip01(
                bbox.get("left", 0.0)
            ) * width
        )
    )

    right = int(
        round(
            _clip01(
                bbox.get("right", 1.0)
            ) * width
        )
    )

    top = int(
        round(
            _clip01(
                bbox.get("top", 0.0)
            ) * height
        )
    )

    bottom = int(
        round(
            _clip01(
                bbox.get("bottom", 1.0)
            ) * height
        )
    )

    left = max(
        0,
        min(width - 1, left),
    )

    right = max(
        left + 1,
        min(width, right),
    )

    top = max(
        0,
        min(height - 1, top),
    )

    bottom = max(
        top + 1,
        min(height, bottom),
    )

    bbox_width = max(
        1,
        right - left,
    )

    bbox_height = max(
        1,
        bottom - top,
    )

    profile = []

    for index in range(bins):
        y0 = (
            top +
            int(
                round(
                    index *
                    bbox_height /
                    bins
                )
            )
        )

        y1 = (
            top +
            int(
                round(
                    (index + 1) *
                    bbox_height /
                    bins
                )
            )
        )

        y0 = max(
            top,
            min(
                bottom - 1,
                y0,
            )
        )

        y1 = max(
            y0 + 1,
            min(
                bottom,
                y1,
            )
        )

        band = mask[
            y0:y1,
            left:right
        ]

        if band.size == 0 or not np.any(band):
            profile.append(0.0)
            continue

        occupied_columns = np.where(
            np.any(
                band,
                axis=0,
            )
        )[0]

        if occupied_columns.size == 0:
            profile.append(0.0)
            continue

        span = (
            int(
                occupied_columns[-1]
            ) -
            int(
                occupied_columns[0]
            ) +
            1
        )

        profile.append(
            _clip01(
                float(span) /
                float(bbox_width)
            )
        )

    return [
        round(
            float(value),
            4,
        )
        for value in profile
    ]


def _profile_group_mean(
    profile: list[float],
    start: int,
    end: int,
) -> float:
    if not profile:
        return 0.0

    values = profile[
        max(0, start):
        min(len(profile), end)
    ]

    if not values:
        return 0.0

    return float(
        np.mean(
            np.asarray(
                values,
                dtype=np.float32,
            )
        )
    )


def _shape_descriptor(
    rgb: np.ndarray,
) -> dict:
    """
    Generic silhouette descriptor.

    Previous TraceMate shape scoring relied mainly on image
    aspect ratio, bounding-box size and fill ratio. Those are too
    coarse for cases such as:

        small bottle:
            narrow neck -> round shoulders -> body

        large can-like bottle:
            wide top -> little/no neck -> straight body

    This version keeps the legacy fields for compatibility but adds
    a normalized vertical silhouette profile so the neck/shoulder/body
    structure contributes to shape similarity.
    """
    height, width = rgb.shape[:2]

    if width <= 0 or height <= 0:
        return {
            "aspect_ratio": 0.0,
            "foreground_aspect_ratio": 0.0,
            "fill_ratio": 0.0,
            "foreground_fill_ratio": 0.0,
            "edge_density": 0.0,
            "silhouette_area_ratio": 0.0,
            "vertical_width_profile": [],
            "top_width_ratio": 0.0,
            "shoulder_width_ratio": 0.0,
            "middle_width_ratio": 0.0,
            "lower_width_ratio": 0.0,
            "bottom_width_ratio": 0.0,
            "neck_to_body_ratio": 0.0,
            "profile_variation": 0.0,
            "profile_change": 0.0,
            "shape_signature_version": "2.0",
        }

    gray = (
        0.299 * rgb[:, :, 0].astype(np.float32)
        +
        0.587 * rgb[:, :, 1].astype(np.float32)
        +
        0.114 * rgb[:, :, 2].astype(np.float32)
    )

    mask = _foreground_mask(
        rgb,
        gray,
    )

    # Avoid a pathological full-image silhouette.
    mask_area = int(
        np.sum(mask)
    )

    if (
        mask_area >
        int(0.97 * gray.size)
    ):
        relaxed = (
            np.abs(
                gray -
                float(
                    np.median(
                        np.concatenate(
                            [
                                gray[0, :],
                                gray[-1, :],
                                gray[:, 0],
                                gray[:, -1],
                            ]
                        )
                    )
                )
            )
            >
            max(
                18.0,
                float(
                    np.percentile(
                        np.abs(
                            gray -
                            float(
                                np.median(
                                    gray
                                )
                            )
                        ),
                        65,
                    )
                ),
            )
        )

        relaxed = _clean_shape_mask(
            relaxed
        )

        if (
            0 < int(np.sum(relaxed))
            < int(0.97 * gray.size)
        ):
            mask = relaxed

    ys, xs = np.where(mask)

    if len(xs) == 0:
        bbox = {
            "left": 0.0,
            "top": 0.0,
            "right": 1.0,
            "bottom": 1.0,
        }

        fill_ratio = 0.0
        foreground_fill_ratio = 0.0
        foreground_aspect_ratio = (
            float(width) /
            float(max(height, 1))
        )

        profile = [0.0] * 12

    else:
        left = float(
            np.min(xs)
        ) / width

        right = float(
            np.max(xs) + 1
        ) / width

        top = float(
            np.min(ys)
        ) / height

        bottom = float(
            np.max(ys) + 1
        ) / height

        bbox = {
            "left": round(
                _clip01(left),
                4,
            ),
            "top": round(
                _clip01(top),
                4,
            ),
            "right": round(
                _clip01(right),
                4,
            ),
            "bottom": round(
                _clip01(bottom),
                4,
            ),
        }

        fill_ratio = (
            float(
                np.sum(mask)
            )
            /
            float(
                gray.size
            )
        )

        bbox_width = max(
            1,
            int(
                np.max(xs) -
                np.min(xs) +
                1
            ),
        )

        bbox_height = max(
            1,
            int(
                np.max(ys) -
                np.min(ys) +
                1
            ),
        )

        foreground_aspect_ratio = (
            float(bbox_width) /
            float(bbox_height)
        )

        foreground_fill_ratio = (
            float(
                np.sum(mask)
            )
            /
            float(
                bbox_width *
                bbox_height
            )
        )

        profile = _vertical_width_profile(
            mask,
            bbox,
            bins=12,
        )

    top_width = _profile_group_mean(
        profile,
        0,
        2,
    )

    shoulder_width = _profile_group_mean(
        profile,
        2,
        4,
    )

    middle_width = _profile_group_mean(
        profile,
        4,
        8,
    )

    lower_width = _profile_group_mean(
        profile,
        8,
        10,
    )

    bottom_width = _profile_group_mean(
        profile,
        10,
        12,
    )

    neck_to_body_ratio = (
        top_width /
        max(
            middle_width,
            1e-6,
        )
    )

    profile_array = np.asarray(
        profile,
        dtype=np.float32,
    )

    profile_variation = (
        float(
            np.std(
                profile_array
            )
        )
        if profile_array.size
        else 0.0
    )

    if profile_array.size >= 2:
        profile_change = float(
            np.mean(
                np.abs(
                    np.diff(
                        profile_array
                    )
                )
            )
        )
    else:
        profile_change = 0.0

    object_edge_density = (
        _edge_density(
            gray
        )
    )

    if len(xs) > 0:
        x0 = int(
            np.min(xs)
        )
        x1 = int(
            np.max(xs) + 1
        )
        y0 = int(
            np.min(ys)
        )
        y1 = int(
            np.max(ys) + 1
        )

        object_gray = gray[
            y0:y1,
            x0:x1
        ]

        object_edge_density = (
            _edge_density(
                object_gray
            )
        )

    return {
        # Legacy image-level aspect ratio.
        "aspect_ratio":
            round(
                float(width) /
                float(height),
                4,
            ),

        # Foreground/object aspect ratio is much more informative
        # for silhouette matching.
        "foreground_aspect_ratio":
            round(
                float(
                    foreground_aspect_ratio
                ),
                4,
            ),

        "foreground_bbox":
            bbox,

        # Legacy fill ratio kept for compatibility.
        "fill_ratio":
            round(
                _clip01(
                    fill_ratio
                ),
                4,
            ),

        # New silhouette-local fill ratio.
        "foreground_fill_ratio":
            round(
                _clip01(
                    foreground_fill_ratio
                ),
                4,
            ),

        # Use the object region where possible.
        "edge_density":
            round(
                _clip01(
                    object_edge_density
                ),
                4,
            ),

        "silhouette_area_ratio":
            round(
                _clip01(
                    foreground_fill_ratio
                ),
                4,
            ),

        # Twelve normalized width samples from top to bottom.
        "vertical_width_profile":
            profile,

        # Coarse interpretable structure.
        "top_width_ratio":
            round(
                _clip01(
                    top_width
                ),
                4,
            ),

        "shoulder_width_ratio":
            round(
                _clip01(
                    shoulder_width
                ),
                4,
            ),

        "middle_width_ratio":
            round(
                _clip01(
                    middle_width
                ),
                4,
            ),

        "lower_width_ratio":
            round(
                _clip01(
                    lower_width
                ),
                4,
            ),

        "bottom_width_ratio":
            round(
                _clip01(
                    bottom_width
                ),
                4,
            ),

        "neck_to_body_ratio":
            round(
                float(
                    np.clip(
                        neck_to_body_ratio,
                        0.0,
                        2.0,
                    )
                ),
                4,
            ),

        "profile_variation":
            round(
                _clip01(
                    profile_variation
                ),
                4,
            ),

        "profile_change":
            round(
                _clip01(
                    profile_change
                ),
                4,
            ),

        "shape_signature_version":
            "2.0",
    }


# ============================================================
# OCR
# ============================================================


# ============================================================
# ADDITIONAL INTERPRETABLE VISUAL FEATURES
# ============================================================

def _top_colour_palette(
    pixels: np.ndarray,
    max_colours: int = 5,
) -> list[dict]:
    """
    Estimate the most common colour groups in the image.

    This is an interpretable descriptor. It does not train
    a model and does not replace MobileNetV2 or CLIP.
    """

    if pixels.size == 0:
        return []

    try:
        rgb = np.asarray(
            pixels,
            dtype=np.uint8,
        ).reshape(-1, 3)

        quantized = (
            rgb.astype(np.int32) // 32
        ) * 32 + 16

        quantized = np.clip(
            quantized,
            0,
            255,
        ).astype(np.uint8)

        unique, counts = np.unique(
            quantized,
            axis=0,
            return_counts=True,
        )

        order = np.argsort(counts)[::-1]

        total = max(
            int(len(rgb)),
            1,
        )

        palette = []

        for index in order[:max_colours]:

            colour = unique[index]
            count = int(counts[index])

            rgb_float = (
                colour.astype(np.float32)
                / 255.0
            )

            hue, saturation, brightness = (
                _rgb_to_hsv(rgb_float)
            )

            palette.append(
                {
                    "rgb": [
                        int(colour[0]),
                        int(colour[1]),
                        int(colour[2]),
                    ],
                    "percentage": round(
                        (count / total) * 100.0,
                        2,
                    ),
                    "hue": round(
                        float(hue),
                        4,
                    ),
                    "saturation": round(
                        float(saturation),
                        4,
                    ),
                    "brightness": round(
                        float(brightness),
                        4,
                    ),
                }
            )

        return palette

    except Exception:
        return []


def _relative_size_descriptor(
    width: int,
    height: int,
    shape: dict,
) -> dict:
    """
    Estimate relative image occupancy.

    This is NOT a physical size measurement.
    """

    foreground_ratio = float(
        shape.get(
            "foreground_fill_ratio",
            shape.get(
                "silhouette_area_ratio",
                0.0,
            ),
        )
        or 0.0
    )

    foreground_ratio = float(
        np.clip(
            foreground_ratio,
            0.0,
            1.0,
        )
    )

    if foreground_ratio < 0.12:
        size_class = "small"
    elif foreground_ratio < 0.35:
        size_class = "medium"
    else:
        size_class = "large"

    return {
        "class": size_class,
        "foreground_area_ratio": round(
            foreground_ratio,
            4,
        ),
        "image_area": int(
            max(width * height, 1)
        ),
        "note": (
            "Relative image occupancy; "
            "not a physical measurement."
        ),
    }


def _shape_classification(
    width: int,
    height: int,
    shape: dict,
) -> dict:
    """
    Convert numerical silhouette information into
    a broad interpretable shape class.
    """

    aspect_ratio = (
        float(width)
        / float(max(height, 1))
    )

    profile_variation = float(
        shape.get(
            "profile_variation",
            0.0,
        )
        or 0.0
    )

    profile_change = float(
        shape.get(
            "profile_change",
            0.0,
        )
        or 0.0
    )

    neck_ratio = float(
        shape.get(
            "neck_to_body_ratio",
            1.0,
        )
        or 1.0
    )

    if aspect_ratio >= 1.55:
        shape_class = "wide"
    elif aspect_ratio <= 0.65:
        shape_class = "elongated"
    elif (
        profile_variation > 0.38
        or profile_change > 0.42
    ):
        shape_class = "irregular"
    elif (
        0.82 <= aspect_ratio <= 1.18
        and 0.75 <= neck_ratio <= 1.25
    ):
        shape_class = "square_or_round"
    else:
        shape_class = "rectangular"

    return {
        "class": shape_class,
        "aspect_ratio": round(
            aspect_ratio,
            4,
        ),
        "profile_variation": round(
            profile_variation,
            4,
        ),
        "profile_change": round(
            profile_change,
            4,
        ),
        "neck_to_body_ratio": round(
            neck_ratio,
            4,
        ),
    }


def _pattern_descriptor(
    regions: dict,
) -> dict:
    """
    Estimate broad surface pattern using local
    texture and edge variation.
    """

    if not regions:
        return {
            "class": "unknown",
            "score": 0.0,
        }

    edge_values = []
    texture_values = []
    brightness_values = []

    for descriptor in regions.values():

        edge_values.append(
            float(
                descriptor.get(
                    "edge_density",
                    0.0,
                )
                or 0.0
            )
        )

        texture_values.append(
            float(
                descriptor.get(
                    "texture",
                    0.0,
                )
                or 0.0
            )
        )

        brightness_values.append(
            float(
                descriptor.get(
                    "brightness",
                    0.0,
                )
                or 0.0
            )
        )

    edge_mean = float(
        np.mean(edge_values)
    )

    texture_mean = float(
        np.mean(texture_values)
    )

    edge_variation = float(
        np.std(edge_values)
    )

    brightness_variation = float(
        np.std(brightness_values)
    )

    pattern_score = float(
        np.clip(
            (
                edge_mean
                + texture_mean
                + edge_variation
                + brightness_variation
            ) / 4.0,
            0.0,
            1.0,
        )
    )

    if (
        edge_variation > 0.10
        and brightness_variation > 0.10
    ):
        pattern_class = "mixed_or_detailed"
    elif (
        edge_mean > 0.30
        and texture_mean > 0.30
    ):
        pattern_class = "textured"
    elif edge_variation > 0.07:
        pattern_class = "structured"
    elif texture_mean < 0.15:
        pattern_class = "plain"
    else:
        pattern_class = "subtle_texture"

    return {
        "class": pattern_class,
        "score": round(
            pattern_score,
            4,
        ),
        "edge_mean": round(
            edge_mean,
            4,
        ),
        "texture_mean": round(
            texture_mean,
            4,
        ),
        "edge_variation": round(
            edge_variation,
            4,
        ),
        "brightness_variation": round(
            brightness_variation,
            4,
        ),
    }


def _extract_ocr(
    image: Image.Image,
) -> dict:

    try:
        import pytesseract
    except Exception:
        return {
            "available": False,
            "text": "",
            "tokens": [],
            "boxes": [],
            "confidence": 0.0,
            "brand_candidates": [],
            "reason": "pytesseract not installed",
        }

    try:
        # ----------------------------------------------------
        # Prefer structured OCR data so that we retain:
        # text, confidence and approximate text locations.
        # ----------------------------------------------------
        boxes = []
        text_parts = []
        confidence_values = []

        try:
            data = pytesseract.image_to_data(
                image,
                output_type=pytesseract.Output.DICT,
                config="--psm 6",
            )

            count = len(data.get("text", []))

            for index in range(count):
                raw_text = str(
                    data["text"][index]
                ).strip()

                if not raw_text:
                    continue

                try:
                    confidence = float(
                        data["conf"][index]
                    )
                except Exception:
                    confidence = -1.0

                left = int(data["left"][index])
                top = int(data["top"][index])
                box_width = int(data["width"][index])
                box_height = int(data["height"][index])

                if confidence >= 0:
                    confidence_values.append(
                        confidence
                    )

                text_parts.append(raw_text)

                boxes.append(
                    {
                        "text": raw_text,
                        "confidence": round(
                            max(0.0, confidence),
                            2,
                        ),
                        "left": left,
                        "top": top,
                        "width": box_width,
                        "height": box_height,
                    }
                )

        except Exception:
            # Fallback to simple OCR if image_to_data()
            # is unavailable in the installed Tesseract build.
            fallback_text = pytesseract.image_to_string(
                image
            ).strip()

            text_parts = [
                token
                for token in fallback_text.split()
                if token.strip()
            ]

        text = " ".join(
            text_parts
        ).strip()

        tokens = [
            token.lower()
            for token in text.split()
            if token.strip()
        ]

        # ----------------------------------------------------
        # Basic known-brand detection from visible text.
        # This is evidence extraction, not model training.
        # ----------------------------------------------------
        known_brands = [
            "nike",
            "adidas",
            "puma",
            "reebok",
            "fossil",
            "casio",
            "curren",
            "rolex",
            "titan",
            "samsung",
            "apple",
            "oneplus",
            "oppo",
            "vivo",
            "realme",
            "dell",
            "hp",
            "lenovo",
            "asus",
            "acer",
            "canon",
            "nikon",
            "sony",
            "jbl",
            "boat",
            "wildcraft",
            "skybags",
            "american tourister",
            "classmate",
            "octane",
            "samsonite",
            "studds",
        ]

        normalized_text = text.lower()

        brand_candidates = [
            brand
            for brand in known_brands
            if brand in normalized_text
        ]

        average_confidence = (
            sum(confidence_values)
            / len(confidence_values)
            if confidence_values
            else 0.0
        )

        return {
            "available": True,
            "text": text,
            "tokens": tokens,
            "boxes": boxes,
            "confidence": round(
                average_confidence,
                2,
            ),
            "brand_candidates": brand_candidates,
        }

    except Exception as exc:
        return {
            "available": False,
            "text": "",
            "tokens": [],
            "boxes": [],
            "confidence": 0.0,
            "brand_candidates": [],
            "reason": str(exc),
        }



def _extract_image_attributes(
    ocr: dict,
    dominant: str,
    shape: dict,
    shape_classification: dict,
    relative_size: dict,
    color: dict,
) -> dict:
    """
    Build clean, confidence-aware image attributes.

    OCR remains optional evidence. Low-confidence OCR noise is
    excluded from product/brand matching.
    """

    ocr = (
        ocr
        if isinstance(ocr, dict)
        else {}
    )

    raw_boxes = (
        ocr.get("boxes") or []
    )

    # --------------------------------------------------------
    # OCR CONFIDENCE FILTERING
    # --------------------------------------------------------

    clean_tokens = []
    token_confidences = []

    for box in raw_boxes:

        if not isinstance(
            box,
            dict,
        ):
            continue

        raw_text = str(
            box.get("text") or ""
        ).strip()

        if not raw_text:
            continue

        try:
            confidence = float(
                box.get(
                    "confidence",
                    0,
                )
            )
        except Exception:
            confidence = 0.0

        token = raw_text.lower().strip()

        # Remove common OCR punctuation/noise.
        token = token.strip(
            ".,:;!?()[]{}<>\"'`"
        )

        if not token:
            continue

        # Reject extremely weak OCR.
        if confidence < 55:
            continue

        # Reject tokens made mostly from symbols.
        alphanumeric_count = sum(
            1
            for char in token
            if char.isalnum()
        )

        if alphanumeric_count < 2:
            continue

        # Reject obvious OCR garbage.
        if len(token) > 40:
            continue

        if token not in clean_tokens:
            clean_tokens.append(
                token
            )
            token_confidences.append(
                confidence
            )

    # --------------------------------------------------------
    # FALLBACK TO OCR TOKENS ONLY WHEN BOXES ARE UNAVAILABLE
    # --------------------------------------------------------

    if not raw_boxes:

        for raw_token in (
            ocr.get("tokens") or []
        ):

            token = str(
                raw_token
            ).strip().lower()

            token = token.strip(
                ".,:;!?()[]{}<>\"'`"
            )

            if not token:
                continue

            if len(token) < 2:
                continue

            alphanumeric_count = sum(
                1
                for char in token
                if char.isalnum()
            )

            if alphanumeric_count < 2:
                continue

            if token not in clean_tokens:
                clean_tokens.append(
                    token
                )
                token_confidences.append(
                    100.0
                )

    # --------------------------------------------------------
    # BRAND CANDIDATES
    # --------------------------------------------------------

    existing_brands = [
        str(brand)
        .strip()
        .lower()
        for brand in (
            ocr.get(
                "brand_candidates"
            ) or []
        )
        if str(brand).strip()
    ]

    brand_candidates = []

    for brand in existing_brands:

        if brand in clean_tokens:
            if brand not in brand_candidates:
                brand_candidates.append(
                    brand
                )

    # --------------------------------------------------------
    # PRODUCT/TEXT CANDIDATES
    # --------------------------------------------------------

    stop_words = {
        "the",
        "and",
        "with",
        "for",
        "new",
        "item",
        "made",
        "from",
        "this",
        "that",
        "you",
        "your",
        "are",
        "was",
        "has",
        "have",
        "not",
        "into",
        "its",
        "our",
        "use",
        "used",
        "model",
        "product",
    }

    product_candidates = []

    for token in clean_tokens:

        if token in stop_words:
            continue

        if token in brand_candidates:
            continue

        # Pure numbers are generally weak for identity.
        if token.isdigit():
            continue

        if token in product_candidates:
            continue

        product_candidates.append(
            token
        )

    # --------------------------------------------------------
    # CLEAN VISIBLE TEXT
    # --------------------------------------------------------

    visible_text = " ".join(
        clean_tokens
    ).strip()

    # Existing OCR confidence remains useful.
    try:
        overall_ocr_confidence = float(
            ocr.get(
                "confidence",
                0,
            )
        )
    except Exception:
        overall_ocr_confidence = 0.0

    color_info = (
        color
        if isinstance(
            color,
            dict,
        )
        else {}
    )

    shape_info = (
        shape
        if isinstance(
            shape,
            dict,
        )
        else {}
    )

    shape_class_info = (
        shape_classification
        if isinstance(
            shape_classification,
            dict,
        )
        else {}
    )

    size_info = (
        relative_size
        if isinstance(
            relative_size,
            dict,
        )
        else {}
    )

    # --------------------------------------------------------
    # IMAGE IDENTITY EVIDENCE
    # --------------------------------------------------------

    text_evidence_available = bool(
        clean_tokens
        and overall_ocr_confidence >= 55
    )

    brand_evidence_available = bool(
        brand_candidates
    )

    product_text_evidence_available = bool(
        product_candidates
        and overall_ocr_confidence >= 55
    )

    return {
        "visible_text": visible_text,

        "raw_ocr_text": str(
            ocr.get(
                "text",
                "",
            ) or ""
        ).strip(),

        "ocr_tokens": clean_tokens,

        "ocr_token_confidences": [
            round(
                float(confidence),
                2,
            )
            for confidence in token_confidences
        ],

        "ocr_confidence": round(
            overall_ocr_confidence,
            2,
        ),

        "brand_candidates": brand_candidates,

        "product_candidates": product_candidates,

        "dominant_color": dominant,

        "color": {
            "mean_rgb":
                color_info.get(
                    "mean_rgb"
                ),
            "hue":
                color_info.get(
                    "hue"
                ),
            "saturation":
                color_info.get(
                    "saturation"
                ),
            "brightness":
                color_info.get(
                    "brightness"
                ),
        },

        "shape": shape_info,

        "shape_classification":
            shape_class_info,

        "relative_size":
            size_info,

        "evidence": {
            "text":
                text_evidence_available,

            "brand":
                brand_evidence_available,

            "product_text":
                product_text_evidence_available,

            "color": bool(
                color_info
            ),

            "shape": bool(
                shape_info
            ),
        },

        "source": {
            "ocr":
                bool(
                    ocr.get(
                        "available"
                    )
                ),

            "shape":
                bool(
                    shape_info
                ),

            "color":
                bool(
                    color_info
                ),
        },

        "version": "1.1",
    }
def extract_visual_details(
    image_bytes: bytes,
) -> dict:

    if not image_bytes:
        return {
            "available": False,
            "version": "2.0",
            "reason": "empty image",
        }

    try:
        image = (
            Image.open(
                BytesIO(
                    image_bytes
                )
            )
            .convert("RGB")
        )
    except Exception as exc:
        return {
            "available": False,
            "version": "2.0",
            "reason": str(exc),
        }

    # Keep computation bounded for large uploads.
    image.thumbnail(
        (640, 640),
        Image.Resampling.LANCZOS,
    )

    rgb = np.asarray(
        image,
        dtype=np.uint8,
    )

    height, width = rgb.shape[:2]
    gray = np.asarray(image.convert("L"), dtype=np.uint8)
    scratch_screening = _scratch_like_screening(gray)

    # Estimate the primary colour of the foreground object separately from
    # the whole photo. Whole-image colour is often dominated by the background
    # and can hide a black-vs-white item contradiction. This is a heuristic
    # silhouette mask, so its confidence is intentionally capped and surfaced.
    foreground_mask = _foreground_mask(rgb, gray)
    foreground_mask = _clean_shape_mask(foreground_mask)
    foreground_pixels = rgb[foreground_mask]
    foreground_ratio = float(foreground_mask.mean()) if foreground_mask.size else 0.0
    foreground_colour = _dominant_colour(foreground_pixels)
    foreground_colour_name = str(foreground_colour.get("name") or "unknown").lower()
    foreground_colour_confidence = 0.0
    if foreground_pixels.size and 0.025 <= foreground_ratio <= 0.90:
        # A confidence heuristic, not a calibrated model probability.
        foreground_colour_confidence = 0.70
        if foreground_colour.get("percentage", 0.0) >= 35:
            foreground_colour_confidence = 0.78
        if foreground_ratio > 0.82:
            foreground_colour_confidence = 0.55
    if foreground_colour_name in {"unknown", "cyan"}:
        foreground_colour_confidence = min(foreground_colour_confidence, 0.45)
    foreground_colour_evidence = {
        "available": bool(foreground_pixels.size),
        "label": foreground_colour_name if foreground_pixels.size else "unknown",
        "rgb": foreground_colour.get("rgb", [0, 0, 0]),
        "dominant_percentage": round(float(foreground_colour.get("percentage", 0.0)), 2),
        "foreground_area_ratio": round(foreground_ratio, 4),
        "confidence": round(foreground_colour_confidence, 2),
        "method": "foreground-mask dominant RGB colour heuristic; not a calibrated probability",
    }

    pixels = rgb.reshape(
        -1,
        3,
    )

    mean_rgb = np.mean(
        pixels,
        axis=0,
    )

    dominant = _dominant_colour(
        pixels
    )

    overall_hue, overall_saturation, overall_brightness = (
        _rgb_to_hsv(
            mean_rgb / 255.0
        )
    )

    # --------------------------------------------------------
    # 3 x 3 LOCAL REGIONS
    # --------------------------------------------------------

    region_names = [
        [
            "upper-left",
            "upper-center",
            "upper-right",
        ],
        [
            "middle-left",
            "center",
            "middle-right",
        ],
        [
            "lower-left",
            "lower-center",
            "lower-right",
        ],
    ]

    regions = {}

    for row in range(3):

        y0 = int(
            round(
                row
                *
                height
                /
                3
            )
        )

        y1 = int(
            round(
                (row + 1)
                *
                height
                /
                3
            )
        )

        for col in range(3):

            x0 = int(
                round(
                    col
                    *
                    width
                    /
                    3
                )
            )

            x1 = int(
                round(
                    (col + 1)
                    *
                    width
                    /
                    3
                )
            )

            region = rgb[
                y0:y1,
                x0:x1
            ]

            descriptor = _region_descriptor(
                region
            )

            descriptor["bbox"] = {
                "left": round(
                    x0 / max(width, 1),
                    4,
                ),
                "top": round(
                    y0 / max(height, 1),
                    4,
                ),
                "right": round(
                    x1 / max(width, 1),
                    4,
                ),
                "bottom": round(
                    y1 / max(height, 1),
                    4,
                ),
            }

            regions[
                region_names[row][col]
            ] = descriptor

    # --------------------------------------------------------
    # HIGH DETAIL REGIONS
    # --------------------------------------------------------

    ranked_regions = sorted(
        regions.items(),
        key=lambda pair: (
            pair[1].get(
                "edge_density",
                0.0
            )
            +
            pair[1].get(
                "texture",
                0.0
            )
        ),
        reverse=True,
    )

    high_detail_regions = [
        {
            "region": name,
            "detail_score": round(
                (
                    descriptor.get(
                        "edge_density",
                        0.0
                    )
                    +
                    descriptor.get(
                        "texture",
                        0.0
                    )
                )
                / 2.0,
                4,
            ),
        }
        for name, descriptor
        in ranked_regions[:3]
    ]

    # --------------------------------------------------------
    # OCR
    # --------------------------------------------------------

    ocr = _extract_ocr(
        image
    )


    # --------------------------------------------------------
    # ADDITIONAL INTERPRETABLE VISUAL FEATURES
    # --------------------------------------------------------

    shape_descriptor = _shape_descriptor(
        rgb
    )

    shape_classification = _shape_classification(
        width,
        height,
        shape_descriptor,
    )

    relative_size = _relative_size_descriptor(
        width,
        height,
        shape_descriptor,
    )

    color_palette = _top_colour_palette(
        pixels,
        max_colours=5,
    )

    pattern = _pattern_descriptor(
        regions,
    )

    visible_text = {
        "available": bool(
            ocr.get(
                "available",
                False,
            )
        ),
        "text": ocr.get(
            "text",
            "",
        ),
        "confidence": ocr.get(
            "confidence",
            0.0,
        ),
        "tokens": ocr.get(
            "tokens",
            [],
        ),
    }

    brand_candidates = ocr.get(
        "brand_candidates",
        [],
    )

    # --------------------------------------------------------

    # --------------------------------------------------------
    # STRUCTURED IMAGE ATTRIBUTES
    # --------------------------------------------------------

    image_attributes = _extract_image_attributes(
        ocr=ocr,
        dominant=dominant,
        shape=_shape_descriptor(rgb),
        shape_classification=shape_classification,
        relative_size=relative_size,
        color={
            "mean_rgb": [
                round(
                    float(value),
                    2,
                )
                for value in mean_rgb
            ],
            "hue": round(
                float(overall_hue),
                4,
            ),
            "saturation": round(
                float(overall_saturation),
                4,
            ),
            "brightness": round(
                float(overall_brightness),
                4,
            ),
        },
    )
    # FINAL RESULT
    # --------------------------------------------------------

    return {
        "available": True,

        "version": "2.0",

        "image": {
            "width": int(width),
            "height": int(height),
            "aspect_ratio": round(
                float(width)
                /
                float(
                    max(height, 1)
                ),
                4,
            ),
        },

        "foreground_color": foreground_colour_evidence,

        "color": {
            "mean_rgb": [
                round(
                    float(v),
                    2,
                )
                for v in mean_rgb
            ],

            "dominant":
                dominant,

            "hue": round(
                overall_hue,
                4,
            ),

            "saturation": round(
                overall_saturation,
                4,
            ),

            "brightness": round(
                overall_brightness,
                4,
            ),
        },

        "shape":
            _shape_descriptor(
                rgb
            ),

        "regions":
            regions,

        "high_detail_regions":
            high_detail_regions,

        "scratchScreening": scratch_screening,

        "ocr":
            ocr,




        "image_attributes":

            image_attributes,
        "shape_classification":
            shape_classification,

        "relative_size":
            relative_size,

        "color_palette":
            color_palette,

        "pattern":
            pattern,

        "visible_text":
            visible_text,

        "brand_candidates":
            brand_candidates,

        "notes": [
            "Object-agnostic visual descriptors.",
            "foreground_color is a confidence-capped heuristic estimate and can be affected by segmentation, lighting and background.",
            "3x3 regions capture local colour, texture and edge differences.",
            "scratchScreening is a low-confidence heuristic for scratch-like line marks, not a trained damage detector.",
            "Shape fields are image-based proxies, not physical measurements.",
            "Silhouette profile compares neck, shoulder and body width across the object height.",
            "OCR is optional and depends on local OCR availability.",
            "image_attributes combines OCR, brand, product-text, colour and shape evidence.",
        ],
    }
