const test = require('node:test');
const assert = require('node:assert/strict');
const matching = require('../src/advanced-cnn/matchingServiceCompat');

test('identical embedding vectors across distinct photo sources are surfaced as a diagnostic', () => {
  const base = {
    name: 'charger',
    category: 'electronics',
    location: 'parking',
    dateLost: '2026-10-20',
    dateFound: '2026-10-20',
    imageEmbedding: [1, 0, 0],
    imageEmbeddingModel: 'MobileNetV2',
    clipEmbedding: [0, 1, 0],
    clipEmbeddingModel: 'CLIP',
    clipAvailable: true,
    visualDetails: { available: false },
    detectedLabels: ['charger'],
    detectedLabelConfidence: 0.9,
    visualRecognition: { objectType: 'charger', objectConfidence: 0.9 }
  };
  const result = matching.calculateMatchScore(
    { ...base, id: 'lost', image: 'lost-photo.jpg', color: 'red', primaryColor: 'red' },
    { ...base, id: 'found', image: 'found-photo.jpg', color: 'white', primaryColor: 'white' }
  );

  assert.equal(result.visualDiagnostics.distinctImageSources, true);
  assert.equal(result.visualDiagnostics.identicalMobileNetEmbeddings, true);
  assert.equal(result.visualDiagnostics.identicalClipEmbeddings, true);
  assert.ok(result.reasons.some(reason => /identical image-embedding vectors/.test(reason)));
  assert.equal(result.primaryColorConflict, true);
  assert.ok(result.score <= 62);
});
