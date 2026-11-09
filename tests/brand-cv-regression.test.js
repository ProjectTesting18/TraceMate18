const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateMatchScore } = require('../src/advanced-cnn/matchingServiceCompat');

function visualBrand(brand, confidence = 92) {
  return {
    available: true,
    brand_candidates: [brand],
    ocr: { available: true, confidence, brand_candidates: [brand] },
    image_attributes: { ocr_confidence: confidence, brand_candidates: [brand] }
  };
}

test('high-confidence image OCR rejects different detected brands', () => {
  const result = calculateMatchScore(
    { name: 'notebook', category: 'stationery', description: 'paper notebook', visualDetails: visualBrand('classmate') },
    { name: 'notebook', category: 'stationery', description: 'paper notebook', visualDetails: visualBrand('octane') }
  );
  assert.equal(result.explicitBrandConflict, true);
  assert.equal(result.identityConflict, true);
  assert.equal(result.score, 0);
});

test('same high-confidence image brand does not trigger conflict', () => {
  const result = calculateMatchScore(
    { name: 'notebook', category: 'stationery', description: 'paper notebook', visualDetails: visualBrand('classmate') },
    { name: 'notebook', category: 'stationery', description: 'paper notebook', visualDetails: visualBrand('classmate') }
  );
  assert.notEqual(result.explicitBrandConflict, true);
});

test('low-confidence OCR brand does not create a hard conflict', () => {
  const result = calculateMatchScore(
    { name: 'notebook', category: 'stationery', description: 'paper notebook', visualDetails: visualBrand('classmate', 25) },
    { name: 'notebook', category: 'stationery', description: 'paper notebook', visualDetails: visualBrand('octane', 20) }
  );
  assert.notEqual(result.explicitBrandConflict, true);
});

test('missing image-derived brand is unknown rather than conflicting', () => {
  const result = calculateMatchScore(
    { name: 'notebook', category: 'stationery', description: 'paper notebook', visualDetails: visualBrand('classmate') },
    { name: 'notebook', category: 'stationery', description: 'paper notebook', visualDetails: { available: true, brand_candidates: [], ocr: { confidence: 90, brand_candidates: [] }, image_attributes: { ocr_confidence: 90, brand_candidates: [] } } }
  );
  assert.notEqual(result.explicitBrandConflict, true);
});

test('scratch screening mismatch is a review signal, not a hard rejection', () => {
  const result = calculateMatchScore(
    { name: 'silver helmet', category: 'helmet', description: 'silver motorcycle helmet', visualDetails: { available: true, scratchScreening: { available: true, possible_mark: true, score: 0.3 } } },
    { name: 'silver helmet', category: 'helmet', description: 'silver motorcycle helmet', visualDetails: { available: true, scratchScreening: { available: true, possible_mark: false, score: 0.0 } } }
  );
  assert.equal(result.scratchScreening.mismatch, true);
  assert.equal(result.reviewRecommended, true);
  assert.notEqual(result.identityConflict, true);
  assert.ok(result.reasons.some(reason => /scratch-like mark screening differs/i.test(reason)));
});
