const test = require('node:test');
const assert = require('node:assert/strict');
const matching = require('../src/advanced-cnn/matchingServiceCompat');

const base = {
  name: 'charger',
  category: 'electronics',
  location: 'parking',
  dateLost: '2026-10-20',
  dateFound: '2026-10-20',
  image: 'photo-present',
  imageEmbedding: [1, 0, 0],
  imageEmbeddingModel: 'MobileNetV2',
  clipEmbedding: [1, 0, 0],
  clipEmbeddingModel: 'CLIP',
  clipAvailable: true,
  visualDetails: { available: false },
  detectedLabels: ['charger'],
  detectedLabelConfidence: 0.9,
};

test('high-confidence matching image colors do not override explicit report-color conflict', () => {
  const lost = {
    ...base,
    id: 'lost',
    color: 'red',
    primaryColor: 'red',
    description: 'red charger cable with white adapter',
    visualRecognition: {
      objectType: 'charger', objectConfidence: 0.9,
      color: 'red', colorConfidence: 0.92
    }
  };
  const found = {
    ...base,
    id: 'found',
    color: 'white',
    primaryColor: 'white',
    description: 'white charger cable with adapter',
    visualRecognition: {
      objectType: 'charger', objectConfidence: 0.9,
      color: 'red', colorConfidence: 0.91
    }
  };

  const result = matching.calculateMatchScore(lost, found);
  assert.equal(result.reportedPrimaryColorConflict, true);
  assert.equal(result.visualColorAgreementOverridesReportConflict, false);
  assert.equal(result.primaryColorConflict, true);
  assert.equal(result.visualContradictionCapApplied, true);
  assert.ok(result.reviewReasons.some(reason => /Primary color differs: red vs white/.test(reason)));
});

test('different high-confidence image colors still trigger a visual contradiction', () => {
  const lost = {
    ...base,
    color: 'red', primaryColor: 'red',
    visualRecognition: { objectType: 'charger', objectConfidence: 0.9, color: 'red', colorConfidence: 0.9 }
  };
  const found = {
    ...base,
    color: 'white', primaryColor: 'white',
    visualRecognition: { objectType: 'charger', objectConfidence: 0.9, color: 'white', colorConfidence: 0.9 }
  };
  const result = matching.calculateMatchScore(lost, found);
  assert.equal(result.primaryColorConflict, true);
  assert.equal(result.visualColorAgreementOverridesReportConflict, false);
  assert.equal(result.visualContradictionCapApplied, true);
});

test('matching high-confidence image colors do not override report conflict across accessory wording variants', () => {
  const lost = {
    ...base,
    id: 'lost-family-variant',
    name: 'charger',
    color: 'red', primaryColor: 'red',
    description: 'red charger cable with white adapter',
    visualRecognition: { objectType: 'charger', objectConfidence: 0.9, color: 'red', colorConfidence: 0.92 }
  };
  const found = {
    ...base,
    id: 'found-family-variant',
    name: 'charging cable',
    category: 'accessories',
    color: 'white', primaryColor: 'white',
    description: 'white USB charging lead with adapter',
    visualRecognition: { objectType: 'charger', objectConfidence: 0.9, color: 'red', colorConfidence: 0.91 }
  };

  const result = matching.calculateMatchScore(lost, found);
  assert.equal(result.reportedPrimaryColorConflict, true);
  assert.equal(result.visualColorAgreementOverridesReportConflict, false);
  assert.equal(result.primaryColorConflict, true);
  assert.equal(result.visualContradictionCapApplied, true);
});
