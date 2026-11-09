const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'js/admin.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');

test('confirmed notification review is pinned to the exact lost/found pair', () => {
  assert.match(app, /function showConfirmedMatchPrompt\(notificationId, foundItemId, lostItemId/);
  assert.match(app, /const lost = \(DB\.get\('lost_items'\) \|\| \[\]\)\.find\(item => String\(item\.id\) === String\(lostItemId\)\)/);
  assert.match(app, /showConfirmedMatchPrompt\(notificationId, foundItemId, exactLostId, notification\)/);
  assert.match(app, /No other lost items are shown here/);
});

test('confirmed match approve and reject actions are wired to handlers', () => {
  assert.match(app, /function approveConfirmedMatch\(/);
  assert.match(app, /function rejectConfirmedMatch\(/);
  assert.match(app, /onclick="approveConfirmedMatch\(/);
  assert.match(app, /onclick="rejectConfirmedMatch\(/);
});

test('admin return flow uses matched owner record and does not prompt for Student ID or email', () => {
  const returnFn = admin.slice(admin.indexOf('async function returnMatchedItem(foundId)'), admin.indexOf('// ADMIN RENDER WRAPPER', admin.indexOf('async function returnMatchedItem(foundId)')));
  assert.doesNotMatch(returnFn, /prompt\([^)]*Student ID/i);
  assert.doesNotMatch(returnFn, /prompt\([^)]*email/i);
  assert.match(returnFn, /ownerEmail/);
  assert.match(returnFn, /Collection note \(optional\)/);
  assert.match(server, /const verificationMethod = 'matched_owner_account'/);
  assert.match(server, /const verifiedOwnerEmail = String\(owner\.email \|\| ''\)/);
});

test('confirmed match review layout stacks comparison cards on mobile', () => {
  assert.match(css, /\.match-card-claim \.admin-compare-grid \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 640px\) \{[\s\S]*?\.match-card-claim \.admin-compare-grid \{ grid-template-columns: minmax\(0, 1fr\)/);
});
