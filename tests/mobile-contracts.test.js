const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const mainSource = fs.readFileSync('public/main.js', 'utf8');
const indexSource = fs.readFileSync('public/index.html', 'utf8');
const historySource = fs.readFileSync('public/history.js', 'utf8');
const stylesSource = fs.readFileSync('public/styles.css', 'utf8');

test('mobile slot rendering does not depend on initial innerWidth', () => {
  assert.doesNotMatch(mainSource, /const isMobile = window\.innerWidth <= 720/);
  assert.match(mainSource, /slot-edit-button/);
});

test('quick completion and duration controls expose names and state', () => {
  assert.match(mainSource, /checkbox\.type = 'button'/);
  assert.match(mainSource, /checkbox\.setAttribute\('aria-pressed'/);
  assert.match(mainSource, /select\.setAttribute\('aria-label'/);
});

test('mobile editor exposes a named dialog and close button', () => {
  assert.match(indexSource, /role="dialog" aria-modal="true" aria-labelledby="slot-expand-title"/);
  assert.match(indexSource, /id="slot-expand-close"[^>]+aria-label="关闭编辑"/);
});

test('bottom actions include the product guide without horizontal scrolling', () => {
  assert.match(indexSource, /href="\/guide\.html"[^>]*>产品说明<\/a>/);
  assert.doesNotMatch(stylesSource, /overflow-x:\s*auto/);
  assert.match(
    stylesSource,
    /\.topbar-mobile-dock #clear-button\s*\{[\s\S]*?grid-column:\s*1 \/ -1;/,
  );
});

test('history titles are built with text nodes', () => {
  assert.doesNotMatch(historySource, /button\.innerHTML/);
  assert.match(historySource, /titleElement\.textContent = archive\.title/);
});

test('filled mobile slots reserve separate rows for text and controls', () => {
  assert.match(
    stylesSource,
    /grid-template-rows:\s*repeat\(var\(--rows\), minmax\(var\(--row-height\), auto\)\)/,
  );
  assert.match(
    stylesSource,
    /\.slot-card\.has-content\s*\{[\s\S]*?grid-template-rows:\s*auto auto;/,
  );
});
