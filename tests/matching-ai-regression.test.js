const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateMatchScore } = require('../src/advanced-cnn/matchingServiceCompat');

test('paper notebooks and laptops remain different object families', () => {
  const result = calculateMatchScore(
    { name: 'paper notebook', category: 'stationery', description: 'pink paper notebook' },
    { name: 'silver laptop', category: 'electronics', description: 'computer laptop' }
  );
  assert.ok(result.score < 10, `expected a weak match, got ${result.score}`);
  assert.ok(result.scores.nameText < 10, `name score was ${result.scores.nameText}`);
});

test('category object labels are read and equivalent stationery labels get full credit', () => {
  const result = calculateMatchScore(
    { name: 'Classmate notebook', category: { label: 'Stationery' }, description: 'pink notebook' },
    { name: 'Classmate notebook', category: 'stationery', description: 'pink notebook' }
  );
  assert.equal(result.breakdown.category, 20);
});

test('same primary color remains consistent when secondary trim colors differ', () => {
  const result = calculateMatchScore(
    { name: 'pink notebook', category: 'stationery', description: 'pink notebook', visualRecognition: { color: 'pink, black trim', colorConfidence: 0.9, objectType: 'notebook', objectConfidence: 0.9 } },
    { name: 'pink notebook', category: 'stationery', description: 'pink notebook', visualRecognition: { color: 'pink, white trim', colorConfidence: 0.9, objectType: 'notebook', objectConfidence: 0.9 } }
  );
  assert.equal(result.visualColorConflict, false);
  assert.equal(result.primaryColorConflict, false);
  assert.ok(result.reasons.some(reason => reason.includes('AI visual color estimates agree: pink')));
});

test('conflicting high-confidence primary colors remain flagged', () => {
  const result = calculateMatchScore(
    { name: 'pink notebook', category: 'stationery', description: 'pink notebook', visualRecognition: { color: 'pink', colorConfidence: 0.9, objectType: 'notebook', objectConfidence: 0.9 } },
    { name: 'blue notebook', category: 'stationery', description: 'blue notebook', visualRecognition: { color: 'blue', colorConfidence: 0.9, objectType: 'notebook', objectConfidence: 0.9 } }
  );
  assert.equal(result.primaryColorConflict, true);
  assert.equal(result.visualColorConflict, true);
});

test('notebook aliases and related stationery categories receive intended credit', () => {
  const equivalent = calculateMatchScore(
    { name: 'Classmate notebook', category: 'notebook', description: 'pink ruled notebook' },
    { name: 'Classmate notebook', category: 'exercise book', description: 'pink ruled notebook' }
  );
  assert.equal(equivalent.breakdown.category, 20);

  const related = calculateMatchScore(
    { name: 'Classmate notebook', category: 'notebook', description: 'pink ruled notebook' },
    { name: 'Classmate notebook', category: 'stationery', description: 'pink ruled notebook' }
  );
  assert.equal(related.breakdown.category, 10);
});



test('low-confidence object predictions recommend manual review without changing the score', () => {
  const lost = {
    name: 'Sounce White Handle Cleaning Brush',
    category: 'other',
    description: 'White handle, reddish-brown bristles, Sounce logo and lightning symbol'
  };
  const found = {
    name: 'Sounce White Cleaning Brush with Detachable Handle',
    category: 'other',
    description: 'White handle, reddish-brown bristles, Sounce logo and lightning symbol'
  };

  const baseline = calculateMatchScore(lost, found);
  const result = calculateMatchScore(
    {
      ...lost,
      visualRecognition: {
        available: true,
        objectType: 'phone',
        objectConfidence: 0.2602
      }
    },
    {
      ...found,
      visualRecognition: {
        available: true,
        objectType: 'umbrella',
        objectConfidence: 0.3181
      }
    }
  );

  assert.equal(result.reviewRecommended, true);
  assert.ok(
    result.reviewReasons.some(reason => /low-confidence visual object/i.test(reason)),
    `expected a low-confidence review reason, got: ${result.reviewReasons.join('; ')}`
  );
  assert.equal(result.score, baseline.score, 'review warning must not change the score');
  assert.notEqual(result.score, 0, 'low-confidence predictions must not hard-reject the pair');
});

