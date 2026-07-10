# Time River Mobile UI And Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stabilize Time River's mobile schedule interactions, correct time-range presentation, and add complete product and technical documentation without changing storage or API behavior.

**Architecture:** Keep the existing static frontend and Express API. Render desktop and mobile slot editing surfaces together, let responsive CSS select the active surface, and centralize shared time/slug rules in `public/shared.js`. Add dependency-free Node tests plus browser-based responsive verification.

**Tech Stack:** Node.js 24, Express 4, PostgreSQL through `pg`, static HTML/CSS/JavaScript, Node built-in `node:test` and `vm`.

## Global Constraints

- Do not modify database credentials, `DATABASE_URL` behavior, Render persistence, schemas, or existing data.
- Preserve all schedule and archive API payload formats.
- Preserve the current light, restrained visual language and keep the first mobile viewport focused on schedule information.
- Keep the main mobile action area at the bottom of the page and never make it fixed.
- Use no new runtime or development dependencies.
- Test at 320px, 390px, and 430px portrait widths and one landscape viewport.

---

### Task 1: Add Regression Test Harness And Shared-Logic Tests

**Files:**
- Create: `tests/helpers/load-time-river.js`
- Create: `tests/shared.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: browser IIFE in `public/shared.js`.
- Produces: `loadTimeRiver(pathname = '/')` returning the `window.TimeRiver` public API in a VM context; `npm test` running all Node tests.

- [ ] **Step 1: Create the VM loader**

```js
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadTimeRiver(pathname = '/') {
  const source = fs.readFileSync(path.join(process.cwd(), 'public', 'shared.js'), 'utf8');
  const context = { window: { location: { pathname } } };
  vm.runInNewContext(source, context, { filename: 'public/shared.js' });
  return context.window.TimeRiver;
}

module.exports = { loadTimeRiver };
```

- [ ] **Step 2: Write failing tests for inclusive ranges and uppercase realm names**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTimeRiver } = require('./helpers/load-time-river');

test('formatHourRange ends on the final occupied cell', () => {
  const { formatHourRange } = loadTimeRiver();
  assert.equal(formatHourRange(6, 3), '06:00~08:00');
  assert.equal(formatHourRange(23, 3), '23:00~01:00');
});

test('toSlug normalizes uppercase Latin letters', () => {
  const { toSlug } = loadTimeRiver();
  assert.equal(toSlug('Weekend Plan'), 'weekend-plan');
});
```

- [ ] **Step 3: Run the focused tests and verify RED**

Run: `node --test tests/shared.test.js`

Expected: two failing tests showing `06:00~09:00` and `eekend-lan`.

- [ ] **Step 4: Add the test script**

```json
"scripts": {
  "check": "node scripts/check.js",
  "test": "node --test",
  "start": "node --disable-warning=ExperimentalWarning server.js",
  "dev": "node --disable-warning=ExperimentalWarning --watch server.js"
}
```

- [ ] **Step 5: Commit the red test harness**

```bash
git add package.json tests/helpers/load-time-river.js tests/shared.test.js
git commit -m "test: add shared logic regressions"
```

### Task 2: Correct Shared Time And Realm Rules

**Files:**
- Modify: `public/shared.js`
- Test: `tests/shared.test.js`

**Interfaces:**
- Consumes: `formatHour(hour)` and existing realm filtering constants.
- Produces: inclusive `formatHourRange(startHour, span)` and lowercase-preserving `toSlug(value)`.

- [ ] **Step 1: Implement the inclusive final-cell calculation**

```js
function formatHourRange(startHour, span) {
  if (span <= 1) return formatHour(startHour);
  const endHour = (startHour + span - 1) % 24;
  return `${formatHour(startHour)}~${formatHour(endHour)}`;
}
```

- [ ] **Step 2: Normalize realm names before filtering**

```js
function toSlug(value) {
  return normalizeText(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(REALM_FILTER_PATTERN, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
```

- [ ] **Step 3: Run tests and verify GREEN**

Run: `npm test`

Expected: two tests pass with zero failures.

- [ ] **Step 4: Commit the shared rules**

```bash
git add public/shared.js
git commit -m "fix: correct time ranges and realm slugs"
```

### Task 3: Stabilize Mobile Slot Rendering And Controls

**Files:**
- Create: `tests/mobile-contracts.test.js`
- Modify: `public/main.js`
- Modify: `public/index.html`
- Modify: `public/styles.css`

**Interfaces:**
- Consumes: normalized schedule data, `formatHour`, `getPeriodLabel`, and existing editor modal callbacks.
- Produces: `.slot-edit-button`, semantic `.slot-checkbox` buttons, labelled `.merge-select` controls, and viewport-independent content previews.

- [ ] **Step 1: Write failing source-contract tests**

