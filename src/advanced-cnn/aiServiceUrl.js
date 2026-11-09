'use strict';

const DEFAULT_AI_SERVICE_URLS = [
  'http://127.0.0.1:8001',
  'http://localhost:8001',
  'http://127.0.0.1:8000',
  'http://localhost:8000'
];

let cachedUrl = null;
let resolving = null;

/**
 * Resolve the running TraceMate AI service instead of blindly trusting a stale
 * AI_SERVICE_URL (for example, an .env value pointing at unused port 8000).
 * The URL is cached only after /health succeeds.
 */
async function resolveAIServiceUrl() {
  if (cachedUrl) return cachedUrl;
  if (resolving) return resolving;

  resolving = (async () => {
    const configured = String(process.env.AI_SERVICE_URL || '').trim()
      .replace(/\/+$/, '');
    const candidates = [...new Set([
      ...(configured ? [configured] : []),
      ...DEFAULT_AI_SERVICE_URLS
    ])];

    for (const baseUrl of candidates) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      try {
        const response = await fetch(`${baseUrl}/health`, {
          method: 'GET',
          signal: controller.signal
        });
        if (response.ok) {
          cachedUrl = baseUrl;
          return cachedUrl;
        }
      } catch {
        // Try the next configured/default local endpoint.
      } finally {
        clearTimeout(timer);
      }
    }

    // Do not cache failure; a later request can succeed after Python starts.
    return configured || 'http://127.0.0.1:8001';
  })();

  try {
    return await resolving;
  } finally {
    resolving = null;
  }
}

module.exports = { resolveAIServiceUrl };
