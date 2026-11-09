const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');

test('mobile navigation button is accessible and wired to drawer controls', () => {
  assert.match(indexHtml, /id="tracemate-responsive-navigation"/);
  assert.match(indexHtml, /className = 'mobile-menu-toggle'/);
  assert.match(indexHtml, /aria-label', 'Open navigation menu'/);
  assert.match(indexHtml, /aria-expanded', 'false'/);
  assert.match(indexHtml, /tracemate-menu-open/);
  assert.match(indexHtml, /addEventListener\('keydown'/);
  assert.match(indexHtml, /event\.key === 'Escape'/);
  assert.match(indexHtml, /matchMedia\('\(max-width: 900px\)'\)/);
});

test('mobile styles provide a drawer, responsive layouts, and touch-friendly controls', () => {
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /\.tracemate-menu-open/);
  assert.match(css, /@media \(max-width: 600px\)|@media \(max-width: 520px\)/);
  assert.match(indexHtml, /'height:42px'/);
  assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});

test('claim actions use readable arrows without mojibake', () => {
  assert.match(appJs, /Claim This →/);
  assert.match(appJs, /Claim →/);
  assert.match(appJs, /↔/);
  assert.doesNotMatch(appJs, /â†[’”]/);
});


test('mobile admin tables remain readable with horizontal touch scrolling', () => {
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
  assert.match(css, /MOBILE TABLE FIX — keep admin columns readable and swipeable/);
  assert.match(css, /overflow-x:\s*auto/);
  assert.match(css, /-webkit-overflow-scrolling:\s*touch/);
  assert.match(css, /min-width:\s*680px/);
  assert.match(css, /overscroll-behavior-x:\s*contain/);
});
