'use strict';

// Import reports from an older extracted TraceMate folder into the shared
// persistent database used by the current version. Existing IDs are retained
// and not overwritten, so running this twice will not duplicate reports.
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./src/storagePaths');

const sourcePath = process.argv[2] ? path.resolve(process.argv[2]) : '';
if (!sourcePath) {
  console.error('Usage: node migrate-data.js "C:\\path\\to\\old-TraceMate\\data\\db.json"');
  process.exit(2);
}
if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
  console.error(`Source database not found: ${sourcePath}`);
  process.exit(2);
}

function mergeById(current, incoming, key) {
  const output = Array.isArray(current) ? current.slice() : [];
  const ids = new Set(output.map(row => row && (row.id || row.email)).filter(Boolean).map(String));
  for (const row of Array.isArray(incoming) ? incoming : []) {
    if (!row || typeof row !== 'object') continue;
    const identity = row.id || row.email;
    if (!identity || !ids.has(String(identity))) {
      output.push(row);
      if (identity) ids.add(String(identity));
    }
  }
  return output;
}

function main() {
  const imported = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const dataDir = getDataDir(__dirname);
  const destinationPath = path.join(dataDir, 'db.json');
  fs.mkdirSync(dataDir, { recursive: true });

  let current = { users: [], lost_items: [], found_items: [], claims: [], sessions: {} };
  if (fs.existsSync(destinationPath)) {
    current = JSON.parse(fs.readFileSync(destinationPath, 'utf8'));
  }

  const merged = {
    users: mergeById(current.users, imported.users, 'users'),
    lost_items: mergeById(current.lost_items, imported.lost_items, 'lost_items'),
    found_items: mergeById(current.found_items, imported.found_items, 'found_items'),
    claims: mergeById(current.claims, imported.claims, 'claims'),
    sessions: { ...(current.sessions || {}), ...(imported.sessions || {}) }
  };

  const temp = `${destinationPath}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  fs.renameSync(temp, destinationPath);

  console.log(`Imported database: ${sourcePath}`);
  console.log(`Persistent database: ${destinationPath}`);
  console.log(`Added ${merged.lost_items.length - (current.lost_items || []).length} lost report(s), ${merged.found_items.length - (current.found_items || []).length} found report(s), and ${merged.claims.length - (current.claims || []).length} claim(s).`);
  console.log('Existing records with the same ID were preserved; import can safely be repeated.');
}

try { main(); } catch (error) {
  console.error(`Migration failed: ${error.message}`);
  process.exit(1);
}
