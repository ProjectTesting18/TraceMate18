/**
 * TraceMate hybrid matching engine.
 *
 * This module is intentionally dependency-free. It performs deterministic
 * NLP-style text normalization/token overlap plus category, location, date,
 * metadata and optional image-embedding comparison.
 *
 * The separate FastAPI service also exposes a TF-IDF NLP endpoint for
 * research/testing, but the admin workflow does NOT depend on that service.
 * Therefore a temporary AI-service outage cannot break item matching.
 */

const W = {
  category: 25,
  nameText: 20,
  description: 15,
  location: 10,
  date: 10,
  colorBrand: 5,
  imageLabels: 5,
  cnnImage: 10,
};

const STOP_WORDS = new Set([
  'a','an','and','are','as','at','be','by','for','from','had','has','have',
  'i','in','is','it','its','near','of','on','or','that','the','this','to',
  'was','were','with','my','me','very','item','found','lost'
]);

const SYNONYMS = new Map([
  ['backpack','bag'],
  ['rucksack','bag'],
  ['handbag','bag'],
  ['purse','bag'],
  ['mobile','phone'],
  ['cellphone','phone'],
  ['smartphone','phone'],
  ['notebook','laptop'],
  ['macbook','laptop'],
  ['spectacles','glasses'],
  ['eyeglasses','glasses'],
  ['wallets','wallet'],
  ['keys','key'],
]);

function safeString(value) {
  return value == null ? '' : String(value);
}

function normalizeToken(token) {
  let value = token.toLowerCase();

  if (SYNONYMS.has(value)) {
    return SYNONYMS.get(value);
  }

  for (const suffix of ['ingly','edly','ing','ed','es','s']) {
    if (value.length > suffix.length + 3 && value.endsWith(suffix)) {
      let candidate = value.slice(0, -suffix.length);
      if (candidate.endsWith('i') && suffix === 'es') {
        candidate = `${candidate.slice(0, -1)}y`;
      }
      return candidate;
    }
  }

  return value;
}

function tokens(value) {
  return safeString(value)
    .toLowerCase()
    .match(/[a-z0-9]+/g)
    ?.map(normalizeToken)
    .filter(token => token.length >= 2 && !STOP_WORDS.has(token)) || [];
}

function nlpTextScore(a, b, weight) {
  const aa = tokens(a);
  const bb = tokens(b);

  if (!aa.length || !bb.length) return 0;

  const sa = new Set(aa);
  const sb = new Set(bb);
  const intersection = [...sa].filter(token => sb.has(token)).length;
  const union = new Set([...sa, ...sb]).size;

  if (!union) return 0;

  // Dice rewards shared terms while staying bounded.
  const dice = (2 * intersection) / (sa.size + sb.size);

  // Character-prefix similarity helps with small spelling/inflection changes.
  const commonPrefixes = [...sa].filter(aToken =>
    [...sb].some(bToken =>
      aToken.length >= 4 &&
      bToken.length >= 4 &&
      (aToken.startsWith(bToken.slice(0, 4)) ||
       bToken.startsWith(aToken.slice(0, 4)))
    )
  ).length;

  const prefixBonus = commonPrefixes / Math.max(sa.size, sb.size);
  const score = Math.min(1, dice * 0.85 + prefixBonus * 0.15);

  return Math.round(score * weight);
}

function categoryScore(a, b) {
  const aa = safeString(a).trim().toLowerCase();
  const bb = safeString(b).trim().toLowerCase();

  if (!aa || !bb) return 0;
  if (aa === bb) return W.category;

  const related = {
    wallet: ['accessories', 'bag'],
    bag: ['accessories', 'wallet'],
    jewellery: ['accessories'],
    books: ['documents'],
    documents: ['books'],
  };

  if (related[aa]?.includes(bb) || related[bb]?.includes(aa)) {
    return Math.round(W.category * 0.5);
  }

  return 0;
}

function dateScore(a, b) {
  if (!a || !b) return 0;

  const d1 = new Date(a);
  const d2 = new Date(b);

  if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) {
    return 0;
  }

  // A found item cannot normally precede the lost report by more than one day.
  const signedDiff = (d2.getTime() - d1.getTime()) / 86400000;
  if (signedDiff < -1) return 0;

  const diff = Math.abs(signedDiff);

  if (diff <= 1) return W.date;
  if (diff <= 3) return Math.round(W.date * 0.8);
  if (diff <= 7) return Math.round(W.date * 0.5);
  if (diff <= 14) return Math.round(W.date * 0.25);
  return 0;
}

