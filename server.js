const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getDataDir } = require('./src/storagePaths');
const { prepareReportsWithHistory } = require('./src/reportHistory');
require('dotenv').config();

const PORT = process.env.PORT || 5000;
const { resolveAIServiceUrl } = require('./src/advanced-cnn/aiServiceUrl');

async function fetchAiHealth(url, timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const data = await response.json();
    return { status: response.status, data };
  } finally {
    clearTimeout(timer);
  }
}

const ROOT = __dirname;

const PROJECT_DATA_DIR = path.join(ROOT, 'data');
const DATA_DIR = getDataDir(ROOT);
const DB_PATH = path.join(DATA_DIR, 'db.json');
const LEGACY_DB_PATH = path.join(PROJECT_DATA_DIR, 'db.json');

const ALLOWED_COLLECTIONS = new Set([
  'users',
  'lost_items',
  'found_items',
  'claims'
]);


const ADMIN_EMAIL =
  process.env.ADMIN_EMAIL || 'admin@campus.edu';

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD || 'Admin@123';


const {
  requestEmbeddingFromDataUrl,
  requestLostNetClassificationFromDataUrl,
  requestImageTextSimilarityFromDataUrl,
  cosineSimilarity,
  similarityPercentage
} = require('./src/advanced-cnn/cnnBridge');


const {
  calculateMatchScore
} = require('./src/advanced-cnn/matchingServiceCompat');

const {
  requestTextSimilarity
} = require('./src/advanced-cnn/nlpBridge');

const {
  hasHardMatchConflict,
  selectAdminCandidatePool
} = require('./src/advanced-cnn/adminCandidateSelection');


/* =========================================================
   JSON DATABASE
   ========================================================= */

let usersCol;
let lostItemsCol;
let foundItemsCol;
let claimsCol;
let sessionsCol;


/* =========================================================
   CONFIGURATION
   ========================================================= */

function validateRuntimeConfig() {
  const errors = [];

  if (
    !ADMIN_PASSWORD ||
    typeof ADMIN_PASSWORD !== 'string' ||
    ADMIN_PASSWORD.length < 8
  ) {
    errors.push(
      'ADMIN_PASSWORD is missing or too short (min 8 chars)'
    );
  }

  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    if (ADMIN_PASSWORD === 'Admin@123') {
      errors.push('Set a unique ADMIN_PASSWORD in the production environment; the development default is forbidden');
    }
    if (!String(process.env.AI_SERVICE_URL || '').trim()) {
      errors.push('AI_SERVICE_URL is required in production');
    }
  }

  const parsedPort = Number(PORT);

  if (
    !Number.isInteger(parsedPort) ||
    parsedPort <= 0 ||
    parsedPort > 65535
  ) {
    errors.push(
      'PORT must be a valid number between 1 and 65535'
    );
  }

  if (errors.length) {
    throw new Error(
      `Invalid configuration: ${errors.join('; ')}`
    );
  }
}


/* =========================================================
   PASSWORD FUNCTIONS
   ========================================================= */

function validatePassword(password) {
  if (
    typeof password !== 'string' ||
    password.length < 8
  ) {
    return 'Password must be at least 8 characters long';
  }

  if (!/[a-z]/.test(password)) {
    return 'Password must include a lowercase letter';
  }

  if (!/[A-Z]/.test(password)) {
    return 'Password must include an uppercase letter';
  }

  if (!/\d/.test(password)) {
    return 'Password must include a number';
  }

  if (!/[^\w\s]/.test(password)) {
    return 'Password must include a special character';
  }

  return '';
}


function hashPassword(
  password,
  salt = crypto.randomBytes(16).toString('hex')
) {
  const hash = crypto
    .scryptSync(password, salt, 64)
    .toString('hex');

  return {
    salt,
    hash
  };
}


function verifyPassword(password, user) {
  if (
    user.passwordHash &&
    user.passwordSalt
  ) {
    const hash = crypto
      .scryptSync(
        password,
        user.passwordSalt,
        64
      )
      .toString('hex');

    return crypto.timingSafeEqual(
      Buffer.from(hash, 'hex'),
      Buffer.from(user.passwordHash, 'hex')
    );
  }

  return user.password === password;
}


/* =========================================================
   JSON DATABASE HELPERS
   ========================================================= */

function stripMongoId(doc) {
  if (!doc) return null;

  const {
    _id,
    ...rest
  } = doc;

  return rest;
}


function matchesJsonQuery(doc, query) {
  if (
    !query ||
    typeof query !== 'object' ||
    Array.isArray(query)
  ) {
    return true;
  }

  return Object.entries(query).every(
    ([key, value]) => {

      if (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value)
      ) {
        if ('$ne' in value) {
          return doc[key] !== value.$ne;
        }

        if ('$in' in value) {
          return Array.isArray(value.$in)
            ? value.$in.includes(doc[key])
            : true;
        }
      }

      return doc[key] === value;
    }
  );
}


