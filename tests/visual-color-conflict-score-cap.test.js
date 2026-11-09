const test = require('node:test');
const assert = require('node:assert/strict');
const matching = require('../src/advanced-cnn/matchingServiceCompat');

// This regression test exercises the real matching engine: contradictory
// report colors must prevent raw visual similarity from receiving full points.
test('primary color conflict caps visual contribution and preserves raw score for audit', () => {
  const lost = {
    id: 'lost-red-charger',
    name: 'charger',
    category: 'charger',
    description: 'red charger cable with white adaptor of one plus',
    color: 'red',
    primaryColor: 'red',
    location: 'parking',
    dateLost: '2026-10-20',
    image: 'data:image/png;base64,AA==',
    imageEmbedding: [1, 0, 0],
    imageEmbeddingModel: 'MobileNetV2',
    clipEmbedding: [1, 0, 0],
    clipEmbeddingModel: 'CLIP',
    clipAvailable: true,
    visualDetails: { available: false },
    visualRecognition: { object_type: 'charger', object_confidence: 0.2 }
  };
  const found = {
    id: 'found-white-charger',
    name: 'charger',
    category: 'charger',
    description: 'white charger cable with adaptor of one plus',
    color: 'white',
    primaryColor: 'white',
    location: 'parking',
    dateFound: '2026-10-20',
    image: 'data:image/png;base64,BB==',
    imageEmbedding: [1, 0, 0],
    imageEmbeddingModel: 'MobileNetV2',
    clipEmbedding: [1, 0, 0],
    clipEmbeddingModel: 'CLIP',
    clipAvailable: true,
    visualDetails: { available: false },
    visualRecognition: { object_type: 'charger', object_confidence: 0.2 }
  };
  const result = matching.calculateMatchScore(lost, found);
  assert.equal(result.primaryColorConflict, true);
  assert.equal(result.visualContradictionCapApplied, true);
  assert.equal(result.rawVisualSimilarityPercentage, 100);
  assert.ok(result.visualSimilarityPercentage <= 65);
  assert.ok(result.breakdown.cnnImage <= 6);
});


test('foreground image colour contradiction is detected even when text and CLIP labels agree', () => {
  const lost = {
    id: 'lost-black-headphones', name: 'black headphone', category: 'electronics',
    description: 'black swiss military brand headphones', color: 'black', brand: 'swiss military',
    location: 'classroom', dateLost: '2026-10-31', image: 'lost-photo.png',
    imageEmbedding: [1, 0, 0], imageEmbeddingModel: 'MobileNetV2',
    clipEmbedding: [1, 0, 0], clipEmbeddingModel: 'CLIP', clipAvailable: true,
    visualDetails: { available: true, foreground_color: { available: true, label: 'black', confidence: 0.78 } },
    visualRecognition: { object_type: 'headphones', object_confidence: 0.9, color: 'black', color_confidence: 0.8 }
  };
  const found = {
    id: 'found-white-headphones', name: 'headphone', category: 'electronics',
    description: 'black swiss military brand headphones', color: 'black', brand: 'swiss military',
    location: 'classroom 210', dateFound: '2026-10-31', image: 'found-photo.png',
    imageEmbedding: [1, 0, 0], imageEmbeddingModel: 'MobileNetV2',
    clipEmbedding: [1, 0, 0], clipEmbeddingModel: 'CLIP', clipAvailable: true,
    visualDetails: { available: true, foreground_color: { available: true, label: 'white', confidence: 0.78 } },
    visualRecognition: { object_type: 'headphones', object_confidence: 0.9, color: 'black', color_confidence: 0.8 }
  };
  const result = matching.calculateMatchScore(lost, found);
  assert.equal(result.visualColorConflict, true);
  assert.equal(result.visualContradiction, true);
  assert.ok(result.visualContradictionPenalty >= 4);
  assert.ok(result.visualContradictionPenalty < 12,
    'image-only color estimates must not receive the full confirmed-conflict penalty');
  assert.equal(result.primaryColorConflict, false,
    'report-provided colors agree, so the image-only estimate is uncertain');
  assert.equal(result.recommendedScoreCap, 82,
    'image-only color disagreement should prompt review without the 62% confirmed-conflict cap');
  assert.ok(result.score < 100);
});

