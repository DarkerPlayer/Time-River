const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const mainSource = fs.readFileSync('public/main.js', 'utf8');
const indexSource = fs.readFileSync('public/index.html', 'utf8');

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
