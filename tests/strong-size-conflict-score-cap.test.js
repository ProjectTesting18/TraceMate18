const test = require('node:test');
const assert = require('node:assert/strict');
const matching = require('../src/advanced-cnn/matchingServiceCompat');

const base = {
  category: 'other', location: 'canteen', dateLost: '2026-10-20', dateFound: '2026-10-20',
  imageEmbedding: [1, 0, 0], imageEmbeddingModel: 'MobileNetV2',
  clipEmbedding: [1, 0, 0], clipEmbeddingModel: 'CLIP', clipAvailable: true,
  visualDetails: { available: false }, detectedLabels: ['bottle'], detectedLabelConfidence: 0.9,
};

test('strong, confidence-qualified bottle size conflict caps score and recommends review', () => {
  const lost = {
    ...base, id: 'lost-bottle', name: 'Silver water bottle',
    description: 'Long silver stainless steel water bottle with screw cap',
    visualRecognition: {
      objectType: 'water_bottle', objectConfidence: 0.95,
      color: 'gray', colorConfidence: 0.9,
      sizeClass: 'large', sizeConfidence: 0.9,
    },
  };
  const found = {
    ...base, id: 'found-bottle', name: 'Silver bottle',
    description: 'Small round silver bottle with screw cap',
    visualRecognition: {
      objectType: 'water_bottle', objectConfidence: 0.95,
      color: 'gray', colorConfidence: 0.9,
      sizeClass: 'small', sizeConfidence: 0.9,
    },
  };
  const result = matching.calculateMatchScore(lost, found);
  assert.equal(result.visualSizeConflict, true);
  assert.ok(result.score <= 55, `expected score <= 55, got ${result.score}`);
  assert.ok(result.reviewRecommended === true || result.reviewReasons?.length > 0);
  assert.ok((result.scoreAudit?.recommendedScoreCapReasons || []).some(reason => /size conflict/i.test(reason)));
});
