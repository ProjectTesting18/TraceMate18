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
from typing import Any

import numpy as np
from PIL import Image, ImageFilter


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
            "reason": "pytesseract not installed",
        }

    try:
        text = pytesseract.image_to_string(
            image
        ).strip()

        tokens = [
            token.lower()
            for token in text.split()
            if token.strip()
        ]

        return {
            "available": True,
            "text": text,
            "tokens": tokens,
        }

    except Exception as exc:
        return {
            "available": False,
            "text": "",
            "tokens": [],
            "reason": str(exc),
        }


# ============================================================
# MAIN EXTRACTOR
# ============================================================

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

        "ocr":
            ocr,

        "notes": [
            "Object-agnostic visual descriptors.",
            "3x3 regions capture local colour, texture and edge differences.",
            "Shape fields are image-based proxies, not physical measurements.",
            "Silhouette profile compares neck, shoulder and body width across the object height.",
            "OCR is optional and depends on local OCR availability.",
        ],
    }
