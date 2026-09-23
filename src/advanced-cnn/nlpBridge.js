const AI_SERVICE_URL =
  process.env.AI_SERVICE_URL || 'http://127.0.0.1:8001';

async function requestTextSimilarity(text1, text2, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(
      `${AI_SERVICE_URL}/nlp/text-similarity`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text1: String(text1 || ''),
          text2: String(text2 || ''),
        }),
        signal: controller.signal,
      }
    );

    const raw = await response.text();
    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(`AI service returned invalid JSON: ${raw.slice(0, 200)}`);
    }

    if (!response.ok) {
      throw new Error(data.detail || data.error || `AI service HTTP ${response.status}`);
    }

    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('NLP service request timed out');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { requestTextSimilarity };
