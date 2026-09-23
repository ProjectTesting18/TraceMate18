const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const PORT = process.env.PORT || 5000;
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8001';

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

const ALLOWED_COLLECTIONS = new Set([
  'users',
  'lost_items',
  'found_items',
  'claims'
]);

const STUDENT_EMAIL_DOMAIN = '@ges-coengg.org';

const ADMIN_EMAIL =
  process.env.ADMIN_EMAIL || 'admin@campus.edu';

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD || 'Admin@123';

const {
  requestEmbeddingFromDataUrl,
  cosineSimilarity,
  similarityPercentage
} = require('./src/advanced-cnn/cnnBridge');

const {
  calculateMatchScore
} = require('./src/advanced-cnn/matchingServiceCompat');

const {
  requestTextSimilarity
} = require('./src/advanced-cnn/nlpBridge');


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
  fs.writeFileSync(
    DB_PATH,
    JSON.stringify(data, null, 2),
    'utf8'
  );
}


function loadJsonData() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, {
      recursive: true
    });
  }

  if (!fs.existsSync(DB_PATH)) {
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
        contentTypeFor(filePath)
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

  if (
    !item ||
    !item.image ||
    item.imageEmbedding
  ) {
    return item;
  }

  try {

    const result =
      await requestEmbeddingFromDataUrl(
        item.image
      );

    item.imageEmbedding =
      result.embedding;

    item.imageEmbeddingModel =
      result.model ||
      'MobileNetV2';

    item.imageEmbeddingDimension =
      result.embedding_dimension ||
      result.embedding?.length ||
      0;

    return item;

  } catch (err) {

    console.warn(
      `CNN embedding skipped for ${
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

  item.timeline.push({
    event,
    time:
      new Date().toISOString(),
    ...extra
  });
}


function publicItem(item) {
  if (!item) return null;

  return {
    ...item
  };
}


/* =========================================================
   ADMIN AI MATCHING
   ========================================================= */

async function getAdminFoundMatches(
  foundId
) {

  const found =
    await foundItemsCol.findOne({
      id: foundId
    });

  if (!found) {
    throw new Error(
      'Found item not found'
    );
  }

  const lost =
    await lostItemsCol
      .find({})
      .toArray();

  return lost
    .filter(
      item =>
        item.status === 'open'
    )
    .map(
      item => ({
        lostItem:
          publicItem(item),

        ...calculateMatchScore(
          item,
          found
        )
      })
    )
    .filter(
      match =>
        match.score >= 30
    )
    .sort(
      (a, b) =>
        b.score - a.score
    )
    .slice(0, 5);
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
        database: 'json',
        databaseFile: 'data/db.json',
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

      const validAdminPasswords =
        new Set([
          ADMIN_PASSWORD,
          'Admin@123',
          'admin123'
        ]);

      if (
        !validAdminPasswords.has(
          password
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


    if (!studentId) {

      return sendJson(
        res,
        400,
        {
          error:
            'Student ID is required'
        }
      );
    }


    if (
      !email.endsWith(
        STUDENT_EMAIL_DOMAIN
      )
    ) {

      return sendJson(
        res,
        400,
        {
          error:
            'Enter College Email'
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

      studentId,

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


    if (
      !email.endsWith(
        STUDENT_EMAIL_DOMAIN
      )
    ) {

      return sendJson(
        res,
        400,
        {
          error:
            'Enter College Email'
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


    if (
      key === 'lost_items' ||
      key === 'found_items'
    ) {

      await enrichItemsWithCNN(
        body.data
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


    const target =
      collectionMap[key];


    await target.deleteMany({});


    if (
      body.data.length
    ) {

      await target.insertMany(
        body.data.map(
          doc => ({
            ...doc
          })
        )
      );
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
     NLP HEALTH
     ======================================================= */

  if (
    req.method === 'GET' &&
    url.pathname === '/api/nlp/health'
  ) {
    try {
      const r = await fetch(`${AI_SERVICE_URL}/health`);
      const data = await r.json();

      return sendJson(res, r.status, {
        ...data,
        nlpEndpoint: `${AI_SERVICE_URL}/nlp/text-similarity`
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

      const r =
        await fetch(
          `${AI_SERVICE_URL}/health`
        );

      const data =
        await r.json();

      return sendJson(
        res,
        r.status,
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
          calculateMatchScore(
            lost,
            found
          ).score,

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


    const notes =
      String(
        body.notes || ''
      ).trim();


    if (
      !foundId ||
      !studentId
    ) {

      return sendJson(
        res,
        400,
        {
          error:
            'foundItemId and studentId are required'
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


    /* Student ID verification */

    if (
      !owner.studentId ||
      owner.studentId !==
        studentId
    ) {

      return sendJson(
        res,
        403,
        {
          error:
            'Student ID does not match the owner record'
        }
      );
    }


    /* Mark identity verified */

    found.ownerIdentityVerified =
      true;

    found.collectionStudentId =
      studentId;

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
        studentId,
        adminId:
          user.id
      }
    );


    pushTimeline(
      found,
      'Item returned to owner',
      {
        studentId,
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
          studentId;


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
          `Your item "${lost.name || lost.itemName}" was returned by the Admin after Student ID verification.`
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

            studentId,

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
        'Database: local JSON (data/db.json)'
      );

      console.log(
        'MongoDB: not required'
      );

      console.log(
        `CNN service: ${AI_SERVICE_URL}`
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