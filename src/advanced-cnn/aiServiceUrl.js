'use strict';

const DEFAULT_AI_SERVICE_URLS = [
  'http://127.0.0.1:8001',
  'http://localhost:8001',
  'http://127.0.0.1:8000',
  'http://localhost:8000'
];

const CACHE_TTL_MS = 15000;
let cached = null;
let resolving = null;

function normalizeBaseUrl(value) {
  let raw = String(value || '').trim();
  while (raw.endsWith('/')) raw = raw.slice(0, -1);
  if (!raw) return '';
  return raw.includes('://') ? raw : 'http://' + raw;
}

async function checkHealth(baseUrl, timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(baseUrl + '/health', {
      method: 'GET',
      signal: controller.signal
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveAIServiceUrl() {
  const configured = normalizeBaseUrl(process.env.AI_SERVICE_URL);
  const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';

  if (
    cached &&
    cached.configured === configured &&
    Date.now() - cached.checkedAt < CACHE_TTL_MS
  ) {
    return cached.url;
  }
  if (resolving) return resolving;

  resolving = (async () => {
    const candidates = [
      ...new Set([
        ...(configured ? [configured] : []),
        ...(!isProduction ? DEFAULT_AI_SERVICE_URLS : [])
      ])
    ];

    for (const baseUrl of candidates) {
      if (await checkHealth(baseUrl)) {
        cached = {
          url: baseUrl,
          configured,
          checkedAt: Date.now()
        };
        return baseUrl;
      }
    }

    cached = null;
    if (isProduction) {
      throw new Error(
        'Configured TraceMate AI service is unavailable. Check AI_SERVICE_URL and the Python service deployment.'
      );
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
