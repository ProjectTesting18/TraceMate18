'use strict';

const LOCAL_AI_URLS = [
  'http://127.0.0.1:8001',
  'http://localhost:8001',
  'http://127.0.0.1:8000',
  'http://localhost:8000'
];

let cachedUrl = null;
let resolving = null;

function normalizeBaseUrl(value) {
  let raw = String(value || '').trim();
  while (raw.endsWith('/')) raw = raw.slice(0, -1);
  if (!raw) return '';
  return raw.includes('://') ? raw : 'http://' + raw;
}

async function resolveAIServiceUrl() {
  if (cachedUrl) return cachedUrl;
  if (resolving) return resolving;

  resolving = (async () => {
    const configured = normalizeBaseUrl(process.env.AI_SERVICE_URL);
    const production = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
    const candidates = [...new Set([
      ...(configured ? [configured] : []),
      ...(!production ? LOCAL_AI_URLS : [])
    ])];

    for (const baseUrl of candidates) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(baseUrl + '/health', {
          method: 'GET',
          signal: controller.signal
        });
        if (response.ok) {
          cachedUrl = baseUrl;
          return cachedUrl;
        }
      } catch {
        // A later request can retry if the AI service is still starting.
      } finally {
        clearTimeout(timer);
      }
    }

    if (production) {
      throw new Error('TraceMate AI service is unavailable. Check AI_SERVICE_URL and the Python service deployment.');
    }
    return configured || 'http://127.0.0.1:8001';
  })();

  try {
    return await resolving;
  } finally {
    resolving = null;
  }
}

module.exports = { resolveAIServiceUrl };
