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
