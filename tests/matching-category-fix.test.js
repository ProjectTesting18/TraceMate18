const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateMatchScore, W } = require('../src/advanced-cnn/matchingServiceCompat');

test('same school notebook names infer the missing category and receive full category credit', () => {
  const result = calculateMatchScore(
    {
      name: 'Classmate motivational notebook',
      description: 'A white notebook with a light-blue grid pattern and motivational illustrations.'
    },
    {
      name: 'Classmate motivational notebook',
      description: 'White paper notebook with colorful motivational illustrations on the cover.'
    }
  );

  assert.equal(result.breakdown.category, W.category);
});

test('generic Other categories fall back to a clearly identified paper notebook', () => {
  const result = calculateMatchScore(
    { name: 'Classmate motivational notebook', category: 'Other' },
    { name: 'Classmate motivational notebook', category: { title: 'Others' } }
  );

  assert.equal(result.breakdown.category, W.category);
});

test('equivalent stationery category labels receive full category credit', () => {
  const result = calculateMatchScore(
    { name: 'Ruled notebook', category: 'Stationery' },
    { name: 'Ruled notebook', category: 'school supplies' }
  );

  assert.equal(result.breakdown.category, W.category);
});

test('paper notebooks and laptops remain different object families', () => {
  const result = calculateMatchScore(
    { name: 'Classmate motivational notebook', description: 'A paper notebook with a printed cover.' },
    { name: 'Laptop computer', description: 'A portable computer.' }
  );

  assert.equal(result.objectFamilyConflict, true);
  assert.equal(result.identityConflict, true);
  assert.equal(result.score, 0);
});

test('broad unrelated category labels do not suppress an explicit notebook identity', () => {
  const result = calculateMatchScore(
    { name: 'Classmate motivational notebook', category: 'Educational Items' },
    { name: 'Classmate motivational notebook', category: 'Personal Belongings' }
  );

  assert.equal(result.breakdown.category, W.category);
});
