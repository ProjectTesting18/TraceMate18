// Reset TraceMate to a clean state.
// Keeps only the generic admin account.
// Removes old users, lost/found items, claims and sessions.

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const ROOT = __dirname;
const DB_PATH = path.join(ROOT, 'data', 'db.json');

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@campus.edu';

const clean = {
  users: [
    {
      id: 'u_admin',
      name: 'Administrator',
      email: ADMIN_EMAIL,
      role: 'admin',
      studentId: 'ADM-001',
      joined: new Date().toISOString().slice(0, 10)
    }
  ],
  lost_items: [],
  found_items: [],
  claims: [],
  sessions: {}
};

async function main() {
  // Reset local JSON database
  fs.writeFileSync(
    DB_PATH,
    JSON.stringify(clean, null, 2),
    'utf8'
  );

  console.log('Local db.json reset.');

  // Reset MongoDB
  if (process.env.MONGO_URI && process.env.MONGO_DB_NAME) {
    const client = new MongoClient(process.env.MONGO_URI);

    try {
      await client.connect();

      const db = client.db(process.env.MONGO_DB_NAME);

      for (const collectionName of [
        'users',
        'lost_items',
        'found_items',
        'claims',
        'sessions'
      ]) {
        await db.collection(collectionName).deleteMany({});
      }

      await db.collection('users').insertOne(clean.users[0]);

      console.log(
        `MongoDB ${process.env.MONGO_DB_NAME} reset; generic admin preserved.`
      );
    } finally {
      await client.close();
    }
  }

  console.log('Clean start complete.');
  console.log('Register a new student account from the app.');
}

main().catch((error) => {
  console.error('Reset failed:', error.message);
  process.exit(1);
});