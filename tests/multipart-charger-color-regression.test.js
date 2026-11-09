const test = require('node:test');
const assert = require('node:assert/strict');
const matching = require('../src/advanced-cnn/matchingServiceCompat');

const base = {
  name: 'charger', category: 'electronics', location: 'parking',
  dateLost: '2026-10-20', dateFound: '2026-10-20',
  imageEmbedding: [1, 0, 0], imageEmbeddingModel: 'MobileNetV2',
  clipEmbedding: [1, 0, 0], clipEmbeddingModel: 'CLIP', clipAvailable: true,
  visualDetails: { available: false }, detectedLabels: ['charger'], detectedLabelConfidence: 0.9
};

test('red cable plus white adapter is not treated as a whole-item color contradiction', () => {
  const lost = { ...base, id: 'lost', color: 'red', primaryColor: 'red', description: 'red charger cable with white adaptor of OnePlus', visualRecognition: { objectType: 'charger', objectConfidence: 0.9, color: 'red', colorConfidence: 0.9 } };
  const found = { ...base, id: 'found', color: 'white', primaryColor: 'white', description: 'charger', visualRecognition: { objectType: 'charger', objectConfidence: 0.9, color: 'red', colorConfidence: 0.9 } };
  const result = matching.calculateMatchScore(lost, found);
  assert.equal(result.reportedPrimaryColorConflict, true, 'raw report fields remain visible for audit');
  assert.equal(result.multiComponentColorDifference, true);
  assert.equal(result.primaryColorConflict, false);
  assert.equal(result.visualContradictionCapApplied, false);
  assert.ok(result.propertyBreakdown.color > 0 && result.propertyBreakdown.color < 100, `expected partial color overlap, got ${result.propertyBreakdown.color}`);
  assert.ok(!result.reviewReasons.some(reason => /Primary color differs/i.test(reason)));
  assert.ok(result.reasons.some(reason => /treated as component colors/i.test(reason)));
  assert.ok(result.reasons.some(reason => /AI visual color estimates agree: red.*red and white describe different charging-accessory components/i.test(reason)));
  assert.ok(!result.reasons.some(reason => /reported color conflict remains unresolved/i.test(reason)), 'multi-component color differences must not be described as an unresolved primary-color conflict');
});

test('red cable versus white cable remains a real color conflict even if both mention an adapter', () => {
  const lost = { ...base, color: 'red', primaryColor: 'red', description: 'red charger cable with white adaptor' };
  const found = { ...base, color: 'white', primaryColor: 'white', description: 'white charging cable with white adapter' };
  const result = matching.calculateMatchScore(lost, found);
  assert.equal(result.multiComponentColorDifference, false);
  assert.equal(result.primaryColorConflict, true);
  assert.ok(result.reviewReasons.some(reason => /Primary color differs/i.test(reason)));
});