```js
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
  assert.match(mainSource, /aria-pressed/);
  assert.match(mainSource, /select\.setAttribute\('aria-label'/);
});

test('mobile editor exposes a named dialog and close button', () => {
  assert.match(indexSource, /role="dialog" aria-modal="true" aria-labelledby="slot-expand-title"/);
  assert.match(indexSource, /id="slot-expand-close"[^>]+aria-label="关闭编辑"/);
});
```

- [ ] **Step 2: Run the contracts and verify RED**

Run: `node --test tests/mobile-contracts.test.js`

Expected: all three tests fail because semantic mobile controls are not implemented.

- [ ] **Step 3: Render a mobile edit button for every slot**

Create a `button` before the desktop textarea on every render, set its visible text to the current value, and use an accessible label such as `编辑第一天 上午 06:00，当前为空`. Bind it directly to `openExpandPanel`; do not bind editing to the outer card.

- [ ] **Step 4: Convert quick completion to a semantic button**

Use `document.createElement('button')`, set `type = 'button'`, set `aria-label` and `aria-pressed`, and update `aria-pressed` whenever completion toggles. Preserve the current right-side placement and visual state.

- [ ] **Step 5: Label the duration selector and normalize editor titles**

Set the native select label to `调整第一天 06:00 的时长`. Format the editor title as `${dayName} · ${period ? `${period} ` : ''}${formatHour(hour)}`.

- [ ] **Step 6: Update responsive CSS**

Hide `.slot-edit-button` on desktop, show it on mobile, hide `.slot-input` only on mobile, and keep controls in the second row of populated cards. Empty edit buttons remain visually blank but fill the slot. Add visible `:focus-visible` outlines.

- [ ] **Step 7: Add dialog semantics in HTML**

Add `role="dialog"`, `aria-modal="true"`, and `aria-labelledby="slot-expand-title"` to the editor panel. Add `aria-label="关闭编辑"` to its close button.

- [ ] **Step 8: Run tests and checks**

Run: `npm test`

Run: `npm run check`

Expected: all tests and syntax/config checks pass.

- [ ] **Step 9: Commit the mobile interaction layer**

```bash
git add tests/mobile-contracts.test.js public/main.js public/index.html public/styles.css
git commit -m "fix: stabilize mobile slot interactions"
```

### Task 4: Repair Mobile Panels, Bottom Actions, And History Interaction

**Files:**
- Modify: `tests/mobile-contracts.test.js`
- Modify: `public/index.html`
- Modify: `public/history.js`
- Modify: `public/styles.css`

**Interfaces:**
- Consumes: current action IDs, history archive payloads, and mobile breakpoint at 720px.
- Produces: wrapped bottom action grid, static mobile history top bar, safe archive title nodes, and a `产品说明` link.

- [ ] **Step 1: Add failing contracts for navigation and history safety**

```js
const historySource = fs.readFileSync('public/history.js', 'utf8');
const stylesSource = fs.readFileSync('public/styles.css', 'utf8');

test('the bottom actions include the product guide without horizontal scrolling', () => {
  assert.match(indexSource, /href="\/guide\.html"[^>]*>产品说明<\/a>/);
  assert.doesNotMatch(stylesSource, /\.topbar-mobile-dock \.topbar-actions[\s\S]*?overflow-x:\s*auto/);
});

test('history titles are built with text nodes', () => {
  assert.doesNotMatch(historySource, /button\.innerHTML/);
  assert.match(historySource, /titleElement\.textContent = archive\.title/);
});
```

- [ ] **Step 2: Run the focused contracts and verify RED**

Run: `node --test tests/mobile-contracts.test.js`

Expected: guide/navigation and history-title tests fail.

- [ ] **Step 3: Add the product guide action**

Add `<a class="btn" id="guide-link" href="/guide.html">产品说明</a>` alongside the existing bottom actions.

- [ ] **Step 4: Replace the mobile horizontal scroller with a grid**

Use two equal columns, a full-width sync status, 44px action targets, and natural wrapping. Keep the entire action card after the schedule and summary.

- [ ] **Step 5: Repair summary and history sticky layout**

Keep `.panel-actions` auto-width in mobile headers while `.modal-actions` remains full width. Make the history page top bar static at mobile widths so only `.mobile-day-switcher` stays sticky.

- [ ] **Step 6: Build archive titles without HTML interpolation**

Create `span.timeline-item-title` and `span.timeline-item-meta`, assign both with `textContent`, and append them to each timeline button.

- [ ] **Step 7: Run tests and checks**

Run: `npm test`

Run: `npm run check`

Expected: all tests and checks pass.

- [ ] **Step 8: Commit shell and history repairs**

