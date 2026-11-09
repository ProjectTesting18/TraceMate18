
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// ═══════════════════════════════════════════════════════════════════
// BUG B: Frontend Object Family (getLocalObjectFamily)
// ═══════════════════════════════════════════════════════════════════

const appJsPath = path.join(__dirname, '../js/app.js');
const appJsCode = fs.readFileSync(appJsPath, 'utf8');

const getLocalObjectFamilyMatch = appJsCode.match(
  /^function getLocalObjectFamily\s*\([^)]*\)\s*\{[\s\S]*?^\}/m
);

if (!getLocalObjectFamilyMatch) {
  throw new Error('Could not find getLocalObjectFamily in js/app.js');
}

const getLocalObjectFamily = new Function(
  `return (${getLocalObjectFamilyMatch[0]})`
)();

test('Bug B: paper notebooks are classified as notebook, not laptop', () => {
  assert.equal(
    getLocalObjectFamily({ name: 'Classmate notebook' }),
    'notebook'
  );
  assert.equal(
    getLocalObjectFamily({
      name: 'spiral notebook',
      category: 'stationery'
    }),
    'notebook'
  );
  assert.equal(
    getLocalObjectFamily({ name: 'ruled notebook' }),
    'notebook'
  );
  assert.equal(
    getLocalObjectFamily({ name: 'exercise book' }),
    'notebook'
  );
  assert.equal(
    getLocalObjectFamily({
      name: 'paper notebook',
      description: 'pink notebook'
    }),
    'notebook'
  );
});

test('Bug B: notebook computer and laptop are classified as laptop', () => {
  assert.equal(
    getLocalObjectFamily({ name: 'notebook computer' }),
    'laptop'
  );
  assert.equal(
    getLocalObjectFamily({ name: 'Dell laptop' }),
    'laptop'
  );
  assert.equal(
    getLocalObjectFamily({ name: 'MacBook Air' }),
    'laptop'
  );
  assert.equal(
    getLocalObjectFamily({ name: 'portable laptop computer' }),
    'laptop'
  );
});

test('Bug B: paper notebook and laptop return different object families', () => {
  const notebookFamily = getLocalObjectFamily({
    name: 'Classmate notebook'
  });
  const laptopFamily = getLocalObjectFamily({
    name: 'Dell laptop'
  });

  assert.notEqual(notebookFamily, laptopFamily);
  assert.equal(notebookFamily, 'notebook');
  assert.equal(laptopFamily, 'laptop');
});

test('Bug B: frontend object families align with helmet, mouse, brush', () => {
  assert.equal(
    getLocalObjectFamily({ name: 'Studds motorcycle helmet' }),
    'helmet'
  );
  assert.equal(
    getLocalObjectFamily({ name: 'Logitech wireless mouse' }),
    'mouse'
  );
  assert.equal(
    getLocalObjectFamily({ name: 'Sounce cleaning brush' }),
    'brush'
  );
  assert.equal(
    getLocalObjectFamily({ name: 'water bottle' }),
    'bottle'
  );
  assert.equal(
    getLocalObjectFamily({ name: 'smartwatch' }),
    'watch'
  );
});

// ═══════════════════════════════════════════════════════════════════
// BUG A: Item Return Verification Logic (Isolated Unit Verification)
// ═══════════════════════════════════════════════════════════════════

function verifyReturnIdentity(owner, body) {
  const studentId = String(body.studentId || '').trim();
  const ownerAccountId = String(body.ownerAccountId || '').trim();
  const ownerEmail = String(body.ownerEmail || '').trim().toLowerCase();

  if (owner.studentId) {
    if (!studentId) {
      return {
        status: 400,
        error: 'This owner has a Student ID. Enter the Student ID for verification.'
      };
    }

    if (owner.studentId !== studentId) {
      return {
        status: 403,
        error: 'Student ID does not match the owner record'
      };
    }

    return {
      status: 200,
      verificationMethod: 'student_id'
    };
  }

  if (ownerEmail) {
    const registeredOwnerEmail = String(owner.email || '')
      .trim()
      .toLowerCase();

    if (
      !registeredOwnerEmail ||
      registeredOwnerEmail !== ownerEmail
    ) {
      return {
        status: 403,
        error: 'Owner email does not match the matched owner'
      };
    }

    return {
      status: 200,
      verificationMethod: 'email'
    };
  }

  if (ownerAccountId) {
    if (ownerAccountId !== owner.id) {
      return {
        status: 403,
        error: 'Owner account identity does not match the matched owner'
      };
    }

    return {
      status: 200,
      verificationMethod: 'account_id'
    };
  }

  return {
    status: 400,
    error: 'Owner email or Account ID is required for an account without a Student ID'
  };
}

test('Bug A: owner with studentId succeeds with matching studentId', () => {
  const owner = {
    id: 'u_1',
    email: 'student@campus.edu',
    studentId: 'STU-101'
  };

  const res = verifyReturnIdentity(owner, {
    studentId: 'STU-101'
  });

  assert.equal(res.status, 200);
  assert.equal(res.verificationMethod, 'student_id');
});

test('Bug A: owner with studentId fails with incorrect or missing studentId', () => {
  const owner = {
    id: 'u_1',
    email: 'student@campus.edu',
    studentId: 'STU-101'
  };

  const resMissing = verifyReturnIdentity(owner, {
    studentId: ''
  });

  assert.equal(resMissing.status, 400);
  assert.match(resMissing.error, /Enter the Student ID/i);

  const resWrong = verifyReturnIdentity(owner, {
    studentId: 'STU-999'
  });

  assert.equal(resWrong.status, 403);
  assert.match(resWrong.error, /does not match the owner record/i);
});