test('percentage-scaled visual confidence is normalized before conflict thresholds', () => {
  const base = {
    name: 'black headphones', category: 'electronics',
    description: 'black swiss military brand headphones', color: 'black',
    location: 'classroom', dateLost: '2026-10-31'
  };
  const lowConfidence = matching.calculateMatchScore(
    {
      ...base,
      visualRecognition: { object_type: 'headphones', object_confidence: 90, color: 'black', color_confidence: 40 },
      visualDetails: { available: true, foreground_color: { available: true, label: 'light gray', confidence: 40 } }
    },
    {
      ...base,
      name: 'headphones', color: 'white', description: 'white swiss military brand headphones', dateFound: '2026-10-31',
      visualRecognition: { object_type: 'headphones', object_confidence: 90, color: 'white', color_confidence: 40 },
      visualDetails: { available: true, foreground_color: { available: true, label: 'white', confidence: 40 } }
    }
  );
  assert.equal(lowConfidence.visualColorConflict, false,
    '40 on a 0-100 scale is only 0.40 confidence and must not become a confirmed color conflict');
  assert.equal(lowConfidence.primaryColorConflict, true,
    'explicit report colors remain independent evidence');

  const highConfidence = matching.calculateMatchScore(
    {
      ...base,
      visualRecognition: { object_type: 'headphones', object_confidence: 90, color: 'gray', color_confidence: 80 },
      visualDetails: { available: true, foreground_color: { available: true, label: 'light gray', confidence: 80 } }
    },
    {
      ...base,
      name: 'headphones', color: 'white', description: 'white swiss military brand headphones', dateFound: '2026-10-31',
      visualRecognition: { object_type: 'headphones', object_confidence: 90, color: 'white', color_confidence: 80 },
      visualDetails: { available: true, foreground_color: { available: true, label: 'white', confidence: 80 } }
    }
  );
  assert.equal(highConfidence.visualColorConflict, true,
    '80% confidence remains strong enough to flag a distinct foreground color');
  assert.equal(highConfidence.reviewRecommended, true);
  assert.ok(highConfidence.score <= highConfidence.recommendedScoreCap);
});

test('gray and silver visual estimates are treated as nearby tones, not a hard color conflict', () => {
  const result = matching.calculateMatchScore(
    {
      name: 'silver headphones', category: 'electronics', description: 'silver over-ear headphones',
      visualRecognition: { object_type: 'headphones', object_confidence: 0.9, color: 'silver', color_confidence: 0.9 },
      visualDetails: { available: true, foreground_color: { available: true, label: 'silver', confidence: 0.9 } }
    },
    {
      name: 'gray headphones', category: 'electronics', description: 'gray over-ear headphones',
      visualRecognition: { object_type: 'headphones', object_confidence: 0.9, color: 'gray', color_confidence: 0.9 },
      visualDetails: { available: true, foreground_color: { available: true, label: 'gray', confidence: 0.9 } }
    }
  );
  assert.equal(result.visualColorConflict, false);
});


test('light gray and gray foreground estimates are treated as the same color family', () => {
  const result = matching.calculateMatchScore(
    {
      name: 'black headphones', category: 'electronics', description: 'Swiss Military headphones',
      color: 'black', location: 'classroom', dateLost: '2026-10-31',
      visualDetails: { available: true, foreground_color: { available: true, label: 'light gray', confidence: 0.8 } },
      visualRecognition: { object_type: 'headphones', object_confidence: 0.9, color: 'gray', color_confidence: 0.8 }
    },
    {
      name: 'headphones', category: 'electronics', description: 'Swiss Military headphones',
      color: 'black', location: 'classroom', dateFound: '2026-10-31',
      visualDetails: { available: true, foreground_color: { available: true, label: 'gray', confidence: 0.8 } },
      visualRecognition: { object_type: 'headphones', object_confidence: 0.9, color: 'gray', color_confidence: 0.8 }
    }
  );
  assert.equal(result.visualColorConflict, false);
  assert.equal(result.primaryColorConflict, false);
  assert.ok(result.score > 62, `minor shade variation should not trigger the 62% cap; got ${result.score}`);
});

test('white foreground estimate does not become a confirmed report conflict when found report has no color text', () => {
  const lost = {
    id: 'lost-black-headphones', name: 'headphone', category: 'electronics',
    description: 'black swiss military brand headphones', brand: 'swiss military',
    location: 'classroom', dateLost: '2026-10-31', image: 'lost-photo.png', color: 'black',
    visualDetails: { available: true, foreground_color: { available: true, label: 'black', confidence: 0.78 } },
    visualRecognition: { object_type: 'headphones', object_confidence: 0.9, color: 'black', color_confidence: 0.8 }
  };
  const found = {
    id: 'found-headphones', name: 'headphone', category: 'electronics',
    description: 'headphone', location: 'classroom', dateFound: '2026-10-31', image: 'found-photo.png', color: 'white',
    visualDetails: { available: true, foreground_color: { available: true, label: 'white', confidence: 0.78 } },
    visualRecognition: { object_type: 'headphones', object_confidence: 0.9, color: 'white', color_confidence: 0.8 }
  };
  const result = matching.calculateMatchScore(lost, found);
  assert.equal(result.primaryColorConflict, false,
    'a classifier-filled color must not be treated as an explicitly reported color');
  assert.equal(result.visualColorConflict, true,
    'the white-vs-black image estimate should still be surfaced for manual review');
  assert.equal(result.recommendedScoreCap, 82,
    'image-only color disagreement should use the uncertain-evidence cap');
  assert.equal(result.reviewRecommended, true);
});