```bash
git add tests/mobile-contracts.test.js public/index.html public/history.js public/styles.css
git commit -m "fix: polish mobile navigation and history"
```

### Task 5: Add Product Manual, Architecture, And Core Logic Documentation

**Files:**
- Create: `tests/documentation.test.js`
- Create: `docs/PRODUCT_MANUAL.md`
- Create: `docs/TECHNICAL_ARCHITECTURE.md`
- Create: `docs/CORE_LOGIC.md`
- Create: `public/guide.html`
- Modify: `public/styles.css`
- Modify: `scripts/check.js`

**Interfaces:**
- Consumes: final UI labels, API routes, deployment configuration, and storage behavior.
- Produces: three repository documents and a static in-app product guide.

- [ ] **Step 1: Write failing documentation contracts**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

for (const file of [
  'docs/PRODUCT_MANUAL.md',
  'docs/TECHNICAL_ARCHITECTURE.md',
  'docs/CORE_LOGIC.md',
  'public/guide.html',
]) {
  test(`${file} exists and is substantial`, () => {
    assert.equal(fs.existsSync(file), true);
    assert.ok(fs.readFileSync(file, 'utf8').length > 1500);
  });
}
```

- [ ] **Step 2: Run the documentation tests and verify RED**

Run: `node --test tests/documentation.test.js`

Expected: all four tests fail because the files do not exist.

- [ ] **Step 3: Write the product manual**

Cover product purpose, two-day editing, mobile editing, completion, merging/restoring, summaries, sealing, history, printing, realms, synchronization, data cautions, and troubleshooting with the final labels.

- [ ] **Step 4: Write technical architecture**

Document process topology, file responsibilities, browser/server/storage flow, API contracts, PostgreSQL and local fallback, Render lifecycle, backups, security boundary, failure modes, test commands, and deployment checklist. State that Render local backup files are ephemeral.

- [ ] **Step 5: Write core logic**

Document canonical hours, normalization, merge clamping, inclusive range display, completion state, save debounce, archive immutability, realm isolation, summary calculation, printing, and invariants.

- [ ] **Step 6: Build the static product guide**

Use semantic `article`, `nav`, headings, lists, and tables. Include a top `返回计划` link and concise section navigation. Reuse `styles.css`; add guide-specific responsive classes without a separate runtime script.

- [ ] **Step 7: Include the guide in syntax/config checks**

Update `scripts/check.js` to assert the guide link and all required documentation files exist.

- [ ] **Step 8: Run tests and checks**

Run: `npm test`

Run: `npm run check`

Expected: all documentation contracts and project checks pass.

- [ ] **Step 9: Commit documentation**

```bash
git add tests/documentation.test.js docs/PRODUCT_MANUAL.md docs/TECHNICAL_ARCHITECTURE.md docs/CORE_LOGIC.md public/guide.html public/styles.css scripts/check.js
git commit -m "docs: add product and architecture guides"
```

### Task 6: Complete Mobile Audit, Verification, And Delivery

**Files:**
- Create: `docs/audits/mobile-ui-2026-07-10/REPORT.md`
- Modify: audit screenshots only when recapturing final accepted states.

**Interfaces:**
- Consumes: completed implementation and audit screenshots.
- Produces: evidence-linked audit report and verified Git commit history.

- [ ] **Step 1: Run the complete automated suite**

Run: `npm test`

Run: `npm run check`

Run: `git diff --check`

Expected: zero test failures, all project checks pass, and no whitespace errors.

- [ ] **Step 2: Start an isolated local-file server**

Run PowerShell with `DATABASE_URL` set to a single space, `PORT=3700`, and temporary `LOCAL_DATA_PATH`/`BACKUP_DIR`, then run `node server.js`.

- [ ] **Step 3: Verify the full mobile flow**

At 320px, 390px, and 430px: verify no horizontal overflow, edit/save text, merge to three hours and restore, quick complete, switch both days, show summary, reach every bottom action, seal an archive, switch both history days after scrolling, open the product guide, and inspect console errors. Repeat a desktop-to-mobile resize to confirm preview persistence.

- [ ] **Step 4: Verify print presentation**

Confirm print media hides interactive controls and preserves schedule/archive/guide readable content. Do not alter or submit production data.

- [ ] **Step 5: Write the audit report**

Record every captured step, general health, fixed risks, accessibility limits, and screenshot filenames in `REPORT.md`.

- [ ] **Step 6: Request and address code review**

Review the complete diff against this plan, fix all Critical and Important findings, and rerun the full verification suite.

- [ ] **Step 7: Commit final audit adjustments**

```bash
git add docs/audits/mobile-ui-2026-07-10 public tests scripts package.json
git commit -m "test: document mobile UI verification"
```

- [ ] **Step 8: Push main**

```bash
git push origin main
```