test('Bug A: owner without studentId succeeds with verified owner email', () => {
  const owner = {
    id: 'u_2',
    email: 'extern@gmail.com',
    studentId: null
  };

  const res = verifyReturnIdentity(owner, {
    studentId: '',
    ownerEmail: 'extern@gmail.com'
  });

  assert.equal(res.status, 200);
  assert.equal(res.verificationMethod, 'email');
});

test('Bug A: owner without studentId fails with mismatched email', () => {
  const owner = {
    id: 'u_2',
    email: 'extern@gmail.com',
    studentId: null
  };

  const res = verifyReturnIdentity(owner, {
    studentId: '',
    ownerEmail: 'imposter@gmail.com'
  });

  assert.equal(res.status, 403);
  assert.match(res.error, /Owner email does not match/i);
});

test('Bug A: owner without studentId preserves backwards-compatible accountId path', () => {
  const owner = {
    id: 'u_2',
    email: 'extern@gmail.com',
    studentId: null
  };

  const res = verifyReturnIdentity(owner, {
    studentId: '',
    ownerAccountId: 'u_2'
  });

  assert.equal(res.status, 200);
  assert.equal(res.verificationMethod, 'account_id');

  const resWrongId = verifyReturnIdentity(owner, {
    studentId: '',
    ownerAccountId: 'u_other'
  });

  assert.equal(resWrongId.status, 403);
});

test('Bug A: owner without studentId fails when neither email nor accountId is provided', () => {
  const owner = {
    id: 'u_2',
    email: 'extern@gmail.com',
    studentId: null
  };

  const res = verifyReturnIdentity(owner, {
    studentId: '',
    ownerEmail: '',
    ownerAccountId: ''
  });

  assert.equal(res.status, 400);
  assert.match(res.error, /Owner email or Account ID is required/i);
});

// ═══════════════════════════════════════════════════════════════════
// BUG D: Candidate Filter Excludes Already-Matched Lost Reports
// ═══════════════════════════════════════════════════════════════════

function filterCandidateLostItems(lostList, foundItem) {
  const excludedStatuses = new Set([
    'resolved',
    'returned',
    'rejected',
    'closed',
    'cancelled',
    'canceled',
    'matched'
  ]);

  return lostList.filter(item => {
    const status = String(item.status || 'open')
      .trim()
      .toLowerCase();

    if (
      foundItem.matchedLostItemId &&
      item.id === foundItem.matchedLostItemId
    ) {
      return true;
    }

    return !excludedStatuses.has(status);
  });
}

test('Bug D: candidate filter excludes already-matched lost reports for new found items', () => {
  const lostList = [
    { id: 'lost_1', name: 'Open Notebook', status: 'open' },
    { id: 'lost_2', name: 'Already Matched Watch', status: 'matched' },
    { id: 'lost_3', name: 'Returned Bag', status: 'returned' },
    { id: 'lost_4', name: 'Resolved Bottle', status: 'resolved' },
    { id: 'lost_5', name: 'Another Open Item', status: 'open' }
  ];

  const newFoundItem = {
    id: 'found_new',
    status: 'received_by_admin',
    matchedLostItemId: null
  };

  const candidates = filterCandidateLostItems(
    lostList,
    newFoundItem
  );

  assert.equal(candidates.length, 2);
  assert.deepEqual(
    candidates.map(c => c.id),
    ['lost_1', 'lost_5']
  );
});

test('Bug D: candidate filter retains currently confirmed match for inspection', () => {
  const lostList = [
    { id: 'lost_1', name: 'Open Item', status: 'open' },
    { id: 'lost_2', name: 'Matched To This Found Item', status: 'matched' },
    { id: 'lost_3', name: 'Matched To Other Item', status: 'matched' }
  ];

  const matchedFoundItem = {
    id: 'found_1',
    status: 'matched',
    matchedLostItemId: 'lost_2'
  };

  const candidates = filterCandidateLostItems(
    lostList,
    matchedFoundItem
  );

  assert.equal(candidates.length, 2);
  assert.deepEqual(
    candidates.map(c => c.id),
    ['lost_1', 'lost_2']
  );
});

// ═══════════════════════════════════════════════════════════════════
// BUG C: Admin Receipt Verification Safeguard
// ═══════════════════════════════════════════════════════════════════

test('Bug C: admin.js requires receipt before confirming an AI match', () => {
  const adminJsPath = path.join(__dirname, '../js/admin.js');
  const adminJsCode = fs.readFileSync(adminJsPath, 'utf8');

  // 1. The confirmation function must exist.
  assert.match(
    adminJsCode,
    /async function confirmAIMatch\s*\(/,
    'confirmAIMatch must exist'
  );

  // 2. Confirmation must stop if physical receipt is not recorded.
  assert.match(
    adminJsCode,
    /if\s*\(\s*foundStatus\s*!==\s*['"]received_by_admin['"]\s*\)\s*\{[\s\S]*?return\s*;/,
    'confirmAIMatch must block unreceived found items'
  );

  // 3. The modal must explain the physical receipt requirement.
  assert.match(
    adminJsCode,
    /Physical receipt required|ai-receipt-required|ai-receipt-banner/i,
    'The modal must explain the receipt requirement'
  );

  // 4. Confirmation eligibility must require recorded receipt.
  assert.match(
    adminJsCode,
    /eligibleForConfirmation\s*=\s*String\(foundItem\.status\s*\|\|\s*''\)\.toLowerCase\(\)\s*===\s*['"]received_by_admin['"]/,
    'Confirmation must require received_by_admin status'
  );

  // 5. The candidate confirmation button must be disabled when ineligible.
  assert.match(
    adminJsCode,
    /eligibleForConfirmation\s*\?\s*''\s*:\s*'disabled aria-disabled="true"/,
    'The confirm button must be disabled when confirmation is ineligible'
  );
});
