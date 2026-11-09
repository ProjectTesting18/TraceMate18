const test = require('node:test');
const assert = require('node:assert/strict');
const { selectAdminCandidatePool } = require('../src/advanced-cnn/adminCandidateSelection');
const { calculateMatchScore } = require('../src/advanced-cnn/matchingServiceCompat');

test('admin candidate selection uses compatible candidates when available', () => {
  const selected = selectAdminCandidatePool([
    { item: { id: 'wrong' }, result: { score: 90, objectFamilyConflict: true } },
    { item: { id: 'possible' }, result: { score: 22 } }
  ]);
  assert.equal(selected.reviewOnlyFallback, false);
  assert.equal(selected.candidates.length, 1);
  assert.equal(selected.candidates[0].item.id, 'possible');
  assert.equal(selected.candidates[0].eligibleForConfirmation, true);
});

test('admin candidate selection shows a small review-only list if every open candidate conflicts', () => {
  const selected = selectAdminCandidatePool([
    { item: { id: 'wrong-a' }, result: { score: 0, objectFamilyConflict: true } },
    { item: { id: 'wrong-b' }, result: { score: 0, identityConflict: true } }
  ]);
  assert.equal(selected.reviewOnlyFallback, true);
  assert.equal(selected.candidates.length, 2);
  assert.ok(selected.candidates.every(candidate => candidate.eligibleForConfirmation === false));
});

test('admin candidate selection returns empty only when there are no eligible source reports', () => {
  const selected = selectAdminCandidatePool([]);
  assert.equal(selected.reviewOnlyFallback, false);
  assert.deepEqual(selected.candidates, []);
});

test('One Plus and OnePlus are treated as the same explicit brand', () => {
  const result = calculateMatchScore(
    { name: 'One Plus red charger', category: 'electronics', description: 'One Plus red charging cable' },
    { name: 'OnePlus red charger', category: 'electronics', description: 'OnePlus red charging cable' }
  );
  assert.notEqual(result.identityConflict, true);
  assert.equal(result.propertyBreakdown.brand, 100);
});

test('OnePlus and Vivo remain distinct explicit brands', () => {
  const result = calculateMatchScore(
    { name: 'One Plus red charger', category: 'electronics', description: 'One Plus red charging cable' },
    { name: 'Vivo black charger', category: 'electronics', description: 'Vivo black charging cable' }
  );
  assert.equal(result.identityConflict, true);
});
