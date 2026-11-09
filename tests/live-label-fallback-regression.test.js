const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateMatchScore } = require('../src/advanced-cnn/matchingServiceCompat');

const base = { name: 'charger', category: 'Electronics', description: 'phone charger', dateLost: '2026-10-22', dateFound: '2026-10-22' };

test('image-label score recovers model labels from visualRecognition when detectedLabels are absent', () => {
  const lost = { ...base, visualRecognition: { object_type: 'phone charger', object_confidence: 0.42 } };
  const found = { ...base, visual_recognition: { object_type: 'phone charger', object_confidence: 0.43 } };
  const result = calculateMatchScore(lost, found);
  assert.ok(result.breakdown.imageLabels > 0, JSON.stringify(result.breakdown));
  assert.ok(result.breakdown.imageLabels <= 2, JSON.stringify(result.breakdown));
});

test('charger and charging-cable model labels contribute partial family evidence, not an exact match', () => {
  const lost = { ...base, detectedLabels: ['charger'], detectedLabelConfidence: 0.72 };
  const found = { ...base, detectedLabels: ['charging cable'], detectedLabelConfidence: 0.76 };
  const result = calculateMatchScore(lost, found);
  assert.ok(result.breakdown.imageLabels > 0, JSON.stringify(result.breakdown));
  assert.ok(result.breakdown.imageLabels <= 2, JSON.stringify(result.breakdown));
});
