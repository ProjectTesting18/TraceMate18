const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeBrand, extractProperties } = require('../src/advanced-cnn/matchingServiceCompat');

const adminJsCode = fs.readFileSync(path.join(__dirname, '../js/admin.js'), 'utf8');
const formatMatch = adminJsCode.match(/function formatAdminImageSimilarity[\s\S]*?\n\}/);
assert.ok(formatMatch, 'formatAdminImageSimilarity must exist in js/admin.js');
const formatAdminImageSimilarity = new Function(`return (${formatMatch[0]})`)();

test('image formatter reports no photos when both reports lack images', () => {
  assert.equal(formatAdminImageSimilarity(null, false, false), 'No photos provided');
});
test('image formatter reports missing lost-report photo', () => {
  assert.equal(formatAdminImageSimilarity(null, false, true), 'No photo on lost report');
});
test('image formatter reports missing found-report photo', () => {
  assert.equal(formatAdminImageSimilarity(null, true, false), 'No photo on found report');
});
test('image formatter reports unavailable score when both images exist', () => {
  assert.equal(formatAdminImageSimilarity(null, true, true), 'Image similarity unavailable');
});
test('image formatter displays numeric similarity with one decimal place', () => {
  assert.equal(formatAdminImageSimilarity(0, true, true), '0.0%');
  assert.equal(formatAdminImageSimilarity(0.846, true, true), '84.6%');
});
test('normalizeBrand canonicalizes One Plus and OnePlus', () => {
  assert.equal(normalizeBrand('One Plus'), 'oneplus');
  assert.equal(normalizeBrand('OnePlus'), 'oneplus');
});
test('normalizeBrand keeps Vivo distinct from OnePlus', () => {
  assert.equal(normalizeBrand('Vivo'), 'vivo');
  assert.notEqual(normalizeBrand('Vivo'), normalizeBrand('One Plus'));
});
test('extractProperties recognizes One Plus and OnePlus in descriptions', () => {
  assert.ok(extractProperties({ description: 'One Plus phone with logo' }).brands.includes('oneplus'));
  assert.ok(extractProperties({ description: 'OnePlus phone with logo' }).brands.includes('oneplus'));
});
