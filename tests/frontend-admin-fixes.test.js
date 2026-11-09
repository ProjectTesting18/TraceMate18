const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appCode = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
const familyMatch = appCode.match(/function getLocalObjectFamily\(item = \{\}\) \{[\s\S]*?\n\}/);
assert.ok(familyMatch, 'getLocalObjectFamily must exist');
const getLocalObjectFamily = new Function(`return (${familyMatch[0]})`)();

test('frontend distinguishes paper notebooks from notebook computers', () => {
  assert.equal(getLocalObjectFamily({ name: 'Classmate notebook' }), 'notebook');
  assert.equal(getLocalObjectFamily({ name: 'exercise book' }), 'notebook');
  assert.equal(getLocalObjectFamily({ name: 'notebook computer' }), 'laptop');
  assert.equal(getLocalObjectFamily({ name: 'MacBook Air' }), 'laptop');
});

test('frontend recognizes helmet, mouse, brush, bottle, and watch', () => {
  assert.equal(getLocalObjectFamily({ name: 'Studds motorcycle helmet' }), 'helmet');
  assert.equal(getLocalObjectFamily({ name: 'Logitech wireless mouse' }), 'mouse');
  assert.equal(getLocalObjectFamily({ name: 'Sounce cleaning brush' }), 'brush');
  assert.equal(getLocalObjectFamily({ name: 'water bottle' }), 'bottle');
  assert.equal(getLocalObjectFamily({ name: 'smartwatch' }), 'watch');
});

const adminCode = fs.readFileSync(path.join(__dirname, '../js/admin.js'), 'utf8');
const formatterMatch = adminCode.match(/function formatAdminImageSimilarity\([\s\S]*?\n\}/);
assert.ok(formatterMatch, 'formatAdminImageSimilarity must exist');
const formatAdminImageSimilarity = new Function(`return (${formatterMatch[0]})`)();

test('admin image similarity formatter handles missing images and unavailable scores', () => {
  assert.equal(formatAdminImageSimilarity(null, { hasLostPhoto: false, hasFoundPhoto: false }), 'No photos provided');
  assert.equal(formatAdminImageSimilarity(null, { hasLostPhoto: false, hasFoundPhoto: true }), 'No photo on lost report');
  assert.equal(formatAdminImageSimilarity(null, { hasLostPhoto: true, hasFoundPhoto: false }), 'No photo on found report');
  assert.equal(formatAdminImageSimilarity(null), 'Image similarity unavailable');
  assert.equal(formatAdminImageSimilarity(0.846), '84.6%');
  assert.equal(formatAdminImageSimilarity(84.6), '84.6%');
});

test('admin confirmation has a receipt guard and server enforces receipt too', () => {
  assert.match(adminCode, /foundStatus !== 'received_by_admin'/);
  const serverCode = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.match(serverCode, /found\.status !==\s*'received_by_admin'[\s\S]{0,160}Admin must receive the physical item first/);
});
