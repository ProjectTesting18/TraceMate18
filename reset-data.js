'use strict';

/**
 * Start TraceMate with a clean lost-and-found history while preserving every
 * existing account (including password hashes/salts). Active sessions are
 * cleared so everyone signs in again after the reset.
 *
 * Run: npm run reset:data
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const { getDataDir } = require('./src/storagePaths');

const ROOT = __dirname;
const DATA_DIR = getDataDir(ROOT);
const DB_PATH = path.join(DATA_DIR, 'db.json');
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || 'admin@campus.edu').trim().toLowerCase();

function readCurrentDatabase() {
  if (!fs.existsSync(DB_PATH)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    throw new Error(`Could not read ${DB_PATH}; refusing to overwrite possibly recoverable data. ${error.message}`);
  }
}

function preserveUsers(current) {
  const byId = new Map();
  for (const user of Array.isArray(current.users) ? current.users : []) {
    if (!user || typeof user !== 'object' || !user.id || !user.email) continue;
    // Keep original account records intact, including passwordHash/passwordSalt.
    byId.set(String(user.id), user);
  }

  if (!Array.from(byId.values()).some(user =>
    String(user.email).trim().toLowerCase() === ADMIN_EMAIL &&
    String(user.role || '').toLowerCase() === 'admin'
  )) {
    // The server's ensureAdminUser() will ensure the configured admin account
    // exists on startup. Do not invent a password or a fake password hash here.
    byId.set('u_admin', {
      id: 'u_admin',
      name: 'Administrator',
      email: ADMIN_EMAIL,
      role: 'admin',
      studentId: 'ADM-001',
      joined: new Date().toISOString().slice(0, 10)
    });
  }

  return Array.from(byId.values());
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const current = readCurrentDatabase();
  const users = preserveUsers(current);

  // Keep a backup before clearing history, for recovery if the wrong database
  // directory was configured. This backup is not included in the source ZIP.
  if (fs.existsSync(DB_PATH)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(DATA_DIR, `db.before-clean-start-${stamp}.json`);
    fs.copyFileSync(DB_PATH, backupPath);
    console.log(`Previous database backed up to: ${backupPath}`);
  }

  const clean = {
    users,
    lost_items: [],
    found_items: [],
    claims: [],
    sessions: {}
  };

  fs.writeFileSync(DB_PATH, `${JSON.stringify(clean, null, 2)}\n`, 'utf8');
  console.log(`Persistent TraceMate database reset: ${DB_PATH}`);
  console.log(`Preserved ${users.length} account(s), including existing login credentials.`);
  console.log('Cleared lost items, found items, claims/matches, and active sessions.');
  console.log('Users must sign in again. Existing account passwords are unchanged.');

  // MongoDB is optional. If explicitly configured, clear only workflow data;
  // never delete users because the request is to preserve login accounts.
  if (process.env.MONGO_URI && process.env.MONGO_DB_NAME) {
    const client = new MongoClient(process.env.MONGO_URI);
    try {
      await client.connect();
      const db = client.db(process.env.MONGO_DB_NAME);
      for (const collectionName of ['lost_items', 'found_items', 'claims', 'sessions']) {
        await db.collection(collectionName).deleteMany({});
      }
      console.log(`Cleared lost/found history in optional MongoDB database ${process.env.MONGO_DB_NAME}; users preserved.`);
    } finally {
      await client.close();
    }
  }
}

main().catch(error => {
  console.error('Clean start failed:', error.message);
  process.exit(1);
});
