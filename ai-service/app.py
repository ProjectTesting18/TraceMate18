from contextlib import asynccontextmanager
from services.lostnet_classifier import (
    classify_image,
    get_lostnet_status,
    start_lostnet_warmup,
)

from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from pydantic import BaseModel

from services.cnn_service import (
    compare_images,
    compare_image_text,
    image_to_embedding,
    get_visual_model_status,
    start_visual_model_warmup,
)

from services.nlp_service import (
    compare_texts,
    get_nlp_status,
    start_nlp_model_warmup,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Kick off model downloads/initialization as soon as the AI service starts.
    # Keep startup responsive; /health reports whether each model is loading,
    # ready, or unavailable while the lightweight fallback remains usable.
    print(
        "[TraceMate AI] Starting automatic warm-up for SBERT, MobileNetV2, and CLIP.",
        flush=True,
    )
    start_nlp_model_warmup()
    start_visual_model_warmup()
    start_lostnet_warmup()
    start_lostnet_warmup()
    yield


app = FastAPI(
    title="TraceMate AI Service",
    version="1.2.0",
    description=(
        "TraceMate NLP and computer-vision service "
        "with automatic SBERT, MobileNetV2, and CLIP warm-up."
    ),
    lifespan=lifespan,
)


# ============================================================
# REQUEST MODELS
# ============================================================

class TextSimilarityRequest(BaseModel):
    text1: str
    text2: str


# ============================================================
# HEALTH
# ============================================================

@app.get("/health")
def health():

    visual_status = get_visual_model_status()

    return {
        "success": True,

        "service": "TraceMate AI",

        "version": "1.2.0",

        "status": "running",

        "features": [
            "NLP text similarity",
            "SBERT semantic similarity with TF-IDF fallback",
            "MobileNetV2 image embeddings",
            "CLIP image embeddings",
            "Hybrid visual similarity",
            "LostNet trained object classifier",
        ],

        "lostnet": get_lostnet_status(),

        "nlp": get_nlp_status(),

        "cnn": {
            "model": (
                visual_status[
                    "mobilenet_v2"
                ][
                    "model"
                ]
            ),

            "available": (
                visual_status[
                    "mobilenet_v2"
                ][
                    "available"
                ]
            ),
            "initialized": visual_status["mobilenet_v2"]["initialized"],
            "loading": visual_status["mobilenet_v2"]["loading"],
            "error": visual_status["mobilenet_v2"]["error"],
        },

        "clip": (
            visual_status[
                "clip"
            ]
        ),

        "hybrid_visual": (
            visual_status[
                "hybrid"
            ]
        ),
    }


# ============================================================
# NLP TEXT SIMILARITY
# ============================================================

@app.post("/nlp/text-similarity")
def text_similarity(
    payload: TextSimilarityRequest,
):

    text1 = (
        payload.text1 or ""
    ).strip()

    text2 = (
        payload.text2 or ""
    ).strip()

    if not text1 or not text2:

        raise HTTPException(
            status_code=400,
            detail=(
                "Both text1 and text2 "
                "are required."
            ),
        )

    try:

        result = compare_texts(
            text1,
            text2,
        )

        return {
            "success": True,
            **result,
        }

    except Exception as exc:

        raise HTTPException(
            status_code=422,
            detail=(
                "Could not compare text: "
                f"{exc}"
            ),
        )


# ============================================================
# IMAGE EMBEDDING
# ============================================================

@app.post("/cv/image-embedding")
async def image_embedding(
    image: UploadFile = File(...),
):

    allowed = {
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/webp",
        "image/avif",
    }

    if image.content_type not in allowed:

        raise HTTPException(
            status_code=400,
            detail=(
                "Only JPG, PNG, and WEBP "
                "images are supported."
            ),
        )

    data = await image.read()

    if not data:

        raise HTTPException(
            status_code=400,
            detail="Image is empty.",
        )

    try:

        result = image_to_embedding(
            data
        )

        return {
            "success": True,
            **result,
        }

    except Exception as exc:

        raise HTTPException(
            status_code=422,
            detail=(
                "Could not process image: "
                f"{exc}"
            ),
        )



# ============================================================
# CROSS-MODAL IMAGE + TEXT SIMILARITY
# ============================================================

@app.post("/cv/image-text-similarity")
async def image_text_similarity(
    image: UploadFile = File(...),
    text: str = Form(...),
):
    """Compare a report description against an image using CLIP."""
    allowed = {"image/jpeg", "image/jpg", "image/png", "image/webp",
        "image/avif"}
    if image.content_type not in allowed:
        raise HTTPException(
            status_code=400,
            detail="Only JPG, PNG, and WEBP images are supported.",
        )

    image_bytes = await image.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Image is empty.")
    if not text or not text.strip():
        raise HTTPException(status_code=400, detail="Text is required.")

    try:
        return {"success": True, **compare_image_text(image_bytes, text)}
    except Exception as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Could not compare image and text: {exc}",
        )


# ============================================================
# IMAGE SIMILARITY
# ============================================================

@app.post("/cv/image-similarity")
async def image_similarity(
    image1: UploadFile = File(...),
    image2: UploadFile = File(...),
):

    allowed = {
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/webp",
        "image/avif",
    }

    for upload in (
        image1,
        image2,
    ):

        if upload.content_type not in allowed:

            raise HTTPException(
                status_code=400,
                detail=(
                    "Unsupported image type: "
                    f"{upload.content_type}."
                ),
            )

    data1 = await image1.read()
    data2 = await image2.read()

    if not data1 or not data2:

        raise HTTPException(
            status_code=400,
            detail=(
                "Both images are required."
            ),
        )

    try:

        result = compare_images(
            data1,
            data2,
        )

        return {
            "success": True,
            **result,
        }

    except Exception as exc:

        raise HTTPException(
            status_code=422,
            detail=(
                "Could not compare images: "
                f"{exc}"
            ),
        )


# ============================================================
# VISUAL MODEL HEALTH
# ============================================================

@app.get("/cv/health")
def cv_health():

    status = get_visual_model_status()

    return {
        "success": True,

        "service": "TraceMate Computer Vision",

        "status": "running",

        "models": status,
    }
# ============================================================
# LOSTNET OBJECT CLASSIFICATION
# ============================================================

@app.post("/cv/classify")
async def classify_lostnet_image(
    image: UploadFile = File(...),
):
    allowed = {
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/webp",
        "image/avif",
    }

    if image.content_type not in allowed:
        raise HTTPException(
            status_code=400,
            detail="Only JPG, PNG, WEBP, and AVIF images are supported.",
        )

    image_bytes = await image.read()

    if not image_bytes:
        raise HTTPException(
            status_code=400,
            detail="Image is empty.",
        )

    try:
        return {
            "success": True,
            **classify_image(image_bytes),
        }
    except Exception as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Could not classify image: {exc}",
        )

# ============================================================
# START SERVER
# ============================================================

if __name__ == "__main__":

    import uvicorn

    uvicorn.run(
        "app:app",
        host="127.0.0.1",
        port=8001,
        reload=False,
    )