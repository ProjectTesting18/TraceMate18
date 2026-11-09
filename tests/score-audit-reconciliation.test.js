const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { calculateMatchScore } = require('../src/advanced-cnn/matchingServiceCompat');

test('base matcher exposes the pre-cap score separately from its capped score', () => {
  const item = {
    name: 'charger',
    category: 'electronics',
    description: 'red charger cable with white adapter of one plus',
    location: 'parking',
    visualRecognition: { objectType: 'charger', objectConfidence: 0.17, color: 'red', colorConfidence: 0.8 }
  };
  const result = calculateMatchScore(item, {
    ...item,
    name: 'charger',
    description: 'charger found near parking area',
    visualRecognition: { objectType: 'charger', objectConfidence: 0.17, color: 'white', colorConfidence: 0.8 }
  });

  assert.ok(Number.isFinite(result.scoreAudit.scoreBeforeRecommendedCap));
  assert.ok(Number.isFinite(result.scoreAudit.recommendedScoreCap));
  assert.ok(result.score <= result.scoreAudit.recommendedScoreCap);
  assert.ok(result.scoreAudit.scoreBeforeRecommendedCap >= result.score,
    'raw pre-cap score should not be overwritten by the capped score');
});

test('hybrid audit preserves raw score, capped base score, NLP adjustment, and final pre-cap score separately', () => {
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const adminSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'admin.js'), 'utf8');

  assert.match(serverSource, /base\?\.scoreAudit\?\.scoreBeforeRecommendedCap \?\? baseMatcherScoreAfterCap/);
  assert.match(serverSource, /baseMatcherScoreAfterCap,/);
  assert.match(serverSource, /scoreBeforeFinalCap: Math\.round\(advancedScore \+ pythonNlpAdjustment\)/);
  assert.match(serverSource, /recommendedScoreCapReasons: \[\.\.\.new Set\(recommendedScoreCapReasons\)\]/);
  assert.match(serverSource, /const colorConflict = Boolean\(base\?\.primaryColorConflict\)/,
    'only explicit report-color conflicts should activate the strict 62% cap');
  assert.match(serverSource, /const visualColorDifference = Boolean\(base\?\.visualColorConflict\)/,
    'image-only color differences should remain review warnings, not confirmed conflicts');
  assert.match(serverSource, /visualColorDifference \|\|/,
    'image-only color differences must still recommend manual review');
  assert.match(adminSource, /Raw score before base policy cap:/);
  assert.match(adminSource, /Base matcher score after its cap:/);
  assert.match(adminSource, /Hybrid pre-final-cap calculation \(uncapped base score \+ NLP adjustment\):/);
  assert.match(adminSource, /base matcher cap shown above is diagnostic/i);
});
