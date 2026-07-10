const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const documentationFiles = [
  'docs/PRODUCT_MANUAL.md',
  'docs/TECHNICAL_ARCHITECTURE.md',
  'docs/CORE_LOGIC.md',
  'public/guide.html',
];

documentationFiles.forEach((file) => {
  test(`${file} exists and is substantial`, () => {
    assert.equal(fs.existsSync(file), true);
    assert.ok(fs.readFileSync(file, 'utf8').length > 1500);
  });
});

test('product manual documents every primary workflow', () => {
  const manual = fs.readFileSync('docs/PRODUCT_MANUAL.md', 'utf8');

  [
    '双日程',
    '标记完成',
    '合并时段',
    '火漆封印',
    '历史长河',
    '打印',
    '封疆大吏',
    '同步',
  ].forEach((term) => assert.match(manual, new RegExp(term)));
});
