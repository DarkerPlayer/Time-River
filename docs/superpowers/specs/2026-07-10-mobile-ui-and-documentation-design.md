# Time River Mobile UI And Documentation Design

## Context

Time River is a two-day schedule planner optimized for mobile use. The current implementation has accumulated several responsive patches that work at one viewport state but fail after resizing, orientation changes, or sticky-element overlap. The project also lacks product-facing documentation and repeatable regression coverage for its core time calculations and mobile interaction contracts.

This design keeps the current visual language, Express server, PostgreSQL/file storage behavior, API schema, archive model, and realm URLs. Database credentials, persistence configuration, and existing data are explicitly out of scope.

## Goals

- Keep the first mobile viewport focused on day and time information.
- Make slot content visible regardless of the viewport width at initial render.
- Preserve quick completion on the right and a compact duration selector.
- Make editing, merging, completion, day switching, archiving, history viewing, and printing reliable on common phone widths.
- Correct displayed merged ranges so a three-cell block at 06:00 reads `06:00~08:00`.
- Add a detailed product manual available from the application.
- Add repository documentation for product usage, technical architecture, and core logic.
- Add automated regression checks without adding runtime dependencies.

## Non-Goals

- No database, credential, Render environment, backup, or migration changes.
- No rewrite into a frontend framework.
- No archive deletion or editing.
- No authentication or authorization changes for shared realms.
- No change to the schedule or archive API payload formats.

## Evidence And Root Causes

The mobile flow was reproduced at 390 x 844 and 320 x 568 using realistic content.

1. Slot previews are created only when `window.innerWidth <= 720` during rendering. If the page renders at a wider width and later becomes narrow, CSS hides the textarea but no preview exists, making saved content appear blank.
2. `formatHourRange` adds the full span to the starting hour. A three-cell block starting at 06:00 therefore displays an exclusive end of 09:00 instead of the final occupied cell at 08:00.
3. The mobile summary gives `.panel-actions` a width of 100% inside a horizontal header, squeezing the heading into vertical text.
4. The bottom action bar uses a single-line horizontal scroller with a hidden scrollbar, so later actions are not discoverable.
5. The history top bar and day switcher are both sticky near the top. At the bottom of a long archive, the top bar covers the day switcher and intercepts taps.
6. Slot edit areas and quick-complete controls are generic `div` elements without stable button names or keyboard behavior.
7. The mobile editor title displays either a period or a raw number, producing inconsistent labels such as `第二天 · 9`.
8. Realm slug conversion removes uppercase letters instead of normalizing them to lowercase.
9. History list titles are inserted with `innerHTML`; text nodes are safer and preserve literal archive names.

## Interaction Design

### Schedule Slots

Each rendered slot will always contain two editing surfaces:

- A desktop textarea, visible above 720px.
- A mobile edit button, visible at or below 720px.

The mobile button is created independently of the current viewport width, so resizing cannot remove the saved preview. It has an accessible label containing the day and time. Its visible text remains blank for empty slots and shows the saved description for populated slots.

The quick-complete control remains on the right as a real button with `aria-pressed`. The duration control remains a native select, rendered as a compact chevron button on mobile, with an accessible label describing the starting time. Both controls are siblings of the edit button, so selecting a duration or toggling completion cannot open the editor.

The editor title uses `day + period + formatted time`, for example `第一天 · 上午 06:00`. Closing, tapping the backdrop, or pressing Escape discards uncommitted edits; only Save or Ctrl/Cmd+Enter persists them.

### Time Merging

The stored merge span continues to represent occupied one-hour cells. Display labels use the final occupied cell, calculated as `start + span - 1`, including wraparound after midnight. Summary totals continue to add the span as hours.

### Mobile Navigation And Panels

- The day switcher stays sticky and remains the only persistent mobile control.
- The main action area stays after all schedule and summary content.
- Bottom actions use a two-column grid with 44px touch targets and no hidden horizontal scrolling.
- The new `产品说明` action opens the product manual.
- Summary headers preserve a horizontal heading and action button.
- On the history page, the top return/print bar is static on mobile so it cannot overlap the sticky day switcher.
- Archive detail remains read-only and retains independent first-day and second-day switching.

## Documentation Design

The repository will contain:

- `docs/PRODUCT_MANUAL.md`: complete end-user product manual.
- `docs/TECHNICAL_ARCHITECTURE.md`: runtime, deployment, storage, API, frontend, and operational architecture.
- `docs/CORE_LOGIC.md`: schedule normalization, merge rules, save flow, archive immutability, realm isolation, summaries, and printing.
- `public/guide.html`: a mobile-friendly product manual using the existing visual system.

The in-app guide is intentionally static so it remains available even if the API or database is unavailable. It links back to the current schedule and does not read or mutate user data.

## Data Flow And Error Handling

The existing data flow is preserved:

1. The browser fetches the current schedule.
2. Local edits update normalized in-memory data.
3. A 500ms debounce posts the complete schedule.
4. Sync status communicates connecting, syncing, synced, or failed states.
5. Archiving posts a title and normalized snapshot, producing an immutable history record.

UI changes do not alter the payload. Failed saves continue to preserve the local in-memory edit and display `同步失败`. Failed archive creation keeps the dialog open and displays the returned error. Documentation remains available without storage readiness.

## Accessibility Contract

- Mobile slot editing, quick completion, duration selection, day switching, and documentation navigation are keyboard-focusable controls.
- Controls have stable accessible names and state via `aria-label`, `aria-pressed`, or native select semantics.
- Focus indicators remain visible.
- Touch targets are at least 34px for compact in-slot controls and 44px for primary actions.
- Visual completion state is not the only state signal; `aria-pressed` communicates it programmatically.
- Screenshot review can identify visual risks, but final verification also checks DOM roles and keyboard activation.

## Verification Strategy

Automated tests use Node's built-in test runner and VM execution of `public/shared.js`, avoiding new dependencies. They cover:

- Inclusive merged time ranges, including midnight wraparound.
- Summary item and hour totals.
- Uppercase realm-name normalization.
- Required product guide and repository document contracts.
- Mobile slot controls and labels through source-level UI contracts.

Browser verification covers 320px, 390px, and 430px portrait widths plus a landscape check. The flow includes initial view, empty-slot edit, saved preview, duration merge and restore, quick completion, day switching, summary, archive creation, history day switching, bottom actions, guide navigation, and print styles. Console errors and horizontal overflow are checked at each relevant page.

## Acceptance Criteria

- Saved text remains visible after switching between desktop and mobile widths.
- A three-hour block from 06:00 displays `06:00~08:00` everywhere.
- Duration selection and quick completion never open the edit dialog.
- The summary heading is horizontal at 320px.
- Every bottom action is visible without horizontal scrolling.
- History day switching remains tappable after scrolling to the bottom.
- Empty slots display no placeholder text.
- The product manual is reachable from the bottom action area and readable at 320px.
- All three repository documents accurately match the final implementation.
- Existing schedule, archive, realm, database, and deployment behavior remains unchanged.
