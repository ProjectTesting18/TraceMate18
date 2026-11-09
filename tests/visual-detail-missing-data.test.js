const test = require('node:test');
const assert = require('node:assert/strict');
const { compareVisualDetails, colorSimilarity, shapeSimilarity } = require('../src/advanced-cnn/visualDetailMatching');

test('null and blank numeric descriptors remain unavailable instead of matching as zero', () => {
  const lost = { color: { mean_rgb: [null, '', '  '], hue: null, saturation: null, brightness: null }, shape: { aspect_ratio: null, fill_ratio: '', edge_density: undefined } };
  const found = { color: { mean_rgb: [null, '', '  '], hue: null, saturation: null, brightness: null }, shape: { aspect_ratio: null, fill_ratio: '', edge_density: undefined } };
  assert.equal(colorSimilarity(lost, found).available, false);
  assert.equal(shapeSimilarity(lost, found).available, false);
});

test('missing fine visual descriptors do not produce a false 100 percent match', () => {
  const lost = { available: true, color: { mean_rgb: [null, null, null], hue: null, saturation: null, brightness: null }, shape: { aspect_ratio: null, fill_ratio: null, edge_density: null }, regions: {}, ocr: { text: '', tokens: [] } };
  const found = { available: true, color: { mean_rgb: [null, null, null], hue: null, saturation: null, brightness: null }, shape: { aspect_ratio: null, fill_ratio: null, edge_density: null }, regions: {}, ocr: { text: '', tokens: [] } };
  const result = compareVisualDetails(lost, found);
  assert.equal(result.available, false);
  assert.equal(result.percentage, null);
});