test('missing visual object prediction does not create a low-confidence review reason', () => {
  const lost = {
    name: 'Sounce White Handle Cleaning Brush',
    category: 'other',
    description: 'White handle, reddish-brown bristles, Sounce logo and lightning symbol',
    visualRecognition: { available: true, objectType: 'phone', objectConfidence: 0.26 }
  };
  const found = {
    name: 'Sounce White Cleaning Brush with Detachable Handle',
    category: 'other',
    description: 'White handle, reddish-brown bristles, Sounce logo and lightning symbol',
    visualRecognition: { available: false }
  };

  const result = calculateMatchScore(lost, found);
  assert.ok(
    !result.reviewReasons.some(reason => /low-confidence visual object/i.test(reason)),
    `unexpected low-confidence reason: ${result.reviewReasons.join('; ')}`
  );
});

test('Sounce cleaning brush reports recognize matching brand and object type', () => {
  const lost = {
    name: 'Sounce White Handle Cleaning Brush',
    category: 'other',
    description: 'White handle, rectangular brush head, reddish-brown bristles, Sounce logo and lightning symbol'
  };
  const found = {
    name: 'Sounce White Cleaning Brush with Detachable Handle',
    category: 'other',
    description: 'White handle, rectangular brush head, reddish-brown bristles, Sounce logo and lightning symbol'
  };

  const result = calculateMatchScore(lost, found);
  assert.equal(result.propertyBreakdown.brand, 100);
  assert.equal(result.propertyBreakdown.objectType, 100);
  assert.equal(result.propertyBreakdown.color, 100);
});

test('different low-confidence visual color labels are described as unconfirmed, not as a conflict', () => {
  const result = calculateMatchScore(
    {
      name: 'Sounce White Handle Cleaning Brush',
      category: 'other',
      description: 'White handle, reddish-brown bristles, Sounce logo',
      visualRecognition: { color: 'white', colorConfidence: 0.2, objectType: 'phone', objectConfidence: 0.26 }
    },
    {
      name: 'Sounce White Cleaning Brush with Detachable Handle',
      category: 'other',
      description: 'White handle, reddish-brown bristles, Sounce logo',
      visualRecognition: { color: 'red', colorConfidence: 0.2, objectType: 'umbrella', objectConfidence: 0.31 }
    }
  );

  assert.equal(result.visualColorConflict, false);
  assert.ok(result.reasons.some(reason => /confidence is insufficient to confirm a conflict/i.test(reason)));
});

test('explicit cable color in descriptions overrides a stale same-color title', () => {
  const result = calculateMatchScore(
    {
      name: 'Black Charging Cable with Vivo Adapter',
      category: 'electronics',
      description: 'A white Vivo adapter with a black braided charging cable.'
    },
    {
      name: 'Black Charging Cable with Vivo Adapter',
      category: 'electronics',
      description: 'A white Vivo adapter with a red braided charging cable.'
    }
  );
  assert.equal(result.primaryColorConflict, true);
  assert.equal(result.primaryColorLost, 'black');
  assert.equal(result.primaryColorFound, 'red');
  assert.ok(result.score <= 62, `expected confirmed text color conflict cap, got ${result.score}`);
  assert.ok(!result.reasons.includes('Color appears to match'));
});

test('low-confidence visual color disagreement cannot be displayed as a full color match', () => {
  const result = calculateMatchScore(
    {
      name: 'Black Charging Cable with Vivo Adapter',
      category: 'electronics',
      description: 'A black braided charging cable with a white Vivo adapter.',
      visualRecognition: { available: true, color: 'black', colorConfidence: 0.32, objectType: 'charging cable', objectConfidence: 0.9 }
    },
    {
      name: 'Black Charging Cable with Vivo Adapter',
      category: 'electronics',
      description: 'A black braided charging cable with a white Vivo adapter.',
      visualRecognition: { available: true, color: 'red', colorConfidence: 0.31, objectType: 'charging cable', objectConfidence: 0.9 }
    }
  );
  assert.equal(result.visualColorLabelsDiffer, true);
  assert.equal(result.uncertainVisualColorDifference, true);
  assert.ok(result.score <= 82, `expected uncertain color cap, got ${result.score}`);
  assert.ok(result.propertyBreakdown.color <= 50, `expected color evidence cap, got ${result.propertyBreakdown.color}`);
  assert.ok(!result.reasons.includes('Color appears to match'));
  assert.equal(result.reviewRecommended, true);
  assert.ok(result.reviewReasons.some(reason => /visual color labels differ/i.test(reason)));
});
