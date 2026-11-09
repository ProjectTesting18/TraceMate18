const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateMatchScore, extractProperties } = require('../src/advanced-cnn/matchingServiceCompat');

test('charging accessories remain family-compatible while subtype evidence is not overstated', () => {
  const lost = {
    name: 'Black Charging Cable with Vivo Adapter',
    category: 'electronics',
    description: 'A black braided charging cable with multiple charging connectors, a white Vivo wall adapter, and a small collectible character figurine attached to one cable. The adapter has the Vivo logo.',
    location: 'parking',
    dateLost: '2026-10-10'
  };
  const found = {
    name: 'vivo charger with 3 charging cable in one',
    category: 'electronics',
    description: 'Vivo charger with three charging cables and a white adapter.',
    location: 'parking area',
    dateFound: '2026-10-10'
  };
  const lostProps = extractProperties(lost);
  const foundProps = extractProperties(found);
  assert.ok(lostProps.objectTypes.includes('charging_cable'), JSON.stringify(lostProps.objectTypes));
  assert.ok(lostProps.objectTypes.includes('power_adapter'), JSON.stringify(lostProps.objectTypes));
  assert.ok(foundProps.objectTypes.includes('charging_cable'), JSON.stringify(foundProps.objectTypes));
  assert.ok(foundProps.objectTypes.includes('charger'), JSON.stringify(foundProps.objectTypes));

  const result = calculateMatchScore(lost, found);
  assert.notEqual(result.objectFamilyConflict, true);
  assert.notEqual(result.identityConflict, true);
  assert.ok(result.propertyBreakdown.objectType < 100, `different charging subtypes should not score as exact type identity: ${result.propertyBreakdown.objectType}`);
});

test('low-confidence visual predictions plus missing object-type evidence cap the score and require review', () => {
  const result = calculateMatchScore(
    {
      name: 'Unusual black accessory', category: 'other', description: 'Black accessory with a small logo',
      visualRecognition: { available: true, objectType: 'phone', objectConfidence: 0.22 }
    },
    {
      name: 'Black accessory with logo', category: 'other', description: 'Black accessory with a small logo',
      visualRecognition: { available: true, objectType: 'umbrella', objectConfidence: 0.25 }
    }
  );
  assert.equal(result.reviewRecommended, true);
  assert.ok(result.score <= 69, `expected conservative cap <=69, got ${result.score}`);
  assert.ok(result.reviewReasons.some(reason => /object type evidence is unresolved/i.test(reason)));
});
