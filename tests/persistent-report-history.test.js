'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { getDataDir } = require('../src/storagePaths');
const { prepareReportsWithHistory } = require('../src/reportHistory');

const ROOT = path.resolve(__dirname, '..');

test('Windows database location stays outside each extracted project folder', () => {
  const dir = getDataDir(ROOT, { APPDATA: 'C:\\Users\\Student\\AppData\\Roaming' }, 'win32', 'C:\\Users\\Student');
  assert.equal(dir, path.win32.join('C:\\Users\\Student\\AppData\\Roaming', 'TraceMate', 'data'));
  assert.equal(getDataDir(ROOT, { TRACEMATE_DATA_DIR: 'D:\\TraceMateData' }, 'win32', 'C:\\Users\\Student'), 'D:\\TraceMateData');
});

test('new lost/found reports persist creation details and history without copying contact data into snapshots', () => {
  const now = '2026-10-31T12:00:00.000Z';
  const [created] = prepareReportsWithHistory([], [{
    id: 'headphone-1', name: 'black headphone', category: 'Electronics',
    location: 'classroom', desc: 'black Swiss Military headphones',
    color: 'Black', brand: 'Swiss Military', features: 'USB type jack',
    image: 'data:image/jpeg;base64,abc', contact: '9999999999', contactHidden: true
  }], 'lost_items', now);

  assert.equal(created.createdAt, now);
  assert.equal(created.history.length, 1);
  assert.equal(created.history[0].event, 'created');
  assert.equal(created.timeline[0].event, 'Lost report created');
  assert.equal(created.history[0].snapshot.name, 'black headphone');
  assert.equal(created.history[0].snapshot.photoAttached, true);
  assert.equal('contact' in created.history[0].snapshot, false);

  const editedAt = '2026-10-31T13:00:00.000Z';
  const [edited] = prepareReportsWithHistory([created], [{
    ...created, color: 'White', image: 'data:image/jpeg;base64,def'
  }], 'lost_items', editedAt);
  assert.equal(edited.createdAt, now, 'original creation time is preserved');
  assert.equal(edited.updatedAt, editedAt);
  assert.deepEqual(edited.history[1].changedFields.sort(), ['color', 'photo']);
  assert.equal(edited.history[1].snapshot.color, 'White');
  assert.equal(edited.timeline.at(-1).event, 'Lost report updated');
});

test('unchanged report saves do not create noisy history entries', () => {
  const now = '2026-10-31T12:00:00.000Z';
  const [created] = prepareReportsWithHistory([], [{ id: 'found-1', name: 'headphone', category: 'Electronics', location: 'classroom' }], 'found_items', now);
  const [unchanged] = prepareReportsWithHistory([created], [{ ...created }], 'found_items', '2026-10-31T13:00:00.000Z');
  assert.equal(unchanged.history.length, 1);
  assert.equal(unchanged.updatedAt, created.updatedAt);
});

test('server and client use durable storage and explicit deletes instead of wiping collections from stale clients', () => {
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const dbClient = fs.readFileSync(path.join(ROOT, 'js', 'db.js'), 'utf8');
  assert.match(server, /getDataDir\(ROOT\)/);
  assert.match(server, /omittedExisting/);
  assert.match(server, /req\.method === 'DELETE'/);
  assert.match(dbClient, /removeItem\(key, id\)/);
  assert.doesNotMatch(dbClient, /DB\.get\(\$\{key\}\) failed[\s\S]{0,200}return \[\]/);
});
