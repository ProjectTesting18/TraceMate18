/**
 * src/services/visionService.js
 * Image recognition using Google Vision API (or OpenAI Vision fallback)
 * Clean abstraction — provider can be swapped without changing callers.
 */

const logger = require('../utils/logger');

// ── PROVIDER: Google Vision API
const analyzeWithGoogle = async (imageUrl) => {
  try {
    const vision = require('@google-cloud/vision');
    const client = new vision.ImageAnnotatorClient();
    const [result] = await client.labelDetection(imageUrl);
    return result.labelAnnotations
      .filter((l) => l.score >= 0.65)
      .map((l) => l.description.toLowerCase())
      .slice(0, 10);
  } catch (err) {
    logger.error(`Google Vision error: ${err.message}`);
    return [];
  }
};

// ── PROVIDER: OpenAI Vision (GPT-4o) — fallback
const analyzeWithOpenAI = async (imageUrl) => {
  try {
    const { OpenAI } = require('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 100,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'List up to 10 descriptive labels for this item image (e.g. wallet, black, leather, card). Return ONLY a comma-separated list of single words/short phrases. No sentences.',
            },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
      ],
    });
    const text = response.choices[0]?.message?.content || '';
    return text.split(',').map((l) => l.trim().toLowerCase()).filter(Boolean).slice(0, 10);
  } catch (err) {
    logger.error(`OpenAI Vision error: ${err.message}`);
    return [];
  }
};

// ── PROVIDER: Keyword-based fallback (no external API)
const CATEGORY_KEYWORDS = {
  electronics: ['phone', 'laptop', 'charger', 'earphone', 'tablet', 'calculator', 'camera', 'device'],
  documents: ['id card', 'card', 'document', 'paper', 'certificate', 'book', 'file'],
  accessories: ['watch', 'glasses', 'sunglasses', 'jewelry', 'ring', 'chain', 'earring'],
  keys: ['key', 'keychain', 'lock'],
  wallet: ['wallet', 'purse', 'card holder', 'money'],
  bag: ['bag', 'backpack', 'satchel', 'tote', 'handbag'],
  clothing: ['shirt', 'jacket', 'hoodie', 'cap', 'shoe', 'belt'],
};

const analyzeWithKeywords = (itemName, category, description) => {
  const text = `${itemName} ${description || ''}`.toLowerCase();
  const labels = new Set();
  if (category) labels.add(category);
  Object.entries(CATEGORY_KEYWORDS).forEach(([cat, words]) => {
    words.forEach((word) => { if (text.includes(word)) labels.add(word); });
  });
  return [...labels].slice(0, 8);
};

// ════════════════════════════════════════
//  MAIN EXPORT
// ════════════════════════════════════════
const visionService = {
  /**
   * Analyze an image and return detected labels.
   * Automatically selects the best available provider.
   */
  analyzeImage: async (imageUrl, itemName = '', category = '', description = '') => {
    if (!imageUrl) {
      return analyzeWithKeywords(itemName, category, description);
    }

    // Try Google Vision first
    if (process.env.GOOGLE_VISION_API_KEY || process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      logger.info('Using Google Vision API for image analysis');
      const labels = await analyzeWithGoogle(imageUrl);
      if (labels.length > 0) return labels;
    }

    // Try OpenAI Vision
    if (process.env.OPENAI_API_KEY) {
      logger.info('Using OpenAI Vision for image analysis');
      const labels = await analyzeWithOpenAI(imageUrl);
      if (labels.length > 0) return labels;
    }

    // Fallback: keyword-based
    logger.warn('No Vision API configured — using keyword-based label extraction');
    return analyzeWithKeywords(itemName, category, description);
  },
};

module.exports = visionService;