function colorBrandScore(lost, found) {
  let score = 0;

  const colorA = safeString(lost.color).toLowerCase();
  const colorB = safeString(found.color).toLowerCase();

  if (colorA && colorB) {
    if (colorA === colorB) score += W.colorBrand * 0.6;
    else if (colorA.includes(colorB) || colorB.includes(colorA)) {
      score += W.colorBrand * 0.3;
    }
  }

  const brandA = safeString(lost.brand).toLowerCase();
  const brandB = safeString(found.brand).toLowerCase();

  if (brandA && brandB) {
    if (brandA === brandB) score += W.colorBrand * 0.4;
    else if (brandA.includes(brandB) || brandB.includes(brandA)) {
      score += W.colorBrand * 0.2;
    }
  }

  return Math.min(Math.round(score), W.colorBrand);
}

function labelScore(a = [], b = []) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || !b.length) {
    return 0;
  }

  return nlpTextScore(a.join(' '), b.join(' '), W.imageLabels);
}

function cnnScore(lost, found) {
  const a = lost?.imageEmbedding;
  const b = found?.imageEmbedding;

  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) {
    return {
      points: 0,
      cosine: null,
      percentage: null,
    };
  }

  let dot = 0;

  for (let i = 0; i < a.length; i += 1) {
    const x = Number(a[i]);
    const y = Number(b[i]);

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { points: 0, cosine: null, percentage: null };
    }

    dot += x * y;
  }

  const cosine = Math.max(-1, Math.min(1, dot));
  const percentage = ((cosine + 1) / 2) * 100;

  return {
    points: Math.round((percentage / 100) * W.cnnImage),
    cosine,
    percentage,
  };
}

function calculateMatchScore(lost = {}, found = {}) {
  const image = cnnScore(lost, found);

  const lostName = lost.name || lost.itemName;
  const foundName = found.name || found.itemName;

  const lostDescription = lost.desc || lost.description;
  const foundDescription = found.desc || found.description;

  const lostLocation = lost.location || lost.lastSeenLocation;
  const foundLocation = found.location || found.foundLocation;

  const lostDate = lost.dateLost || lost.date;
  const foundDate = found.dateFound || found.foundDate || found.date;

  const scores = {
    category: categoryScore(lost.category, found.category),
    nameText: nlpTextScore(lostName, foundName, W.nameText),
    description: nlpTextScore(lostDescription, foundDescription, W.description),
    location: nlpTextScore(lostLocation, foundLocation, W.location),
    date: dateScore(lostDate, foundDate),
    colorBrand: colorBrandScore(lost, found),
    imageLabels: labelScore(lost.detectedLabels, found.detectedLabels),
    cnnImage: image.points,
  };

  let score = Object.values(scores).reduce((sum, value) => sum + value, 0);

  // Category mismatch is a strong negative signal.
  if (scores.category === 0) {
    score = Math.min(score, 35);
  }

  score = Math.max(0, Math.min(100, score));

  const confidence =
    score >= 75 ? 'high' :
    score >= 45 ? 'medium' :
    'low';

  const reasons = [];

  if (scores.category === W.category) reasons.push('Same category');
  else if (scores.category > 0) reasons.push('Related category');

  if (scores.nameText >= W.nameText * 0.7) {
    reasons.push('NLP item-name similarity is high');
  }

  if (scores.description >= W.description * 0.6) {
    reasons.push('NLP description similarity is high');
  }

  if (scores.location >= W.location * 0.5) {
    reasons.push('Similar location');
  }

  if (scores.date >= 8) reasons.push('Dates are very close');
  else if (scores.date >= 5) reasons.push('Dates are within a week');

  if (scores.colorBrand > 0) reasons.push('Color or brand match');
  if (scores.imageLabels > 0) reasons.push('Image labels matched');

  if (scores.cnnImage > 0) {
    reasons.push(`Image similarity contributed ${scores.cnnImage}/${W.cnnImage} points`);
  }

  return {
    score,
    confidence,
    reasons,
    breakdown: scores,
    cnnCosineSimilarity: image.cosine,
    cnnSimilarityPercentage: image.percentage,
  };
}

module.exports = {
  calculateMatchScore,
  W,
};
