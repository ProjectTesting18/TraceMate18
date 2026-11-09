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
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : \`http://\${raw}\`;
}

/**
 * Resolve the configured AI service only after its health endpoint responds.
 * Production never falls back to localhost: the Node and Python services
 * run in separate Render instances.
 */
async function resolveAIServiceUrl() {
  if (cachedUrl) return cachedUrl;
  if (resolving) return resolving;

  resolving = (async () => {
    const configured = normalizeBaseUrl(process.env.AI_SERVICE_URL);
    const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
    const candidates = [...new Set([
      ...(configured ? [configured] : []),
      ...(!isProduction ? LOCAL_AI_URLS : [])
    ])];

    for (const baseUrl of candidates) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(\`\${baseUrl}/health\`, {
          method: 'GET',
          signal: controller.signal
        });
        if (response.ok) {
          cachedUrl = baseUrl;
          return cachedUrl;
        }
      } catch {
        // Retry on the next request if the AI service is still starting.
      } finally {
        clearTimeout(timer);
      }
    }

    if (isProduction) {
      throw new Error('Configured TraceMate AI service is unavailable. Check AI_SERVICE_URL and the Python service deployment.');
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
