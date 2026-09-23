const AI_SERVICE_URL =
  process.env.AI_SERVICE_URL || 'http://127.0.0.1:8001';


/**
 * Send a base64 image to FastAPI and receive
 * MobileNetV2 + CLIP embeddings.
 */
async function requestEmbeddingFromDataUrl(dataUrl) {
  if (
    !dataUrl ||
    typeof dataUrl !== 'string' ||
    !dataUrl.startsWith('data:image/')
  ) {
    throw new Error('Valid image data URL is required');
  }

  const match = dataUrl.match(
    /^data:(image\/(?:jpeg|jpg|png|webp));base64,(.+)$/i
  );

  if (!match) {
    throw new Error(
      'Only JPG, PNG and WEBP data URLs are supported'
    );
  }

  const contentType =
    match[1].toLowerCase() === 'image/jpg'
      ? 'image/jpeg'
      : match[1].toLowerCase();

  const buffer = Buffer.from(match[2], 'base64');

  const form = new FormData();

  form.append(
    'image',
    new Blob([buffer], {
      type: contentType
    }),
    'tracemate-image'
  );

  const response = await fetch(
    `${AI_SERVICE_URL}/cv/image-embedding`,
    {
      method: 'POST',
      body: form
    }
  );

  if (!response.ok) {
    const errorText = await response
      .text()
      .catch(() => '');

    throw new Error(
      `AI service request failed: ${response.status} ${errorText}`
    );
  }

  const result = await response.json();

  return {
    ...result,

    // -------------------------
    // MobileNetV2
    // -------------------------

    embedding: Array.isArray(result.embedding)
      ? result.embedding
      : [],

    embeddingDimension:
      result.embedding_dimension ||
      result.embeddingDimension ||
      0,

    model:
      result.model ||
      result.embedding_model ||
      'MobileNetV2',

    // -------------------------
    // CLIP
    // -------------------------

    clipEmbedding: Array.isArray(
      result.clip_embedding
    )
      ? result.clip_embedding
      : Array.isArray(result.clipEmbedding)
        ? result.clipEmbedding
        : [],

    clipEmbeddingDimension:
      result.clip_embedding_dimension ||
      result.clipEmbeddingDimension ||
      0,

    clipEmbeddingModel:
      result.clip_model ||
      result.clip_embedding_model ||
      result.clipEmbeddingModel ||
      'CLIP',

    // -------------------------
    // Visual model information
    // -------------------------

    visualModels:
      result.visual_models ||
      result.visualModels ||
      [],

    visualMethod:
      result.visual_method ||
      result.visualMethod ||
      null,

    clipAvailable:
      result.clip_available ??
      result.clipAvailable ??
      false
  };
}


/**
 * Calculate cosine similarity.
 */
function cosineSimilarity(a, b) {
  if (
    !Array.isArray(a) ||
    !Array.isArray(b) ||
    a.length !== b.length ||
    a.length === 0
  ) {
    return null;
  }

  let dot = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (let i = 0; i < a.length; i++) {
    const valueA = Number(a[i]);
    const valueB = Number(b[i]);

    if (
      !Number.isFinite(valueA) ||
      !Number.isFinite(valueB)
    ) {
      return null;
    }

    dot += valueA * valueB;
    magnitudeA += valueA * valueA;
    magnitudeB += valueB * valueB;
  }

  if (
    magnitudeA <= 0 ||
    magnitudeB <= 0
  ) {
    return null;
  }

  const cosine =
    dot /
    (
      Math.sqrt(magnitudeA) *
      Math.sqrt(magnitudeB)
    );

  return Math.max(
    -1,
    Math.min(1, cosine)
  );
}


/**
 * Convert cosine similarity [-1, 1]
 * into percentage [0, 100].
 */
function similarityPercentage(cosine) {
  if (
    cosine === null ||
    cosine === undefined ||
    !Number.isFinite(Number(cosine))
  ) {
    return null;
  }

  return (
    (Number(cosine) + 1) / 2
  ) * 100;
}


/**
 * MobileNetV2 similarity.
 */
function calculateMobileNetSimilarity(
  lost,
  found
) {
  if (
    !lost ||
    !found ||
    !Array.isArray(lost.imageEmbedding) ||
    !Array.isArray(found.imageEmbedding)
  ) {
    return {
      cosine: null,
      percentage: null
    };
  }

  const cosine = cosineSimilarity(
    lost.imageEmbedding,
    found.imageEmbedding
  );

  return {
    cosine,
    percentage:
      similarityPercentage(cosine)
  };
}


/**
 * CLIP similarity.
 */
function calculateClipSimilarity(
  lost,
  found
) {
  if (
    !lost ||
    !found ||
    !Array.isArray(lost.clipEmbedding) ||
    !Array.isArray(found.clipEmbedding)
  ) {
    return {
      cosine: null,
      percentage: null
    };
  }

  const cosine = cosineSimilarity(
    lost.clipEmbedding,
    found.clipEmbedding
  );

  return {
    cosine,
    percentage:
      similarityPercentage(cosine)
  };
}


/**
 * Hybrid visual similarity.
 *
 * MobileNetV2 = 40%
 * CLIP        = 60%
 */
function calculateHybridVisualSimilarity(
  lost,
  found,
  mobileNetWeight = 0.4,
  clipWeight = 0.6
) {
  const mobileNet =
    calculateMobileNetSimilarity(
      lost,
      found
    );

  const clip =
    calculateClipSimilarity(
      lost,
      found
    );

  const hasMobileNet =
    mobileNet.percentage !== null;

  const hasClip =
    clip.percentage !== null;

  if (
    !hasMobileNet &&
    !hasClip
  ) {
    return {
      cosine: null,
      percentage: null,
      mobileNetPercentage: null,
      clipPercentage: null,
      mobileNetWeight,
      clipWeight,
      model: 'none'
    };
  }

  // Both available
  if (
    hasMobileNet &&
    hasClip
  ) {
    const percentage =
      mobileNet.percentage *
        mobileNetWeight +
      clip.percentage *
        clipWeight;

    return {
      cosine: null,
      percentage,

      mobileNetPercentage:
        mobileNet.percentage,

      clipPercentage:
        clip.percentage,

      mobileNetWeight,
      clipWeight,

      model:
        'MobileNetV2 + CLIP'
    };
  }

  // Only MobileNetV2
  if (hasMobileNet) {
    return {
      cosine:
        mobileNet.cosine,

      percentage:
        mobileNet.percentage,

      mobileNetPercentage:
        mobileNet.percentage,

      clipPercentage: null,

      mobileNetWeight: 1,
      clipWeight: 0,

      model:
        'MobileNetV2'
    };
  }

  // Only CLIP
  return {
    cosine:
      clip.cosine,

    percentage:
      clip.percentage,

    mobileNetPercentage: null,

    clipPercentage:
      clip.percentage,

    mobileNetWeight: 0,
    clipWeight: 1,

    model:
      'CLIP'
  };
}


module.exports = {
  requestEmbeddingFromDataUrl,

  cosineSimilarity,
  similarityPercentage,

  calculateMobileNetSimilarity,
  calculateClipSimilarity,
  calculateHybridVisualSimilarity
};