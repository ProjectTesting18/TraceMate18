const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('admin evidence renderer marks low-confidence and low-text evidence as warnings', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'admin.js'), 'utf8');
  assert.match(source, /low\[- \]confidence/);
  assert.match(source, /low \(\?:combined \)\?text similarity/);
  assert.match(source, /manual review/);
});

test('admin score cards distinguish NLP model similarity from combined text score', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'admin.js'), 'utf8');
  assert.match(source, /NLP model similarity \(separate from combined text score\)/);
  assert.match(source, /Visual feature similarity; not proof of item identity/);
});

test('AI-estimated color explanation does not override reported color differences', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'advanced-cnn', 'matchingServiceCompat.js'), 'utf8');
  assert.match(source, /AI visual color estimates agree:.*explicit reported primary-color conflict remains unresolved/);
  assert.match(source, /red and white describe different charging-accessory components/);
  assert.match(source, /image estimate only; not proof of item identity/);
});

test('admin detail list avoids repeating warnings already shown in the review banner', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'admin.js'), 'utf8');
  assert.match(source, /const evidenceReasons = reasons\.filter/);
  assert.match(source, /reviewWarningKinds\.has\('color'\)/);
  assert.match(source, /reviewWarningKinds\.has\('text'\)/);
});


test('admin audit displays explicit reasons for the recommended score cap', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'admin.js'), 'utf8');
  assert.match(source, /Why this score cap applies/);
  assert.match(source, /recommendedScoreCapReasons/);
  assert.match(source, /The matcher applied a conservative evidence-based score limit/);
});
