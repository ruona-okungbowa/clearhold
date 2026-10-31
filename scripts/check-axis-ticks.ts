// Self-check for the Hold timeline's date axis.
//   npm run check:axis    exits non-zero if axisTicks breaks
// Runs in UK time so the 25 Oct clock change is inside the tested range.

import assert from 'node:assert/strict';

const DAY = 86_400_000;
const at = (iso: string) => new Date(iso).getTime();
const isMidnight = (t: number) => {
  const d = new Date(t);
  return d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0;
};

async function main() {
  process.env.TZ = 'Europe/London';
  const { axisTicks } = await import('../components/studio/HoldTimeline');

  // The control room's real range: 27 Sep to 28 Nov, across the clock change on 25 Oct.
  const min = at('2026-09-27T10:28:00Z');
  const max = at('2026-11-28T20:04:00Z');
  const ticks = axisTicks(min, max);
  assert.ok(ticks.length > 0 && ticks.length <= 6, `expected 1-6 ticks, got ${ticks.length}`);
  assert.ok(ticks.every(isMidnight), 'every tick is at local midnight, including after 25 Oct');
  assert.ok(
    ticks.every((t) => t > min && t <= max),
    'every tick is inside the range',
  );
  assert.deepEqual(
    ticks,
    [...ticks].sort((a, b) => a - b),
    'ticks are in order',
  );

  // Short range: daily ticks.
  assert.equal(axisTicks(at('2026-10-01T09:00:00Z'), at('2026-10-04T09:00:00Z')).length, 3);

  // Long range: never more than 6 until the largest step (182 days) runs out.
  for (const days of [7, 30, 90, 365]) {
    const n = axisTicks(min, min + days * DAY).length;
    assert.ok(n >= 1 && n <= 6, `${days} days gave ${n} ticks`);
  }

  // A range inside one day has no midnight to mark.
  assert.deepEqual(axisTicks(at('2026-10-01T09:00:00Z'), at('2026-10-01T17:00:00Z')), []);

  console.log('axisTicks: all checks passed');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