function persistJsonData(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tempPath = `${DB_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tempPath, DB_PATH);
}


function loadJsonData() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  if (!fs.existsSync(DB_PATH)) {
    // One-time migration for an existing installation upgraded in place.
    // New ZIPs ship with an empty project-local db.json, so sample records are
    // never mistaken for the user's live database.
    if (fs.existsSync(LEGACY_DB_PATH)) {
      try {
        const legacy = JSON.parse(fs.readFileSync(LEGACY_DB_PATH, 'utf8'));
        const hasLegacyData = ['users', 'lost_items', 'found_items', 'claims'].some(
          key => Array.isArray(legacy[key]) && legacy[key].length > 0
        );
        if (hasLegacyData) {
          const migrated = {
            users: Array.isArray(legacy.users) ? legacy.users : [],
            lost_items: Array.isArray(legacy.lost_items) ? legacy.lost_items : [],
            found_items: Array.isArray(legacy.found_items) ? legacy.found_items : [],
            claims: Array.isArray(legacy.claims) ? legacy.claims : [],
            sessions: legacy.sessions && typeof legacy.sessions === 'object' ? legacy.sessions : {}
          };
          persistJsonData(migrated);
          console.log(`Migrated existing TraceMate records to persistent storage: ${DB_PATH}`);
          return migrated;
        }
      } catch (migrationError) {
        console.warn('Legacy TraceMate data could not be migrated:', migrationError.message);
      }
    }

    const emptyData = { users: [], lost_items: [], found_items: [], claims: [], sessions: {} };
    persistJsonData(emptyData);
    return emptyData;
  }

  try {
    const raw = fs.readFileSync(
      DB_PATH,
      'utf8'
    );

    const parsed = JSON.parse(raw);

    return {
      users: Array.isArray(parsed.users)
        ? parsed.users
        : [],

      lost_items: Array.isArray(parsed.lost_items)
        ? parsed.lost_items
        : [],

      found_items: Array.isArray(parsed.found_items)
        ? parsed.found_items
        : [],

      claims: Array.isArray(parsed.claims)
        ? parsed.claims
        : [],

      sessions:
        parsed.sessions &&
        typeof parsed.sessions === 'object'
          ? parsed.sessions
          : {}
    };
  } catch (error) {
    console.warn(
      'db.json could not be read. Creating a clean database.'
    );

    const emptyData = {
      users: [],
      lost_items: [],
      found_items: [],
      claims: [],
      sessions: {}
    };

    persistJsonData(emptyData);

    return emptyData;
  }
}


function createJsonCollection(
  name,
  dataRef
) {
  const state = dataRef[name] || [];

  return {

    async findOne(query = {}) {
      return (
        state.find(
          doc => matchesJsonQuery(doc, query)
        ) || null
      );
    },


    async countDocuments(query = {}) {
      return state.filter(
        doc => matchesJsonQuery(doc, query)
      ).length;
    },


    async insertOne(doc) {
      state.push({
        ...doc
      });

      persistJsonData(dataRef);

      return {
        insertedId: doc.id || null
      };
    },


    async insertMany(docs) {
      for (const doc of docs) {
        state.push({
          ...doc
        });
      }

      persistJsonData(dataRef);

      return {
        insertedCount: docs.length
      };
    },


    async deleteMany(query = {}) {
      const removed = state.filter(
        doc => matchesJsonQuery(doc, query)
      );

      if (
        !Object.keys(query || {}).length
      ) {
        state.splice(
          0,
          state.length
        );
      } else {
        const ids = new Set(
          removed.map(doc => doc.id)
        );

        for (
          let i = state.length - 1;
          i >= 0;
          i--
        ) {
          if (
            ids.has(state[i].id)
          ) {
            state.splice(i, 1);
          }
        }
      }

      persistJsonData(dataRef);

      return {
        deletedCount: removed.length
      };
    },


    async deleteOne(query = {}) {
      const index = state.findIndex(
        doc => matchesJsonQuery(doc, query)
      );

      if (index === -1) {
        return {
          deletedCount: 0
        };
      }

      state.splice(index, 1);

      persistJsonData(dataRef);

      return {
        deletedCount: 1
      };
    },


    async updateOne(query, update) {
      const index = state.findIndex(
        doc => matchesJsonQuery(doc, query)
      );

      if (index === -1) {
        return {
          matchedCount: 0,
          modifiedCount: 0
        };
      }

      const current = {
        ...state[index]
      };

      if (
        update &&
        update.$set
      ) {
        Object.assign(
          current,
          update.$set
        );
      }

      if (
        update &&
        update.$unset
      ) {
        Object.keys(update.$unset)
          .forEach(
            key => delete current[key]
          );
      }

      state[index] = current;

      persistJsonData(dataRef);

      return {
        matchedCount: 1,
        modifiedCount: 1
      };
    },


    async createIndex() {
      return null;
    },


    find(query = {}) {
      return {
        toArray() {
          return state.filter(
            doc =>
              matchesJsonQuery(
                doc,
                query
              )
          );
        }
      };
    }
  };
}


/* =========================================================
   JSON SESSION COLLECTION
   ========================================================= */

function createJsonSessionsCollection(dataRef) {
  return {

    async findOne(query = {}) {

      const token = query.token;

      if (
        token &&
        dataRef.sessions[token]
      ) {
        return {
          ...dataRef.sessions[token],
          token
        };
      }

      const entries =
        Object.entries(
          dataRef.sessions
        ).find(
          ([sessionToken, session]) => {

            if (
              !session ||
              typeof session !== 'object'
            ) {
              return false;
            }

            return Object.entries(
              query
            ).every(
              ([key, value]) => {

                if (key === 'token') {
                  return (
                    sessionToken === value
                  );
                }

                return (
                  session[key] === value
                );
              }
            );
          }
        );

      if (!entries) {
        return null;
      }

      const [
        sessionToken,
        session
      ] = entries;

      return {
        ...session,
        token: sessionToken
      };
    },


    async insertOne(doc) {
      dataRef.sessions[
        doc.token
      ] = {
        userId: doc.userId,
        createdAt:
          doc.createdAt ||
          new Date().toISOString()
      };

      persistJsonData(dataRef);

      return {
        insertedId: doc.token
      };
    },


    async deleteMany(query = {}) {
      let count = 0;

      for (
        const [
          token,
          session
        ] of Object.entries(
          dataRef.sessions
        )
      ) {

        if (
          matchesJsonQuery(
            {
              ...session,
              token
            },
            query
          )
        ) {
          delete dataRef.sessions[token];
          count++;
        }
      }

      persistJsonData(dataRef);

      return {
        deletedCount: count
      };
    },


    async deleteOne(query = {}) {
      const token = query.token;

      if (
        token &&
        dataRef.sessions[token]
      ) {
        delete dataRef.sessions[token];

        persistJsonData(dataRef);

        return {
          deletedCount: 1
        };
      }

      return {
        deletedCount: 0
      };
    },


    async countDocuments(query = {}) {
      return Object.entries(
        dataRef.sessions
      ).filter(
        ([token, session]) =>
          matchesJsonQuery(
            {
              ...session,
              token
            },
            query
          )
      ).length;
    },


    async createIndex() {
      return null;
    },


    find(query = {}) {
      return {
        toArray() {
          return Object.entries(
            dataRef.sessions
          )
            .map(
              ([token, session]) => ({
                ...session,
                token
              })
            )
            .filter(
              doc =>
                matchesJsonQuery(
                  doc,
                  query
                )
            );
        }
      };
    }
  };
}


/* =========================================================
   SETUP JSON DATABASE
   ========================================================= */

function setupJsonDatabase() {
  const dataRef = loadJsonData();

  usersCol =
    createJsonCollection(
      'users',
      dataRef
    );

  lostItemsCol =
    createJsonCollection(
      'lost_items',
      dataRef
    );

  foundItemsCol =
    createJsonCollection(
      'found_items',
      dataRef
    );

  claimsCol =
    createJsonCollection(
      'claims',
      dataRef
    );

  sessionsCol =
    createJsonSessionsCollection(
      dataRef
    );

  persistJsonData({
    users: dataRef.users,
    lost_items: dataRef.lost_items,
    found_items: dataRef.found_items,
    claims: dataRef.claims,
    sessions: dataRef.sessions
  });
}


/* =========================================================
   ADMIN ACCOUNT
   ========================================================= */

async function ensureAdminUser() {
  const existing =
    await usersCol.findOne({
      email: ADMIN_EMAIL,
      role: 'admin'
    });

  if (existing) {

    if (!existing.studentId) {
      await usersCol.updateOne(
        {
          id: existing.id
        },
        {
          $set: {
            studentId: 'ADM-001'
          }
        }
      );
    }

    return;
  }

  await usersCol.insertOne({
    id: 'u_admin',
    name: 'Administrator',
    email: ADMIN_EMAIL,
    role: 'admin',
    studentId: 'ADM-001',
    joined:
      new Date()
        .toISOString()
        .slice(0, 10)
  });
}


/* =========================================================
   VALIDATION HELPERS
   ========================================================= */

function isValidEmail(value) {
  if (typeof value !== 'string') return false;

  const email = value.trim().toLowerCase();

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}


function isValidIndianPhone(value) {
  if (!value) return true;

  if (/[a-zA-Z]/.test(value)) {
    return false;
  }

  const cleaned =
    String(value)
      .replace(/[\s-]/g, '');

  const digits =
    cleaned.replace(/\D/g, '');

  const startsWithIndiaCode =
    cleaned.startsWith('+91') ||
    cleaned.startsWith('91');

  if (startsWithIndiaCode) {
    return digits.length === 12;
  }

  return (
    digits.length === 10 ||
    digits.length === 12
  );
}


function validateItemContacts(
  key,
  items
) {
  if (
    key !== 'lost_items' &&
    key !== 'found_items'
  ) {
    return '';
  }

  if (!Array.isArray(items)) {
    return 'Items must be an array';
  }

  return '';
}


/* =========================================================
   AUTH
   ========================================================= */

function sanitizeUser(user) {
  if (!user) return null;

  const {
    password,
    passwordHash,
    passwordSalt,
    ...safeUser
  } = user;

  return safeUser;
}


function getToken(req) {
  const auth =
    req.headers.authorization || '';

  if (
    !auth.startsWith('Bearer ')
  ) {
    return null;
  }

  return auth
    .slice(7)
    .trim();
}


async function getAuthUser(req) {
  const token = getToken(req);

  if (!token) {
    return null;
  }

  const session =
    await sessionsCol.findOne({
      token
    });

  if (!session) {
    return null;
  }

  return usersCol.findOne({
    id: session.userId
  });
}


/* =========================================================
   STATIC FILE SERVER
   ========================================================= */

function contentTypeFor(filePath) {
  const ext =
    path.extname(filePath)
      .toLowerCase();

  switch (ext) {

    case '.html':
      return 'text/html; charset=utf-8';

    case '.css':
      return 'text/css; charset=utf-8';

    case '.js':
      return 'application/javascript; charset=utf-8';

    case '.json':
      return 'application/json; charset=utf-8';

    case '.png':
      return 'image/png';

    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';

    case '.svg':
      return 'image/svg+xml';

    case '.ico':
      return 'image/x-icon';

    default:
      return 'application/octet-stream';
  }
}


function serveStatic(req, res) {

  const reqPath =
    decodeURIComponent(
      new URL(
        req.url,
        'http://localhost'
      ).pathname
    );

  let filePath =
    path.join(
      ROOT,
      reqPath === '/'
        ? 'index.html'
        : reqPath.replace(
            /^\/+/,
            ''
          )
    );

  filePath =
    path.normalize(filePath);

  if (
    !filePath.startsWith(ROOT)
  ) {
    sendJson(
      res,
      403,
      {
        error: 'Forbidden'
      }
    );

    return;
  }

  if (
    !fs.existsSync(filePath) ||
    fs.statSync(filePath).isDirectory()
  ) {
    res.writeHead(
      404,
      {
        'Content-Type':
          'text/plain; charset=utf-8'
      }
    );

    res.end('Not found');

    return;
  }

  res.writeHead(
    200,
    {
      'Content-Type':
        contentTypeFor(filePath),
      // Prevent browsers from retaining stale admin.js after a repair/update.
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    }
  );

  fs.createReadStream(
    filePath
  ).pipe(res);
}


/* =========================================================
   REQUEST BODY
   ========================================================= */

function parseBody(req) {

  return new Promise(
    (resolve, reject) => {

      let data = '';

      req.on(
        'data',
        chunk => {

          data += chunk;

          if (
            data.length >
            5 * 1024 * 1024
          ) {
            reject(
              new Error(
                'Payload too large'
              )
            );
          }
        }
      );

      req.on(
        'end',
        () => {

          if (!data) {
            return resolve({});
          }

          try {
            resolve(
              JSON.parse(data)
            );
          } catch {
            reject(
              new Error(
                'Invalid JSON body'
              )
            );
          }
        }
      );

      req.on(
        'error',
        reject
      );
    }
  );
}


/* =========================================================
   RESPONSE HELPERS
   ========================================================= */

function sendJson(
  res,
  statusCode,
  payload
) {

  res.writeHead(
    statusCode,
    {
      'Content-Type':
        'application/json; charset=utf-8',

      'Cache-Control':
        'no-store',

      'Access-Control-Allow-Origin':
        '*',

      'Access-Control-Allow-Headers':
        'Content-Type, Authorization',

      'Access-Control-Allow-Methods':
        'GET, POST, PUT, OPTIONS'
    }
  );

  res.end(
    JSON.stringify(payload)
  );
}


function sendOptions(res) {

  res.writeHead(
    204,
    {
      'Access-Control-Allow-Origin':
        '*',

      'Access-Control-Allow-Headers':
        'Content-Type, Authorization',

      'Access-Control-Allow-Methods':
        'GET, POST, PUT, OPTIONS',

      'Access-Control-Max-Age':
        '86400'
    }
  );

  res.end();
}


/* =========================================================
   CNN FUNCTIONS
   ========================================================= */

async function enrichItemWithCNN(item) {

  if (!item || !item.image) {
    return item;
  }

  const currentImageHash = crypto.createHash('sha256').update(item.image, 'utf8').digest('hex');

  // LostNet cache: classify each image once per image content hash.
  const hasCurrentLostNetPrediction =
    item.lostNetImageHash === currentImageHash &&
    item.lostNetPrediction &&
    typeof item.lostNetPrediction.predicted_class === 'string' &&
    Number.isFinite(Number(item.lostNetPrediction.confidence));

  if (!hasCurrentLostNetPrediction) {
    try {
      const prediction =
        await requestLostNetClassificationFromDataUrl(item.image);

      if (
        prediction &&
        typeof prediction.predicted_class === 'string' &&
        prediction.predicted_class.trim()
      ) {
        item.lostNetPrediction = {
          model: prediction.model || 'LostNet',
          predicted_class: prediction.predicted_class.trim().toLowerCase(),
          confidence: Number(prediction.confidence),
          confidence_percent:
            Number.isFinite(Number(prediction.confidence_percent))
              ? Number(prediction.confidence_percent)
              : Number(prediction.confidence) * 100
        };

        item.lostNetImageHash = currentImageHash;
      }
    } catch (error) {
      // LostNet is optional: keep the existing matching pipeline operational.
      console.warn(
        `LostNet classification skipped for ${item.id || 'item'}: ${error.message}`
      );
    }
  }


  const hasMobileNet =
    Array.isArray(item.imageEmbedding) &&
    item.imageEmbedding.length > 0;

  const hasClip =
    Array.isArray(item.clipEmbedding) &&
    item.clipEmbedding.length > 0;

  const hasVisualRecognition =
    !!(
      item.visualRecognition &&
      typeof item.visualRecognition === 'object' &&
      Object.keys(item.visualRecognition).length > 0
    );

  const hasVisualDetails =
    !!(
      item.visualDetails &&
      typeof item.visualDetails === 'object' &&
      item.visualDetails.available === true
    );

  // Only skip AI enrichment when MobileNet, CLIP,
if (
    item.imageContentHash === currentImageHash &&
    hasMobileNet &&
  hasClip &&
  hasVisualRecognition &&
  hasVisualDetails) {
  return item;
}
  try {

    const result =
      await requestEmbeddingFromDataUrl(
        item.image
      );

    // MobileNetV2 embedding
    if (Array.isArray(result.embedding) && result.embedding.length) {
      item.imageEmbedding =
        result.embedding;

      item.imageEmbeddingModel =
        result.model ||
        'MobileNetV2';

      item.imageEmbeddingDimension =
        result.embeddingDimension ||
        result.embedding_dimension ||
        result.embedding.length;
    }

    // CLIP embedding
    if (Array.isArray(result.clipEmbedding) && result.clipEmbedding.length) {
      item.clipEmbedding =
        result.clipEmbedding;

      item.clipEmbeddingModel =
        result.clipEmbeddingModel ||
        result.clip_model ||
        'CLIP';

      item.clipEmbeddingDimension =
        result.clipEmbeddingDimension ||
        result.clip_embedding_dimension ||
        result.clipEmbedding.length;
    }

    // Store visual model metadata for debugging/UI.
    item.visualModels =
      Array.isArray(result.visualModels)
        ? result.visualModels
        : [];

    item.visualMethod =
  result.visualMethod ||
  null;

item.visualRecognition =
      result.visualRecognition ||
      result.visual_recognition ||
      item.visualRecognition ||
      item.visual_recognition ||
      null;

// TRACE_MATE_DETECTED_LABELS_FIX
// Only add an AI object label when confidence is at least 65%.
const recognition =
  item.visualRecognition &&
  typeof item.visualRecognition === 'object'
    ? item.visualRecognition
    : {};

const objectType = String(
  recognition.object_type ||
  recognition.objectType ||
  ''
).trim();

const confidence = Number(
  recognition.object_confidence ??
  recognition.objectConfidence ??
  0
);

const existingLabels = Array.isArray(item.detectedLabels)
  ? item.detectedLabels
  : [];
const objectCandidates = Array.isArray(recognition.object_candidates)
  ? recognition.object_candidates
  : Array.isArray(recognition.objectCandidates)
    ? recognition.objectCandidates
    : [];
const topObjectCandidate = objectCandidates[0] || null;
const topCandidateLabel = String(
  topObjectCandidate?.label || topObjectCandidate?.value || ''
).trim().replace(/^a[n]?\s+/i, '').toLowerCase();
const topCandidateConfidence = Number(
  topObjectCandidate?.confidence ?? topObjectCandidate?.score ?? 0
);
// CLIP's softmax confidence is distributed across many classes and is not a
// calibrated probability. Keep the top candidate as weak evidence when it is
// usable; the matcher caps low-confidence label matches to avoid overclaiming.
// CLIP confidence is a softmax across the full prompt vocabulary, so a
// useful top class can legitimately score below 0.12. Do not discard it just
// because the probability is small: retain it as weak evidence and let the
// matcher cap its contribution. Reject only missing/generic labels and
// malformed/non-positive confidence values.
const candidateLabelUsable = Boolean(
  topCandidateLabel &&
  !/^another object$/i.test(topCandidateLabel) &&
  Number.isFinite(topCandidateConfidence) &&
  topCandidateConfidence > 0
);
const selectedObjectLabel = confidence >= 0.65
  ? objectType.toLowerCase()
  : candidateLabelUsable
    ? topCandidateLabel
    : '';

item.detectedLabelConfidence = confidence >= 0.65
  ? confidence
  : candidateLabelUsable
    ? topCandidateConfidence
    : 0;
item.detectedLabels = [
  ...new Set([
    ...existingLabels,
    ...(selectedObjectLabel ? [selectedObjectLabel] : [])
  ])
];

item.clipAvailable =
  result.clipAvailable ??
  false;


    /*
     * Preserve generic fine-grained visual details
     * returned by the FastAPI CV service.
     */
    item.visualDetails =
      result.visualDetails ||
      result.visual_details ||
      item.visualDetails ||
      item.visual_details ||
      null;
    item.imageContentHash = currentImageHash;
    return item;

} catch (err) {

    console.warn(
      `CNN/CLIP embedding skipped for ${
        item.id || 'item'
      }: ${err.message}`
    );

    return item;
  }
}


async function enrichItemsWithCNN(items) {

  if (!Array.isArray(items)) {
    return items;
  }

  for (
    const item of items
  ) {
    await enrichItemWithCNN(item);
  }

  return items;
}


/* =========================================================
   TIMELINE
   ========================================================= */

function pushTimeline(
  item,
  event,
  extra = {}
) {

  if (
    !Array.isArray(item.timeline)
  ) {
    item.timeline = [];
  }

  const time = new Date().toISOString();
  item.timeline.push({ event, time, ...extra });
  if (!Array.isArray(item.history)) item.history = [];
  item.history.push({ event, time, details: { ...extra } });
  item.history = item.history.slice(-50);
}


function publicItem(item) {
  if (!item) return null;

  return {
    ...item
  };
}
function getAdminObjectFamily(item = {}) {
  const source = [
    item.name,
    item.itemName,
    item.title,
    item.desc,
    item.description,
    item.category,
    ...(Array.isArray(item.detectedLabels)
      ? item.detectedLabels
      : [])
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[-_]/g, ' ');

  if (
    /\b(wristwatch|wrist watch|smartwatch|smart watch|watch)\b/i.test(
      source
    )
  ) {
    return 'watch';
  }

  if (
    /\b(water bottle|bottle|flask|thermos|sipper)\b/i.test(
      source
    )
  ) {
    return 'bottle';
  }

  if (
    /\b(wallet|cardholder|card holder)\b/i.test(
      source
    )
  ) {
    return 'wallet';
  }

  if (
    /\b(backpack|back pack|schoolbag|school bag|rucksack|bag)\b/i.test(
      source
    )
  ) {
    return 'bag';
  }

  if (
    /\b(phone|mobile|cellphone|cell phone|smartphone|smart phone)\b/i.test(
      source
    )
  ) {
    return 'phone';
  }

  if (
    /\b(laptop|notebook computer|notebook)\b/i.test(
      source
    )
  ) {
    return 'laptop';
  }

  if (
    /\b(tablet|ipad)\b/i.test(
      source
    )
  ) {
    return 'tablet';
  }

  if (
    /\b(headphones|headphone|earbuds|earbud|earphones|earphone)\b/i.test(
      source
    )
  ) {
    return 'headphone';
  }

  if (
    /\b(keys|keychain|key chain|key)\b/i.test(
      source
    )
  ) {
    return 'key';
  }

  if (
    /\b(glasses|spectacles|eyeglasses|sunglasses)\b/i.test(
      source
    )
  ) {
    return 'glasses';
  }

  if (
    /\b(shoe|shoes|sneaker|sneakers|footwear)\b/i.test(
      source
    )
  ) {
    return 'shoe';
  }

  return null;
}

/* =========================================================
   ADMIN AI MATCHING HELPERS
   ========================================================= */

function normalizeAdminText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildAdminCandidateFingerprint(item = {}) {
  return [
    item.name,
    item.category,
    item.desc || item.description,
    item.location,
    item.date || item.lostDate
  ]
    .map(normalizeAdminText)
    .filter(Boolean)
    .join('|');
}

function adminCandidateText(item = {}) {
  return [
    item.name,
    item.category,
    item.desc || item.description
  ]
    .map(normalizeAdminText)
    .filter(Boolean)
    .join(' ');
}

function adminTokenSimilarity(a, b) {
  const aTokens = new Set(
    adminCandidateText(a)
      .split(' ')
      .filter(Boolean)
  );

  const bTokens = new Set(
    adminCandidateText(b)
      .split(' ')
      .filter(Boolean)
  );

  if (!aTokens.size || !bTokens.size) {
    return 0;
  }

  let intersection = 0;

  for (const token of aTokens) {
    if (bTokens.has(token)) {
      intersection += 1;
    }
  }

  return intersection /
    Math.max(aTokens.size, bTokens.size);
}

function areDuplicateAdminLostCandidates(a, b) {
  const itemA = a?.lostItem || a;
  const itemB = b?.lostItem || b;

  if (!itemA || !itemB) {
    return false;
  }

  if (itemA.id && itemB.id && itemA.id === itemB.id) {
    return true;
  }

  const familyA = getAdminObjectFamily(itemA);
  const familyB = getAdminObjectFamily(itemB);

  if (
    familyA &&
    familyB &&
    familyA !== familyB
  ) {
    return false;
  }

  const userA = String(itemA.userId || itemA.user_id || '');
  const userB = String(itemB.userId || itemB.user_id || '');

  const sameUser =
    !!userA &&
    !!userB &&
    userA === userB;

  const fingerprintA =
    buildAdminCandidateFingerprint(itemA);

  const fingerprintB =
    buildAdminCandidateFingerprint(itemB);

  if (
    fingerprintA &&
    fingerprintA === fingerprintB
  ) {
    return true;
  }

  /*
   * Only treat near-identical reports as duplicates when
   * they belong to the same user. This prevents two different
   * students who happen to lose similar wallets from being
   * incorrectly merged.
   */
  if (
    sameUser &&
    adminTokenSimilarity(itemA, itemB) >= 0.80
  ) {
    return true;
  }

  return false;
}

function dedupeAdminMatches(matches) {
  const output = [];

  const sorted = [...(Array.isArray(matches) ? matches : [])]
    .sort((a, b) => {
      const scoreA = Number(a?.score || 0);
      const scoreB = Number(b?.score || 0);
      return scoreB - scoreA;
    });

  for (const match of sorted) {
    const duplicate = output.some(existing =>
      areDuplicateAdminLostCandidates(
        existing,
        match
      )
    );

    if (!duplicate) {
      output.push(match);
    }
  }

  return output;
}

/* =========================================================
   ADMIN AI MATCHING
   ========================================================= */

async function getAdminFoundMatches(foundId) {

  const found = await foundItemsCol.findOne({
    id: foundId
  });

  if (!found) {
    throw new Error('Found item not found');
  }

  /*
   * Enrich the selected found item with:
   * - MobileNetV2
   * - CLIP
   * - visual recognition
   * - fine visual details
   */
  await enrichItemWithCNN(found);

  const lost = await lostItemsCol
    .find({})
    .toArray();

  console.info('[TraceMate][AdminMatches] source counts', {
    foundItemLoaded: Boolean(found),
    lostItemsLoaded: lost.length,
    foundItemIdPresent: Boolean(found.id),
    foundStatus: String(found.status || 'unknown').toLowerCase()
  });

  const excludedStatuses = new Set([
    'matched', 'resolved', 'returned', 'rejected', 'closed', 'cancelled', 'canceled'
  ]);
  // Keep the currently confirmed pair visible for inspection, but never offer
  // a lost report already matched to a different found item.
  const candidateLost = lost.filter(item => {
    const status = String(item.status || 'open').trim().toLowerCase();
    return found.matchedLostItemId === item.id || !excludedStatuses.has(status);
  });

  console.info('[TraceMate][AdminMatches] candidate selection', {
    eligibleLostCandidates: candidateLost.length,
    excludedLostCandidates: lost.length - candidateLost.length
  });

  await enrichItemsWithCNN(candidateLost);

  /*
   * Prefer candidates without hard identity/object conflicts. If every
   * eligible report has a hard conflict, return up to five review-only rows
   * instead of an empty modal. Those rows remain score 0 and non-confirmable.
   */
  const scoredCandidates = candidateLost
    .map(item => ({ item, result: calculateMatchScore(item, found) }))
    .filter(({ result }) => Boolean(result))
    .sort((a, b) => {
      const scoreA = Number(a.result?.score || 0);
      const scoreB = Number(b.result?.score || 0);
      if (scoreB !== scoreA) return scoreB - scoreA;
      return String(a.item?.name || '').localeCompare(String(b.item?.name || ''));
    });
  const conflictingCandidates = scoredCandidates.filter(({ result }) =>
    hasHardMatchConflict(result)
  );
  const preselectionConflicts = conflictingCandidates.length;

  // Local diagnostic detail helps distinguish genuine report-text conflicts
  // from classifier conflicts. Do not log image embeddings or full descriptions.
  console.info('[TraceMate][AdminMatches] hard-conflict details', {
    foundItemId: found.id,
    candidates: conflictingCandidates.map(({ item, result }) => ({
      lostItemId: item.id || null,
      lostItemName: item.name || item.itemName || item.title || null,
      score: Number(result.score || 0),
      identityConflict: result.identityConflict === true,
      identityConflictReason: result.identityConflictReason || null,
      objectFamilyConflict: result.objectFamilyConflict === true,
      objectConflict: result.objectConflict === true,
      lostObjectFamily: result.lostObjectFamily || null,
      foundObjectFamily: result.foundObjectFamily || null,
      explicitBrandConflict: result.explicitBrandConflict === true,
      reasons: Array.isArray(result.reasons) ? result.reasons.slice(0, 4) : []
    }))
  });

  const selection = selectAdminCandidatePool(scoredCandidates, { limit: 10, fallbackLimit: 5 });
  const reviewOnlyFallback = selection.reviewOnlyFallback;

  console.info('[TraceMate][AdminMatches] scored candidates', {
    scoredCandidates: scoredCandidates.length,
    hardConflictCandidates: preselectionConflicts,
    selectedCandidates: selection.candidates.length,
    reviewOnlyFallback
  });

  const matches = await Promise.all(
    selection.candidates.map(async ({ item, result: baseResult, eligibleForConfirmation: selectedEligible }) => {
      const result = await calculateHybridMatchResult(item, found);
      const hardConflictCandidate = hasHardMatchConflict(baseResult) || hasHardMatchConflict(result);
      const eligibleForConfirmation = selectedEligible === true && !hardConflictCandidate && !reviewOnlyFallback;
      const reviewReasons = Array.isArray(result.reviewReasons) ? [...result.reviewReasons] : [];
      if (hardConflictCandidate && !reviewReasons.some(reason => /hard conflict/i.test(String(reason)))) {
        reviewReasons.push('Hard identity/object conflict: shown for review only; confirmation is disabled.');
      }
      return {
        lostItem: publicItem(item),
        ...result,
        score: hardConflictCandidate ? 0 : result.score,
        eligibleForConfirmation,
        hardConflictCandidate,
        reviewRecommended: Boolean(result.reviewRecommended || hardConflictCandidate || reviewOnlyFallback),
        reviewReasons
      };
    })
  );

  // Only review-only fallback rows may carry hard conflicts; they are score 0
  // and cannot be confirmed through the admin UI.
  const safeMatches = matches.filter(match =>
    match.eligibleForConfirmation === true || match.hardConflictCandidate === true
  );

  /*
   * Remove duplicate/near-duplicate lost reports while keeping
   * the strongest-scoring candidate. Two different students are
   * NOT merged merely because they lost similar objects.
   */
  const dedupedMatches = dedupeAdminMatches(
    safeMatches
  );

  console.info('[TraceMate][AdminMatches] final results', {
    calculatedMatches: matches.length,
    safeMatches: safeMatches.length,
    dedupedMatches: dedupedMatches.length,
    reviewOnlyMatches: dedupedMatches.filter(match => match.hardConflictCandidate).length,
    confirmableMatches: dedupedMatches.filter(match => match.eligibleForConfirmation).length
  });

  return dedupedMatches
    .sort((a, b) => {
      const scoreA = Number(a.score || 0);
      const scoreB = Number(b.score || 0);

      if (scoreB !== scoreA) {
        return scoreB - scoreA;
      }

      return String(
        a.lostItem?.name || ''
      ).localeCompare(
        String(
          b.lostItem?.name || ''
        )
      );
    })
    .slice(0, 10);
}

/* =========================================================
   HYBRID AI MATCHING HELPERS
   ========================================================= */

function buildNlpMatchText(item) {
  if (!item || typeof item !== 'object') {
    return '';
  }

  const labels = Array.isArray(item.detectedLabels)
    ? item.detectedLabels
    : [];

  return [
    item.name || item.itemName || item.title,
    item.category,
    item.desc || item.description,
    item.details,
    item.color,
    item.brand,
    item.type,
    ...labels
  ]
    .filter(value => String(value || '').trim())
    .map(value => String(value).trim())
    .join('. ')
    .slice(0, 4000);
}


async function requestExternalNlpMatchScore(lostItem, foundItem) {
  const text1 = buildNlpMatchText(lostItem);
  const text2 = buildNlpMatchText(foundItem);

  if (!text1 || !text2) {
    return null;
  }

  try {
    const result = await requestTextSimilarity(text1, text2);

    const rawValue = Number(
      result.similarity_percent ??
      result.similarity_percentage ??
      result.similarity ??
      result.score
    );

    if (!Number.isFinite(rawValue)) {
      return null;
    }

    // Preserve compatibility with services returning either 0-1 or 0-100.
    const similarity = Math.max(
      0,
      Math.min(100, rawValue <= 1 ? rawValue * 100 : rawValue)
    );

    return {
      similarity,
      match: typeof result.match === "boolean" ? result.match : null,
      backend: result.backend ?? null,
      fallbackUsed: result.fallback_used ?? null
    };
  } catch (error) {
    console.warn(
      `External Python NLP matching unavailable: ${error.message}`
    );
    return null;
  }
}


async function calculateHybridMatchResult(
  lostItem,
  foundItem
) {
  const base = calculateMatchScore(
    lostItem,
    foundItem
  );

  // Keep the uncapped base calculation available for the audit and apply
  // external NLP before the final policy cap. The base matcher still returns
  // its own capped score for compatibility, but using that capped value as
  // the starting point hides the real score path and effectively applies the
  // same cap twice in the audit. Identity rejections remain score 0 below.
  const baseMatcherScoreAfterCap = Number(base?.score || 0);
  const advancedScore = Number(
    base?.scoreAudit?.scoreBeforeRecommendedCap ?? baseMatcherScoreAfterCap
  );

  /*
   * Preserve hard rejection rules from the existing
   * advanced matcher. Python NLP must never override
   * an object/identity conflict.
   */
  if (
    base?.identityConflict === true ||
    base?.objectFamilyConflict === true ||
    base?.objectConflict === true
  ) {
    return {
      ...base,
      score: 0,
      advancedScore: 0,
      pythonNlpScore: null,
      pythonNlpAdjustment: 0,
      pythonNlpUsed: false,
      hybridMethod: 'Advanced visual/rule gate'
    };
  }

  let pythonNlpScore = null;
  let pythonNlpMatch = null;
  let pythonNlpBackend = null;
  let pythonNlpFallbackUsed = null;
  let pythonNlpAdjustment = 0;

  /*
   * The existing matcher already contains 35 points
   * of text evidence plus its shared-text boost.
   * Therefore Python TF-IDF is used as a bounded
   * validation adjustment rather than another 0-100
   * score. This prevents double-counting text.
   *
   * Maximum adjustment: +/- 8 points.
   */
  if (advancedScore > 0) {
    const pythonNlpResult =
      await requestExternalNlpMatchScore(
        lostItem,
        foundItem
      );

    if (pythonNlpResult !== null) {
      pythonNlpScore = pythonNlpResult.similarity;
      pythonNlpMatch = pythonNlpResult.match;
      pythonNlpBackend = pythonNlpResult.backend;
      pythonNlpFallbackUsed = pythonNlpResult.fallbackUsed;

      pythonNlpAdjustment = Math.round(
        (pythonNlpScore - 50) * 0.16
      );

      pythonNlpAdjustment = Math.max(
        -8,
        Math.min(
          8,
          pythonNlpAdjustment
        )
      );
    }
  }

  let finalScore = advancedScore;

  if (pythonNlpScore !== null) {
    finalScore += pythonNlpAdjustment;
  }

  // Weak text evidence must not be outweighed by date/location and generic
  // helmet-shape similarity. Color disagreements are review warnings, not
  // automatic rejections, because photos/lighting can mislead CV models.
  const internalTextScore = Number(
    base?.nlpSimilarityPercentage ?? base?.nlpSimilarity
  );
  const textEvidenceScores = [internalTextScore, pythonNlpScore]
    .filter(value => Number.isFinite(value));
  const effectiveTextScore = textEvidenceScores.length
    ? Math.min(...textEvidenceScores)
    : null;
  // Only a conflict between colors explicitly reported in the item records
  // receives the strict confirmed-conflict cap. A CV-only color difference is
  // uncertain visual evidence: keep the matcher-provided 82% cap and still
  // recommend manual review below.
  const colorConflict = Boolean(base?.primaryColorConflict);
  const visualColorDifference = Boolean(base?.visualColorConflict);

  let recommendedScoreCap = Number.isFinite(Number(base?.recommendedScoreCap))
    ? Number(base.recommendedScoreCap)
    : 100;
  const recommendedScoreCapReasons = [
    ...(Array.isArray(base?.scoreAudit?.recommendedScoreCapReasons)
      ? base.scoreAudit.recommendedScoreCapReasons
      : [])
  ];
  if (effectiveTextScore !== null && effectiveTextScore < 45) {
    recommendedScoreCap = Math.min(recommendedScoreCap, 64);
    if (!recommendedScoreCapReasons.some(reason => /text evidence|text similarity/i.test(String(reason)))) {
      recommendedScoreCapReasons.push(
        `Effective text evidence is ${Math.round(effectiveTextScore)}%, below the 45% threshold; maximum score limited to 64%.`
      );
    }
  }
  if (colorConflict) {
    recommendedScoreCap = Math.min(recommendedScoreCap, 62);
    if (!recommendedScoreCapReasons.some(reason => /color conflict/i.test(String(reason)))) {
      recommendedScoreCapReasons.push('A confirmed color conflict limits the maximum score to 62%.');
    }
  }
  if (colorConflict && effectiveTextScore !== null && effectiveTextScore < 45) {
    recommendedScoreCap = Math.min(recommendedScoreCap, 54);
    if (!recommendedScoreCapReasons.some(reason => /both.*color|color.*text|combined/i.test(String(reason)))) {
      recommendedScoreCapReasons.push('Both weak text evidence and a confirmed color conflict apply; maximum score limited to 54%.');
    }
  }
finalScore = Math.max(
    0,
    Math.min(
      recommendedScoreCap,
      100,
      Math.round(finalScore)
    )
  );

  const reviewRecommended = Boolean(
    base?.reviewRecommended ||
    colorConflict ||
    visualColorDifference ||
    (effectiveTextScore !== null && effectiveTextScore < 45)
  );
  const reviewReasons = [
    ...(Array.isArray(base?.reviewReasons) ? base.reviewReasons : [])
  ];
  if (visualColorDifference && !reviewReasons.some(reason => /visual color difference|image-derived color|color difference/i.test(String(reason)))) {
    reviewReasons.push('Image-derived color estimates differ; lighting and background can affect this heuristic, so compare the original photos manually.');
  }
  if (pythonNlpScore !== null && pythonNlpScore < 45 &&
      !reviewReasons.some(reason => /text similarity/i.test(reason))) {
    reviewReasons.push(`Low external NLP text similarity (${pythonNlpScore}%)`);
  }
  const reasons = [...(Array.isArray(base?.reasons) ? base.reasons : [])];
  for (const reason of reviewReasons) {
    if (!reasons.includes(reason)) reasons.push(reason);
  }

  const confidence = finalScore >= 75
    ? 'high'
    : finalScore >= 45
      ? 'medium'
      : 'low';

  return {
    ...base,
    reasons,
    score: finalScore,
    confidence,
    advancedScore,
    pythonNlpScore,
    pythonNlpMatch,
    pythonNlpBackend,
    pythonNlpFallbackUsed,
    pythonNlpAdjustment,
    pythonNlpUsed: pythonNlpScore !== null,
    effectiveTextScore,
    recommendedScoreCap,
    reviewRecommended,
    reviewReasons,
    scoreAudit: {
      ...(base?.scoreAudit || {}),
      // Keep each stage distinct so the audit is mathematically readable:
      // raw component score -> base policy cap -> external NLP adjustment ->
      // final policy cap. `scoreBeforeRecommendedCap` remains the base
      // matcher's raw pre-cap score; it is no longer overwritten by the
      // post-NLP value.
      baseComponentTotal: Number(base?.scoreAudit?.baseComponentTotal ?? 0),
      sharedTextBoost: Number(base?.scoreAudit?.sharedTextBoost ?? 0),
      locationContextBoost: Number(base?.scoreAudit?.locationContextBoost ?? 0),
      visualContradictionPenalty: Number(base?.scoreAudit?.visualContradictionPenalty ?? 0),
      visualEvidenceFactor: base?.scoreAudit?.visualEvidenceFactor ?? null,
      scoreBeforeRecommendedCap: Number(base?.scoreAudit?.scoreBeforeRecommendedCap ?? advancedScore),
      baseMatcherScoreAfterCap,
      advancedScore,
      pythonNlpAdjustment,
      scoreBeforeFinalCap: Math.round(advancedScore + pythonNlpAdjustment),
      effectiveTextScore,
      recommendedScoreCap,
      recommendedScoreCapReasons: [...new Set(recommendedScoreCapReasons)],
      reviewRecommended,
      finalScore
    },
    hybridMethod:
      pythonNlpScore !== null
        ? 'Advanced matcher + bounded Python NLP validation'
        : 'Advanced matcher (Python NLP unavailable)'
  };
}


async function calculateHybridMatches(
  sourceItem,
  candidates,
  type
) {
  const normalizedCandidates = Array.isArray(candidates)
    ? candidates.filter(item => {
        const status = String(
          item?.status || 'open'
        )
          .trim()
          .toLowerCase();

        // Found reports received by the admin remain eligible for matching.
        // This does not approve a claim or bypass the admin workflow.
        return status === 'open' || (type === 'lost' && status === 'received_by_admin');
      })
    : [];

  if (!normalizedCandidates.length) {
    return [];
  }

  const source = {
    ...sourceItem
  };

  await enrichItemWithCNN(source);
  await enrichItemsWithCNN(normalizedCandidates);

  /*
   * First run the existing advanced matcher for all
   * candidates. Only the strongest candidates receive
   * the external Python NLP validation, preventing a
   * large number of NLP requests when the database grows.
   */
  const baseMatches = normalizedCandidates
    .map(candidate => {
      const lost = type === 'lost'
        ? source
        : candidate;

      const found = type === 'lost'
        ? candidate
        : source;

      const base = calculateMatchScore(
        lost,
        found
      );

      return {
        candidate,
        lost,
        found,
        base
      };
    })
    // Hard conflicts must not consume the top-10 candidate slots.
    .filter(({ base }) => Boolean(base) && !(
      base.identityConflict === true ||
      base.objectFamilyConflict === true ||
      base.objectConflict === true
    ))
    .sort((a, b) =>
      Number(b.base?.score || 0) -
      Number(a.base?.score || 0)
    );

  const candidatesForNlp =
    baseMatches.slice(0, 10);

  const hybridResults = await Promise.all(
    candidatesForNlp.map(async entry => {
      const hybrid = await calculateHybridMatchResult(
        entry.lost,
        entry.found
      );

      // Cross-modal path: one report may have text only while the
      // other has an image only. Use CLIP image-text similarity rather
      // than incorrectly reporting image-image similarity as unavailable.
      let crossModalScore = null;
      let crossModalError = null;
      const lostHasImage = typeof entry.lost?.image === 'string' &&
        entry.lost.image.startsWith('data:image/');
      const foundHasImage = typeof entry.found?.image === 'string' &&
        entry.found.image.startsWith('data:image/');
      const lostText = buildNlpMatchText(entry.lost);
      const foundText = buildNlpMatchText(entry.found);

      try {
        if (!lostHasImage && foundHasImage && lostText) {
          const result = await requestImageTextSimilarityFromDataUrl(
            entry.found.image,
            lostText
          );
          crossModalScore = Number(result.similarity_percentage);
        } else if (lostHasImage && !foundHasImage && foundText) {
          const result = await requestImageTextSimilarityFromDataUrl(
            entry.lost.image,
            foundText
          );
          crossModalScore = Number(result.similarity_percentage);
        }
      } catch (error) {
        crossModalError = error.message;
        console.warn(`Cross-modal image/text matching unavailable: ${error.message}`);
      }

      let crossModalAdjustment = 0;
      let finalScore = Number(hybrid.score || 0);
      if (Number.isFinite(crossModalScore)) {
        // Bounded adjustment only; CLIP similarity is evidence, not probability.
        crossModalAdjustment = Math.max(
          -6,
          Math.min(6, Math.round((crossModalScore - 50) * 0.12))
        );
        finalScore = Math.max(0, Math.min(100, finalScore + crossModalAdjustment));
      }
      if (Number.isFinite(Number(hybrid.recommendedScoreCap))) {
        finalScore = Math.min(finalScore, Number(hybrid.recommendedScoreCap));
      }
      const finalConfidence = finalScore >= 75
        ? 'high'
        : finalScore >= 45
          ? 'medium'
          : 'low';

      return {
        lostItem: publicItem(entry.lost),
        foundItem: publicItem(entry.found),
        ...hybrid,
        score: finalScore,
        confidence: finalConfidence,
        pipelineScoreAudit: {
          baseScore: hybrid.advancedScore ?? null,
          hybridScore: hybrid.score,
          pythonNlpAdjustment: hybrid.pythonNlpAdjustment ?? 0,
          crossModalAdjustment,
          recommendedScoreCap: hybrid.recommendedScoreCap ?? null,
          finalScore
        },
        crossModalScore: Number.isFinite(crossModalScore) ? crossModalScore : null,
        crossModalAdjustment,
        crossModalUsed: Number.isFinite(crossModalScore),
        crossModalMethod: Number.isFinite(crossModalScore) ? 'CLIP image-text cosine similarity' : null,
        crossModalError
      };
    })
  );

  return hybridResults
    // Defense in depth: never return a hard-conflict candidate.
    .filter(match => !(
      match.identityConflict === true ||
      match.objectFamilyConflict === true ||
      match.objectConflict === true
    ))
    .sort((a, b) =>
      Number(b.score || 0) -
      Number(a.score || 0)
    )
    .slice(0, 10);
}


/* =========================================================
   API
   ========================================================= */

async function handleApi(
  req,
  res
) {

  const url =
    new URL(
      req.url,
      'http://localhost'
    );


  /* -------------------------------------------------------
     OPTIONS
     ------------------------------------------------------- */

  if (
    req.method === 'OPTIONS'
  ) {
    return sendOptions(res);
  }


  /* -------------------------------------------------------
     HEALTH
     ------------------------------------------------------- */

  if (
    req.method === 'GET' &&
    url.pathname === '/api/health'
  ) {

    return sendJson(
      res,
      200,
      {
        ok: true,
        release: 'TraceMate-Complete-Fixed-v10',
        database: 'json',
        databaseFile: 'persistent application data directory',
        mongodbRequired: false
      }
    );
  }


  /* =======================================================
     LOGIN
     ======================================================= */

  if (
    req.method === 'POST' &&
    url.pathname ===
      '/api/auth/login'
  ) {

    const body =
      await parseBody(req);

    const email =
      (body.email || '')
        .trim()
        .toLowerCase();

    const password =
      body.password || '';


    /* ADMIN LOGIN */

    if (
      email ===
      ADMIN_EMAIL
    ) {

      // Preserve the currently configured/fallback admin password only.
      // Do not accept extra hard-coded alternate passwords.
      if (
        !ADMIN_PASSWORD ||
        password !== ADMIN_PASSWORD
      ) {
        return sendJson(
          res,
          401,
          {
            error:
              'Invalid email or password'
          }
        );
      }

      const adminUser =
        await usersCol.findOne({
          email:
            ADMIN_EMAIL,
          role: 'admin'
        });

      if (!adminUser) {

        return sendJson(
          res,
          500,
          {
            error:
              'Admin account is missing from the database'
          }
        );
      }

      const token =
        crypto.randomUUID();

      await sessionsCol.insertOne({
        token,
        userId:
          adminUser.id,
        createdAt:
          new Date().toISOString()
      });

      return sendJson(
        res,
        200,
        {
          token,
          user:
            sanitizeUser(
              adminUser
            )
        }
      );
    }


    /* STUDENT LOGIN */

    const user =
      await usersCol.findOne({
        email,
        role: {
          $ne: 'admin'
        }
      });

    if (
      !user ||
      !verifyPassword(
        password,
        user
      )
    ) {

      return sendJson(
        res,
        401,
        {
          error:
            'Invalid email or password'
        }
      );
    }


    /* Upgrade old plaintext password */

    if (
      user.password &&
      !user.passwordHash
    ) {

      const {
        salt,
        hash
      } =
        hashPassword(
          user.password
        );

      await usersCol.updateOne(
        {
          id: user.id
        },
        {
          $set: {
            passwordSalt:
              salt,

            passwordHash:
              hash
          },

          $unset: {
            password: ''
          }
        }
      );
    }


    const token =
      crypto.randomUUID();

    await sessionsCol.insertOne({
      token,
      userId:
        user.id,
      createdAt:
        new Date().toISOString()
    });


    return sendJson(
      res,
      200,
      {
        token,
        user:
          sanitizeUser(user)
      }
    );
  }


  /* =======================================================
     REGISTER
     ======================================================= */

  if (
    req.method === 'POST' &&
    url.pathname ===
      '/api/auth/register'
  ) {

    const body =
      await parseBody(req);

    const name =
      (body.name || '')
        .trim();

    const email =
      (body.email || '')
        .trim()
        .toLowerCase();

    const password =
      body.password || '';

    const studentId =
      String(
        body.studentId || ''
      ).trim();


    if (
      !name ||
      !email ||
      !password
    ) {

      return sendJson(
        res,
        400,
        {
          error:
            'Name, email, and password are required'
        }
      );
    }


    if (!isValidEmail(email)) {

      return sendJson(
        res,
        400,
        {
          error:
            'Enter a valid email address'
        }
      );
    }


    const passwordError =
      validatePassword(
        password
      );

    if (passwordError) {

      return sendJson(
        res,
        400,
        {
          error:
            passwordError
        }
      );
    }


    if (
      await usersCol.findOne({
        email
      })
    ) {

      return sendJson(
        res,
        409,
        {
          error:
            'Email already registered'
        }
      );
    }


    const {
      salt,
      hash
    } =
      hashPassword(
        password
      );


    const user = {

      id:
        `u_${Date.now().toString(36)}${Math.random()
          .toString(36)
          .slice(2, 6)}`,

      name,

      email,

      passwordSalt:
        salt,

      passwordHash:
        hash,

      role:
        'student',

      studentId: studentId || null,

      joined:
        new Date()
          .toISOString()
          .slice(0, 10)
    };


    await usersCol.insertOne(
      user
    );


    return sendJson(
      res,
      201,
      {
        message:
          'Account created successfully'
      }
    );
  }


  /* =======================================================
     FORGOT PASSWORD
     ======================================================= */

  if (
    req.method === 'POST' &&
    url.pathname ===
      '/api/auth/forgot'
  ) {

    const body =
      await parseBody(req);

    const email =
      (body.email || '')
        .trim()
        .toLowerCase();

    const newPassword =
      body.newPassword || '';

    const confirmPassword =
      body.confirmPassword || '';


    if (
      !email ||
      !newPassword ||
      !confirmPassword
    ) {

      return sendJson(
        res,
        400,
        {
          error:
            'Email and new password are required'
        }
      );
    }


    if (
      email ===
      ADMIN_EMAIL
    ) {

      return sendJson(
        res,
        403,
        {
          error:
            'Admin password cannot be reset here'
        }
      );
    }


    if (!isValidEmail(email)) {

      return sendJson(
        res,
        400,
        {
          error:
            'Enter a valid email address'
        }
      );
    }


    if (
      newPassword !==
      confirmPassword
    ) {

      return sendJson(
        res,
        400,
        {
          error:
            'Passwords do not match'
        }
      );
    }


    const passwordError =
      validatePassword(
        newPassword
      );

    if (passwordError) {

      return sendJson(
        res,
        400,
        {
          error:
            passwordError
        }
      );
    }


    const user =
      await usersCol.findOne({
        email,
        role: {
          $ne: 'admin'
        }
      });

    if (!user) {

      return sendJson(
        res,
        404,
        {
          error:
            'Account not found'
        }
      );
    }


    const {
      salt,
      hash
    } =
      hashPassword(
        newPassword
      );


    await usersCol.updateOne(
      {
        id:
          user.id
      },
      {
        $set: {
          passwordSalt:
            salt,

          passwordHash:
            hash
        },

        $unset: {
          password: ''
        }
      }
    );


    await sessionsCol.deleteMany({
      userId:
        user.id
    });


    return sendJson(
      res,
      200,
      {
        message:
          'Password updated successfully'
      }
    );
  }


  /* =======================================================
     DELETE CURRENT USER ACCOUNT
     ======================================================= */

  if (
    req.method === 'DELETE' &&
    url.pathname ===
      '/api/auth/account'
  ) {

    const user =
      await getAuthUser(req);

    if (!user) {

      return sendJson(
        res,
        401,
        {
          error:
            'Unauthorized'
        }
      );
    }


    if (user.role === 'admin') {

      return sendJson(
        res,
        403,
        {
          error:
            'The administrator account cannot be deleted here'
        }
      );
    }


    /*
     * Remove every active session for this account first.
     */
    await sessionsCol.deleteMany({
      userId:
        user.id
    });


    /*
     * Remove records that are directly associated with the
     * account when those records contain userId/ownerId.
     * The extra ownerId cleanup keeps the endpoint compatible
     * with older TraceMate records.
     */
    await lostItemsCol.deleteMany({
      userId:
        user.id
    });

    await lostItemsCol.deleteMany({
      ownerId:
        user.id
    });

    await foundItemsCol.deleteMany({
      userId:
        user.id
    });

    await foundItemsCol.deleteMany({
      ownerId:
        user.id
    });

    await claimsCol.deleteMany({
      userId:
        user.id
    });

    await claimsCol.deleteMany({
      ownerId:
        user.id
    });


    const result =
      await usersCol.deleteOne({
        id:
          user.id
      });

    if (!result.deletedCount) {

      return sendJson(
        res,
        404,
        {
          error:
            'Account not found'
        }
      );
    }


    return sendJson(
      res,
      200,
      {
        ok: true,
        message:
          'Account deleted successfully'
      }
    );
  }


  /* =======================================================
     CURRENT USER
     ======================================================= */

  if (
    req.method === 'GET' &&
    url.pathname ===
      '/api/auth/me'
  ) {

    const user =
      await getAuthUser(req);

    if (!user) {

      return sendJson(
        res,
        401,
        {
          error:
            'Unauthorized'
        }
      );
    }

    return sendJson(
      res,
      200,
      {
        user:
          sanitizeUser(user)
      }
    );
  }


  /* =======================================================
     LOGOUT
     ======================================================= */

  if (
    req.method === 'POST' &&
    url.pathname ===
      '/api/auth/logout'
  ) {

    const token =
      getToken(req);

    if (token) {

      await sessionsCol.deleteOne({
        token
      });
    }

    return sendJson(
      res,
      200,
      {
        ok: true
      }
    );
  }


  /* =======================================================
     DATABASE GET
     ======================================================= */

  if (
    req.method === 'GET' &&
    url.pathname.startsWith(
      '/api/db/'
    )
  ) {

    const key =
      url.pathname.replace(
        '/api/db/',
        ''
      );


    if (
      !ALLOWED_COLLECTIONS.has(
        key
      )
    ) {

      return sendJson(
        res,
        404,
        {
          error:
            'Unknown collection'
        }
      );
    }


    const collectionMap = {

      users:
        usersCol,

      lost_items:
        lostItemsCol,

      found_items:
        foundItemsCol,

      claims:
        claimsCol
    };


    const docs =
      await collectionMap[key]
        .find({})
        .toArray();


    return sendJson(
      res,
      200,
      {
        data:
          docs.map(
            stripMongoId
          )
      }
    );
  }


  /* =======================================================
     DELETE ONE LOST/FOUND REPORT
     ======================================================= */

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/db/')) {
    const parts = url.pathname.split('/').filter(Boolean);
    const key = parts[2];
    const itemId = decodeURIComponent(parts.slice(3).join('/'));

    if (!['lost_items', 'found_items'].includes(key) || !itemId) {
      return sendJson(res, 404, { error: 'Unknown report' });
    }

    const user = await getAuthUser(req);
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' });

    const collection = key === 'lost_items' ? lostItemsCol : foundItemsCol;
    const item = await collection.findOne({ id: itemId });
    if (!item) return sendJson(res, 404, { error: 'Report not found' });
    if (user.role !== 'admin' && item.userId !== user.id) {
      return sendJson(res, 403, { error: 'You can only delete your own report' });
    }

    await collection.deleteOne({ id: itemId });
    // Keep a lightweight deletion event in claims that reference this report,
    // rather than silently mutating or deleting claim history.
    const claims = await claimsCol.find({}).toArray();
    for (const claim of claims) {
      if (claim.lostItemId === itemId || claim.foundItemId === itemId) {
        const notes = String(claim.notes || '').trim();
        claim.notes = `${notes}${notes ? ' · ' : ''}${key === 'lost_items' ? 'Lost' : 'Found'} report deleted ${new Date().toISOString()}`;
        await claimsCol.updateOne({ id: claim.id }, { $set: claim });
      }
    }
    return sendJson(res, 200, { ok: true, deletedId: itemId });
  }


  /* =======================================================
     DATABASE PUT
     ======================================================= */

  if (
    req.method === 'PUT' &&
    url.pathname.startsWith(
      '/api/db/'
    )
  ) {

    const key =
      url.pathname.replace(
        '/api/db/',
        ''
      );


    if (
      !ALLOWED_COLLECTIONS.has(
        key
      )
    ) {

      return sendJson(
        res,
        404,
        {
          error:
            'Unknown collection'
        }
      );
    }


    const user =
      await getAuthUser(req);

    if (!user) {

      return sendJson(
        res,
        401,
        {
          error:
            'Unauthorized'
        }
      );
    }


    const body =
      await parseBody(req);


    if (
      !Array.isArray(
        body.data
      )
    ) {

      return sendJson(
        res,
        400,
        {
          error:
            'Payload must include data array'
        }
      );
    }


    const contactError =
      validateItemContacts(
        key,
        body.data
      );

    if (contactError) {

      return sendJson(
        res,
        400,
        {
          error:
            contactError
        }
      );
    }


    const collectionMap = {
      users: usersCol,
      lost_items: lostItemsCol,
      found_items: foundItemsCol,
      claims: claimsCol
    };

    const target = collectionMap[key];
    let dataToSave = body.data;

    if (key === 'lost_items' || key === 'found_items') {
      const existingItems = await target.find({}).toArray();
      dataToSave = prepareReportsWithHistory(existingItems, body.data, key);
      const submittedIds = new Set(dataToSave.map(item => String(item.id || '')).filter(Boolean));
      // A browser may have loaded an older collection before another user
      // submitted a report. Keep records absent from that stale payload; explicit
      // DELETE requests are the only way to remove a report.
      const omittedExisting = existingItems.filter(item => item.id && !submittedIds.has(String(item.id)));
      dataToSave = [...dataToSave, ...omittedExisting];
      await enrichItemsWithCNN(dataToSave);
    }

    const finalCollectionMap = {

      users:
        usersCol,

      lost_items:
        lostItemsCol,

      found_items:
        foundItemsCol,

      claims:
        claimsCol
    };

    const finalTarget = finalCollectionMap[key];
    await finalTarget.deleteMany({});

    if (dataToSave.length) {
      await finalTarget.insertMany(dataToSave.map(doc => ({ ...doc })));
    }


    return sendJson(
      res,
      200,
      {
        ok: true
      }
    );
  }


  /* =======================================================
     NLP TEXT SIMILARITY
     ======================================================= */

  if (
    req.method === 'POST' &&
    url.pathname === '/api/ai/text-similarity'
  ) {
    const body = await parseBody(req);
    const text1 = String(body.text1 || '').trim();
    const text2 = String(body.text2 || '').trim();

    if (!text1 || !text2) {
      return sendJson(res, 400, {
        success: false,
        error: 'text1 and text2 are required'
      });
    }

    try {
      const result = await requestTextSimilarity(text1, text2);
      return sendJson(res, 200, result);
    } catch (err) {
      // NLP is an enhancement endpoint. Return a clear service error
      // instead of crashing the Node server.
      return sendJson(res, 503, {
        success: false,
        error: `NLP service unavailable: ${err.message}`
      });
    }
  }


  /* =======================================================
     HYBRID AI AUTO MATCH
     ======================================================= */

  if (
    req.method === 'POST' &&
    url.pathname === '/api/ai/auto-match'
  ) {
    const user = await getAuthUser(req);

    if (!user) {
      return sendJson(res, 401, {
        success: false,
        error: 'Authentication required'
      });
    }

    const body = await parseBody(req);
    const type = body.type === 'found'
      ? 'found'
      : body.type === 'lost'
        ? 'lost'
        : null;

    const newItem = body.newItem;

    if (!type || !newItem || typeof newItem !== 'object') {
      return sendJson(res, 400, {
        success: false,
        error: 'type and newItem are required'
      });
    }

    if (
      newItem.userId &&
      newItem.userId !== user.id &&
      user.role !== 'admin'
    ) {
      return sendJson(res, 403, {
        success: false,
        error: 'You can only auto-match your own report'
      });
    }

    try {
      const collection = type === 'lost'
        ? foundItemsCol
        : lostItemsCol;

      const candidates = await collection
        .find({})
        .toArray();

      const matches = await calculateHybridMatches(
        newItem,
        candidates,
        type
      );

      return sendJson(res, 200, {
        success: true,
        type,
        count: matches.length,
        matches
      });

    } catch (error) {
      console.error(
        'Hybrid auto-match failed:',
        error
      );

      return sendJson(res, 500, {
        success: false,
        error: error.message || 'Hybrid matching failed'
      });
    }
  }


  /* =======================================================
     STUDENT AI MATCHES
     ======================================================= */

  if (
    req.method === 'GET' &&
    url.pathname === '/api/ai/student-matches'
  ) {
    const user = await getAuthUser(req);

    if (!user) {
      return sendJson(res, 401, {
        success: false,
        error: 'Authentication required'
      });
    }

    if (user.role === 'admin') {
      return sendJson(res, 200, {
        success: true,
        matches: []
      });
    }

    try {
      const lostItems = await lostItemsCol
        .find({
          userId: user.id
        })
        .toArray();

      const openLostItems = lostItems.filter(item =>
        String(item.status || 'open')
          .trim()
          .toLowerCase() === 'open'
      );

      const foundItems = await foundItemsCol
        .find({})
        .toArray();

      const openFoundItems = foundItems.filter(item => {
        const status = String(item.status || 'open')
          .trim()
          .toLowerCase();
        return status === 'open' || status === 'received_by_admin';
      });

      if (!openLostItems.length || !openFoundItems.length) {
        return sendJson(res, 200, {
          success: true,
          matches: []
        });
      }

      const allMatches = [];

      /*
       * Each lost report gets its own top candidates.
       * The strongest 10 per lost report are validated
       * with Python TF-IDF and the existing visual AI.
       */
      for (const lostItem of openLostItems) {
        const matches = await calculateHybridMatches(
          lostItem,
          openFoundItems,
          'lost'
        );

        allMatches.push(...matches);
      }

      const unique = new Map();

      allMatches.forEach(match => {
        const key = `${match.lostItem?.id || ''}::${match.foundItem?.id || ''}`;
        const previous = unique.get(key);

        if (!previous || Number(match.score || 0) > Number(previous.score || 0)) {
          unique.set(key, match);
        }
      });

      const matches = Array.from(unique.values())
        .filter(match => Number(match.score || 0) >= 40)
        .sort((a, b) =>
          Number(b.score || 0) -
          Number(a.score || 0)
        )
        .slice(0, 10);

      return sendJson(res, 200, {
        success: true,
        count: matches.length,
        matches
      });

    } catch (error) {
      console.error(
        'Student AI matching failed:',
        error
      );

      return sendJson(res, 500, {
        success: false,
        error: error.message || 'Student AI matching failed'
      });
    }
  }


  /* =======================================================
     NLP HEALTH
     ======================================================= */

  if (
    req.method === 'GET' &&
    url.pathname === '/api/nlp/health'
  ) {
    try {
      const aiBaseUrl = await resolveAIServiceUrl();
      const { status, data } = await fetchAiHealth(`${aiBaseUrl}/health`);

      return sendJson(res, status, {
        ...data,
        nlpEndpoint: `${aiBaseUrl}/nlp/text-similarity`
      });
    } catch (err) {
      return sendJson(res, 503, {
        success: false,
        error: `NLP service unavailable: ${err.message}`
      });
    }
  }


  /* =======================================================
     CNN HEALTH
     ======================================================= */

  if (
    req.method === 'GET' &&
    url.pathname ===
      '/api/cv/health'
  ) {

    try {

      const aiBaseUrl = await resolveAIServiceUrl();
      const { status, data } = await fetchAiHealth(`${aiBaseUrl}/health`);

      return sendJson(
        res,
        status,
        data
      );

    } catch (err) {

      return sendJson(
        res,
        503,
        {
          success: false,
          error:
            `CNN service unavailable: ${err.message}`
        }
      );
    }
  }


  /* =======================================================
     ADMIN: GET AI MATCHES
     ======================================================= */

  if (
    req.method === 'GET' &&
    url.pathname.startsWith(
      '/api/matches/admin/found/'
    )
  ) {

    const user =
      await getAuthUser(req);

    if (
      !user ||
      user.role !== 'admin'
    ) {

      return sendJson(
        res,
        403,
        {
          error:
            'Admin access required'
        }
      );
    }


    const foundId =
      url.pathname
        .split('/')
        .pop();


    try {

      const matches =
        await getAdminFoundMatches(
          foundId
        );


      return sendJson(
        res,
        200,
        {
          success: true,
          data:
            matches
        }
      );

    } catch (err) {

      return sendJson(
        res,
        404,
        {
          error:
            err.message
        }
      );
    }
  }


  /* =======================================================
     ADMIN: RECEIVE FOUND ITEM
     ======================================================= */

  if (
    req.method === 'PUT' &&
    url.pathname.startsWith(
      '/api/found/'
    )
  ) {

    const user =
      await getAuthUser(req);

    if (
      !user ||
      user.role !== 'admin'
    ) {

      return sendJson(
        res,
        403,
        {
          error:
            'Admin access required'
        }
      );
    }


    const foundId =
      url.pathname
        .split('/')
        .pop();


    const found =
      await foundItemsCol.findOne({
        id:
          foundId
      });


    if (!found) {

      return sendJson(
        res,
        404,
        {
          error:
            'Found item not found'
        }
      );
    }


    found.status =
      'received_by_admin';

    found.receivedByAdminId =
      user.id;

    found.receivedAt =
      new Date().toISOString();


    pushTimeline(
      found,
      'Item received by admin',
      {
        adminId:
          user.id
      }
    );


    await foundItemsCol.updateOne(
      {
        id:
          foundId
      },
      {
        $set:
          found
      }
    );


    const matches =
      await getAdminFoundMatches(
        foundId
      );


    return sendJson(
      res,
      200,
      {
        success: true,

        message:
          'Item received by admin',

        data: {
          foundItem:
            publicItem(found),

          matches
        }
      }
    );
  }


  /* =======================================================
     ADMIN: CONFIRM MATCH
     ======================================================= */

  if (
    req.method === 'POST' &&
    url.pathname ===
      '/api/matches/admin/confirm'
  ) {

    const user =
      await getAuthUser(req);

    if (
      !user ||
      user.role !== 'admin'
    ) {

      return sendJson(
        res,
        403,
        {
          error:
            'Admin access required'
        }
      );
    }


    const body =
      await parseBody(req);


    const foundId =
      String(
        body.foundItemId || ''
      );


    const lostId =
      String(
        body.lostItemId || ''
      );


    if (
      !foundId ||
      !lostId
    ) {

      return sendJson(
        res,
        400,
        {
          error:
            'foundItemId and lostItemId are required'
        }
      );
    }


    const found =
      await foundItemsCol.findOne({
        id:
          foundId
      });


    const lost =
      await lostItemsCol.findOne({
        id:
          lostId
      });


    if (
      !found ||
      !lost
    ) {

      return sendJson(
        res,
        404,
        {
          error:
            'Lost or found item not found'
        }
      );
    }


    if (
      found.status !==
      'received_by_admin'
    ) {

      return sendJson(
        res,
        400,
        {
          error:
            'Admin must receive the physical item first'
        }
      );
    }


    if (
      lost.status !==
      'open'
    ) {

      return sendJson(
        res,
        400,
        {
          error:
            'Lost item is not open'
        }
      );
    }


    /* Link the two items */

    found.matchedLostItemId =
      lost.id;

    found.status =
      'matched';


    lost.matchedFoundItemId =
      found.id;

    lost.status =
      'matched';


    pushTimeline(
      found,
      'Match confirmed by admin',
      {
        lostItemId:
          lost.id,

        adminId:
          user.id
      }
    );


    pushTimeline(
      lost,
      'Matched to found item',
      {
        foundItemId:
          found.id,

        adminId:
          user.id
      }
    );


    await foundItemsCol.updateOne(
      {
        id:
          found.id
      },
      {
        $set:
          found
      }
    );


    await lostItemsCol.updateOne(
      {
        id:
          lost.id
      },
      {
        $set:
          lost
      }
    );


    /* Update related claim */

    const relatedClaims =
      await claimsCol
        .find({})
        .toArray();


    for (
      const claim of relatedClaims
    ) {

      if (
        claim.foundItemId ===
          found.id &&
        claim.lostItemId ===
          lost.id
      ) {

        claim.status =
          'approved';

        claim.adminVerified =
          true;

        claim.adminVerifiedAt =
          new Date().toISOString();

        claim.adminVerifiedBy =
          user.id;


        await claimsCol.updateOne(
          {
            id:
              claim.id
          },
          {
            $set:
              claim
          }
        );
      }
    }


    /* Notify owner */

    const owner =
      await usersCol.findOne({
        id:
          lost.userId
      });


    if (owner) {

      const notifications =
        Array.isArray(
          owner.notifications
        )
          ? owner.notifications
          : [];


      await enrichItemWithCNN(lost);
      await enrichItemWithCNN(found);

      const confirmedMatch =
        await calculateHybridMatchResult(
          lost,
          found
        );

      notifications.unshift({

        id:
          `n_${Date.now().toString(36)}${Math.random()
            .toString(36)
            .slice(2, 6)}`,

        type:
          'match_confirmed',

        read:
          false,

        time:
          new Date().toISOString(),

        lostItemId:
          lost.id,

        foundItemId:
          found.id,

        score:
          confirmedMatch.score,

        message:
          `Admin confirmed a possible match for "${lost.name || lost.itemName}". Please collect the item from the Admin Office after identity verification.`
      });


      owner.notifications =
        notifications.slice(
          0,
          25
        );


      await usersCol.updateOne(
        {
          id:
            owner.id
        },
        {
          $set: {
            notifications:
              owner.notifications
          }
        }
      );
    }


    return sendJson(
      res,
      200,
      {
        success: true,

        message:
          'Match confirmed by admin and owner notified',

        data: {
          foundItem:
            publicItem(found),

          lostItem:
            publicItem(lost)
        }
      }
    );
  }


  /* =======================================================
     ADMIN: RETURN ITEM TO OWNER
     ======================================================= */

  if (
    req.method === 'POST' &&
    url.pathname ===
      '/api/matches/admin/return'
  ) {

    const user =
      await getAuthUser(req);

    if (
      !user ||
      user.role !== 'admin'
    ) {

      return sendJson(
        res,
        403,
        {
          error:
            'Admin access required'
        }
      );
    }


    const body =
      await parseBody(req);


    const foundId =
      String(
        body.foundItemId || ''
      );


    const studentId =
      String(
        body.studentId || ''
      ).trim();

    const ownerAccountId =
      String(
        body.ownerAccountId || ''
      ).trim();

    const ownerEmail = String(body.ownerEmail || '').trim().toLowerCase();


    const notes =
      String(
        body.notes || ''
      ).trim();


    if (!foundId) {

      return sendJson(
        res,
        400,
        {
          error:
            'foundItemId is required'
        }
      );
    }


    const found =
      await foundItemsCol.findOne({
        id:
          foundId
      });


    if (!found) {

      return sendJson(
        res,
        404,
        {
          error:
            'Found item not found'
        }
      );
    }


    if (
      found.status !==
        'matched' ||
      !found.matchedLostItemId
    ) {

      return sendJson(
        res,
        400,
        {
          error:
            'Found item must have a confirmed match'
        }
      );
    }


    const lost =
      await lostItemsCol.findOne({
        id:
          found.matchedLostItemId
      });


    if (!lost) {

      return sendJson(
        res,
        404,
        {
          error:
            'Matched lost item not found'
        }
      );
    }


    const owner =
      await usersCol.findOne({
        id:
          lost.userId
      });


    if (!owner) {

      return sendJson(
        res,
        404,
        {
          error:
            'Owner account not found'
        }
      );
    }


    /*
     * Identity is resolved from the matched lost report's owner account.
     * The admin-only route does not require the admin to retype an email or
     * invent a Student ID. The UI asks the admin to confirm in-person identity
     * verification; this server-side owner lookup prevents returning the item
     * to an arbitrary email address.
     */
    const verificationMethod = 'matched_owner_account';
    const verifiedOwnerEmail = String(owner.email || '').trim().toLowerCase();

    /* Mark identity verified */

    found.ownerIdentityVerified =
      true;

    found.collectionStudentId =
      null;

    found.collectionOwnerEmail =
      verifiedOwnerEmail || null;

    found.collectionAccountId =
      owner.id;

    found.collectionVerificationMethod =
      verificationMethod;

    found.collectionNotes =
      notes || null;

    found.collectedAt =
      new Date().toISOString();

    found.collectedByAdminId =
      user.id;

    found.status =
      'returned';


    lost.status =
      'resolved';


    pushTimeline(
      found,
      'Owner identity verified by admin',
      {
        verificationMethod,
        ownerEmail: verifiedOwnerEmail || null,
        accountId: owner.id,
        adminId:
          user.id
      }
    );


    pushTimeline(
      found,
      'Item returned to owner',
      {
        verificationMethod,
        ownerEmail: verifiedOwnerEmail || null,
        accountId: owner.id,
        adminId:
          user.id
      }
    );


    pushTimeline(
      lost,
      'Item returned to verified owner',
      {
        foundItemId:
          found.id,

        adminId:
          user.id
      }
    );


    await foundItemsCol.updateOne(
      {
        id:
          found.id
      },
      {
        $set:
          found
      }
    );


    await lostItemsCol.updateOne(
      {
        id:
          lost.id
      },
      {
        $set:
          lost
      }
    );


    /* Close related claim */

    const relatedClaims =
      await claimsCol
        .find({})
        .toArray();


    for (
      const claim of relatedClaims
    ) {

      if (
        claim.foundItemId ===
          found.id &&
        claim.lostItemId ===
          lost.id
      ) {

        claim.status =
          'closed';

        claim.returnedAt =
          found.collectedAt;

        claim.returnedByAdminId =
          user.id;

        claim.collectionStudentId =
          null;

        claim.collectionOwnerEmail =
          verifiedOwnerEmail || null;

        claim.collectionAccountId =
          owner.id;

        claim.collectionVerificationMethod =
          verificationMethod;


        await claimsCol.updateOne(
          {
            id:
              claim.id
          },
          {
            $set:
              claim
          }
        );
      }
    }


    /* Notify owner */

    if (
      Array.isArray(
        owner.notifications
      )
    ) {

      owner.notifications.unshift({

        id:
          `n_${Date.now().toString(36)}${Math.random()
            .toString(36)
            .slice(2, 6)}`,

        type:
          'item_returned',

        read:
          false,

        time:
          new Date().toISOString(),

        lostItemId:
          lost.id,

        foundItemId:
          found.id,

        message:
          `Your item "${lost.name || lost.itemName}" was returned by the Admin after in-person identity verification.`
      });


      owner.notifications =
        owner.notifications.slice(
          0,
          25
        );


      await usersCol.updateOne(
        {
          id:
            owner.id
        },
        {
          $set: {
            notifications:
              owner.notifications
          }
        }
      );
    }


    return sendJson(
      res,
      200,
      {
        success: true,

        message:
          'Item returned to verified owner successfully',

        data: {

          foundItem:
            publicItem(found),

          lostItem:
            publicItem(lost),

          collection: {

            verificationMethod,
            ownerEmail: verifiedOwnerEmail || null,
            ownerName: owner.name || owner.fullName || null,

            studentId:
              null,

            accountId:
              owner.id,

            collectedAt:
              found.collectedAt,

            adminId:
              user.id
          }
        }
      }
    );
  }


  /* =======================================================
     UNKNOWN API
     ======================================================= */

  return sendJson(
    res,
    404,
    {
      error:
        'API route not found'
    }
  );
}


/* =========================================================
   SERVER
   ========================================================= */

const server =
  http.createServer(
    async (req, res) => {

      try {

        if (
          (req.url || '')
            .startsWith('/api/')
        ) {

          await handleApi(
            req,
            res
          );

          return;
        }


        serveStatic(
          req,
          res
        );

      } catch (err) {

        console.error(
          'Server error:',
          err
        );

        sendJson(
          res,
          500,
          {
            error:
              err.message ||
              'Internal server error'
          }
        );
      }
    }
  );


/* =========================================================
   START
   ========================================================= */

async function startServer() {

  validateRuntimeConfig();

  setupJsonDatabase();

  await ensureAdminUser();

  server.listen(
    PORT,
    () => {

      console.log(
        `TraceMate server running at http://localhost:${PORT}`
      );

      console.log(
        `Database: persistent JSON (${DB_PATH})`
      );

      console.log(
        'MongoDB: not required'
      );

      console.log(
        'CNN service: configured through AI_SERVICE_URL'
      );
    }
  );
}


startServer()
  .catch(error => {

    console.error(
      'Failed to start TraceMate:',
      error.message
    );

    process.exit(1);
  });
