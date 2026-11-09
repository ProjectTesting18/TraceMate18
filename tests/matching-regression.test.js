const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateMatchScore } = require('../src/advanced-cnn/matchingServiceCompat');

const commonLocation = 'College Computer Lab near the computer lab entrance';

function helmetPair({ sameColor = false, withEmbeddings = false } = {}) {
  const lost = {
    name: 'silver-colored Studds motorcycle helmet',
    category: 'helmet',
    description: 'A metallic silver outer shell, a black front visor, black lower trim, and visible scratches and scuff marks on the sides. The helmet has a Studds logo on the front and side.',
    location: `${commonLocation}, beside the student seating area`,
    dateLost: '2026-10-10',
    visualRecognition: { color: 'gray', colorConfidence: 0.9, objectType: 'helmet', objectConfidence: 0.95 }
  };
  const found = {
    name: sameColor ? 'silver motorcycle helmet' : 'black motorcycle helmet',
    category: 'helmet',
    description: sameColor ? 'Silver motorcycle helmet with black visor' : 'Black motorcycle helmet',
    location: commonLocation,
    dateFound: '2026-10-10',
    visualRecognition: { color: sameColor ? 'gray' : 'black', colorConfidence: 0.9, objectType: 'helmet', objectConfidence: 0.95 }
  };
  if (withEmbeddings) {
    // Deliberately identical embeddings simulate high generic image similarity.
    lost.imageEmbedding = found.imageEmbedding = [1, 0, 0, 0];
    lost.clipEmbedding = found.clipEmbedding = [1, 0, 0, 0];
  }
  return { lost, found };
}

test('primary shell color is not confused with a secondary black visor/trim', () => {
  const { lost, found } = helmetPair();
  const result = calculateMatchScore(lost, found);
  assert.equal(result.primaryColorLost, 'silver');
  assert.equal(result.primaryColorFound, 'black');
  assert.equal(result.primaryColorConflict, true);
  assert.equal(result.reviewRecommended, true);
  assert.equal(result.propertyBreakdown.color, 0);
});

test('generic image similarity cannot lift a primary-color conflict above review cap', () => {
  const { lost, found } = helmetPair({ withEmbeddings: true });
  const result = calculateMatchScore(lost, found);
  assert.equal(result.primaryColorConflict, true);
  assert.equal(result.visualColorConflict, true);
  assert.ok(result.score <= 58, `expected score <= 58, got ${result.score}`);
});

test('matching primary colors do not trigger a primary-color conflict', () => {
  const { lost, found } = helmetPair({ sameColor: true });
  const result = calculateMatchScore(lost, found);
  assert.equal(result.primaryColorConflict, false);
});

test('different object families remain hard rejected', () => {
  const result = calculateMatchScore(
    { name: 'silver motorcycle helmet', category: 'accessories', description: 'silver helmet' },
    { name: 'black wristwatch', category: 'accessories', description: 'black wristwatch' }
  );
  assert.equal(result.score, 0);
  assert.equal(result.objectFamilyConflict, true);
});

test('equivalent notebook category labels receive full category credit', () => {
  const lost = {
    name: 'Classmate motivational notebook',
    category: 'notebook',
    description: 'Notebook with a motivational cover'
  };
  const found = {
    name: 'Classmate motivational notebook',
    category: 'exercise book',
    description: 'Notebook with a motivational cover'
  };

  const result = calculateMatchScore(lost, found);
  assert.equal(result.breakdown.category, 20);
});

test('notebook and stationery categories receive partial category credit', () => {
  const lost = {
    name: 'Classmate motivational notebook',
    category: 'notebook',
    description: 'Notebook with a motivational cover'
  };
  const found = {
    name: 'Classmate motivational notebook',
    category: 'stationery',
    description: 'Notebook with a motivational cover'
  };

  const result = calculateMatchScore(lost, found);
  assert.equal(result.breakdown.category, 10);
});
