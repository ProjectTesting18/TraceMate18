const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const match = appSource.match(/function decodeLegacyHtmlEntities\(value\)\s*\{[\s\S]*?\n\}/);
assert.ok(match, 'decodeLegacyHtmlEntities must exist in app.js');
const decodeLegacyHtmlEntities = vm.runInNewContext(`${match[0]}; decodeLegacyHtmlEntities`);

test('decodes the exact numeric entity examples from AI Match Candidates', () => {
  assert.equal(decodeLegacyHtmlEntities('charge&#x72;'), 'charger');
  assert.equal(decodeLegacyHtmlEntities('&#x53;ame category'), 'Same category');
  assert.equal(decodeLegacyHtmlEntities('&#x4D;ultiple shared object terms'), 'Multiple shared object terms');
  assert.equal(decodeLegacyHtmlEntities('&#128994;'), '🟢');
});

test('decodes nested and repeated entities without parsing text as HTML', () => {
  assert.equal(decodeLegacyHtmlEntities('&amp;#x53;ame category'), 'Same category');
  assert.equal(decodeLegacyHtmlEntities('&amp;amp;#x53;ame category'), 'Same category');
  assert.equal(decodeLegacyHtmlEntities('&amp;#128994;'), '🟢');
  assert.equal(decodeLegacyHtmlEntities('&lt;script&gt;alert(1)&lt;/script&gt;'), '<script>alert(1)</script>');
});
