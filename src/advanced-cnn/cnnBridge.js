
'use strict';

const AI_SERVICE_URL =
  process.env.AI_SERVICE_URL || 'http://127.0.0.1:8001';

/**
 * Convert a supported image data URL into multipart form data.
 */
function createImageForm(dataUrl, filename = 'tracemate-image') {
  if (
    !dataUrl ||
    typeof dataUrl !== 'string' ||
    !dataUrl.startsWith('data:image/')
  ) {
    throw new Error('Valid image data URL is required');
  }

  const match = dataUrl.match(
    /^data:(image\/(?:jpeg|jpg|png|webp|avif));base64,(.+)$/i
  );

  if (!match) {
    throw new Error(
      'Only JPG, PNG, WEBP and AVIF data URLs are supported'
    );
  }

  const contentType =
    match[1].toLowerCase() === 'image/jpg'
      ? 'image/jpeg'
      : match[1].toLowerCase();

  const buffer = Buffer.from(match[2], 'base64');

  if (buffer.length === 0) {
    throw new Error('Image data is empty');
  }

  const form = new FormData();

  form.append(
    'image',
    new Blob([buffer], { type: contentType }),
    filename
  );

  return form;
}

/**
 * Make a request to the AI service with a timeout.
 */
async function postImageForm(endpoint, form, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${AI_SERVICE_URL}${endpoint}`, {
      method: 'POST',
      body: form,
      signal: controller.signal
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      const detail =
        result.detail ||
        result.error ||
        `AI service returned HTTP ${response.status}`;

      throw new Error(
        typeof detail === 'string'
          ? detail
          : JSON.stringify(detail)
      );
    }

    return result;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(
        `AI request to ${endpoint} timed out after ${timeoutMs} ms`
      );
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Request MobileNet/CLIP embeddings and existing visual recognition.
 * Existing response fields are preserved.
 */
async function requestEmbeddingFromDataUrl(dataUrl) {
  const form = createImageForm(dataUrl);

  const result = await postImageForm(
    '/cv/image-embedding',
    form,
    30000
  );

  return {
    ...result,

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

    clipEmbedding: Array.isArray(result.clip_embedding)
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
      false,

    visualRecognition:
      result.visual_recognition ||
      result.visualRecognition ||
      null,

    visualDetails:
      result.visual_details ||
      result.visualDetails ||
      null
  };
}

/**
 * NEW: Classify an image using the LostNet model.
 *
 * Calls the existing FastAPI endpoint:
 * POST /cv/classify
 *
 * This function returns the prediction. It does not independently
 * modify database records or matching scores.
 */
async function requestLostNetClassificationFromDataUrl(
  dataUrl,
  timeoutMs =
    Number(process.env.LOSTNET_TIMEOUT_MS) || 30000
) {
  const form = createImageForm(
    dataUrl,
    'tracemate-lostnet-image'
  );

  const result = await postImageForm(
    '/cv/classify',
    form,
    timeoutMs
  );

  const predictedClass =
    result.predicted_class ||
    result.predictedClass ||
    result.class_name ||
    null;

  if (result.success === false || !predictedClass) {
    throw new Error(
      'LostNet response did not contain a predicted class'
    );
  }

  const rawConfidence = Number(result.confidence);

  const rawConfidencePercent = Number(
    result.confidence_percent
  );

  const confidence = Number.isFinite(rawConfidence)
    ? Math.max(0, Math.min(1, rawConfidence))
    : Number.isFinite(rawConfidencePercent)
      ? Math.max(0, Math.min(1, rawConfidencePercent / 100))
      : null;

  const confidencePercent = Number.isFinite(rawConfidencePercent)
    ? Math.max(0, Math.min(100, rawConfidencePercent))
    : confidence === null
      ? null
      : confidence * 100;

  return {
    ...result,
    model: result.model || 'LostNet',
    predicted_class: String(predictedClass),
    confidence,
    confidence_percent: confidencePercent
  };
}

/**
 * Calculate cosine similarity between two embedding vectors.
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

  for (let i = 0; i < a.length; i += 1) {
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

  if (magnitudeA <= 0 || magnitudeB <= 0) {
    return null;
  }

  const cosine =
    dot /
    (Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB));

  return Math.max(-1, Math.min(1, cosine));
}

/**
 * Convert cosine similarity into a 0–100 percentage.
 */
function similarityPercentage(cosine) {
  if (
    cosine === null ||
    cosine === undefined ||
    !Number.isFinite(Number(cosine))
  ) {
    return null;
  }

  return ((Number(cosine) + 1) / 2) * 100;
}

function calculateMobileNetSimilarity(lost, found) {
  const cosine = cosineSimilarity(
    lost?.imageEmbedding,
    found?.imageEmbedding
  );

  return {
    cosine,
    percentage: similarityPercentage(cosine)
  };
}

function calculateClipSimilarity(lost, found) {
  const cosine = cosineSimilarity(
    lost?.clipEmbedding,
    found?.clipEmbedding
  );

  return {
    cosine,
    percentage: similarityPercentage(cosine)
  };
}

/**
 * Combine the existing MobileNet and CLIP similarity scores.
 */
function calculateHybridVisualSimilarity(
  lost,
  found,
  mobileNetWeight = 0.4,
  clipWeight = 0.6
) {
  const mobileNet = calculateMobileNetSimilarity(lost, found);
  const clip = calculateClipSimilarity(lost, found);

  const hasMobileNet = mobileNet.percentage !== null;
  const hasClip = clip.percentage !== null;

  if (!hasMobileNet && !hasClip) {
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

  if (hasMobileNet && hasClip) {
    return {
      cosine: null,
      percentage:
        mobileNet.percentage * mobileNetWeight +
        clip.percentage * clipWeight,
      mobileNetPercentage: mobileNet.percentage,
      clipPercentage: clip.percentage,
      mobileNetWeight,
      clipWeight,
      model: 'MobileNetV2 + CLIP'
    };
  }

  if (hasMobileNet) {
    return {
      cosine: mobileNet.cosine,
      percentage: mobileNet.percentage,
      mobileNetPercentage: mobileNet.percentage,
      clipPercentage: null,
      mobileNetWeight: 1,
      clipWeight: 0,
      model: 'MobileNetV2'
    };
  }

  return {
    cosine: clip.cosine,
    percentage: clip.percentage,
    mobileNetPercentage: null,
    clipPercentage: clip.percentage,
    mobileNetWeight: 0,
    clipWeight: 1,
    model: 'CLIP'
  };
}

/**
 * Compare an image against supplied text.
 */
async function requestImageTextSimilarityFromDataUrl(
  dataUrl,
  text,
  timeoutMs =
    Number(process.env.IMAGE_TEXT_TIMEOUT_MS) || 90000
) {
  if (!String(text || '').trim()) {
    throw new Error(
      'Non-empty text is required for image-text matching'
    );
  }

  const form = createImageForm(dataUrl);
  form.append('text', String(text).trim());

  const result = await postImageForm(
    '/cv/image-text-similarity',
    form,
    timeoutMs
  );

  const score = Number(result.similarity_percentage);

  if (!Number.isFinite(score)) {
    throw new Error(
      'AI service returned no valid similarity score'
    );
  }

  return {
    ...result,
    similarity_percentage: Math.max(
      0,
      Math.min(100, score)
    )
  };
}

module.exports = {
  requestEmbeddingFromDataUrl,
  requestLostNetClassificationFromDataUrl,
  requestImageTextSimilarityFromDataUrl,
  cosineSimilarity,
  similarityPercentage,
  calculateMobileNetSimilarity,
  calculateClipSimilarity,
  calculateHybridVisualSimilarity
};
