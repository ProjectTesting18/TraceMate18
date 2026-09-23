from fastapi import FastAPI, File, UploadFile, HTTPException
from pydantic import BaseModel

from services.cnn_service import (
    compare_images,
    image_to_embedding,
    get_visual_model_status,
)

from services.nlp_service import compare_texts


app = FastAPI(
    title="TraceMate AI Service",
    version="1.1.0",
    description=(
        "TraceMate NLP and computer-vision service "
        "with MobileNetV2 and CLIP."
    ),
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

        "status": "running",

        "features": [
            "NLP text similarity",
            "MobileNetV2 image embeddings",
            "CLIP image embeddings",
            "Hybrid visual similarity",
        ],

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