// Self-check for the Day-3 guardrails: settlement (pure) and the money service's approval gate (database,
// no PayPal: every capture here is refused before it reaches PayPal).
//   npm run check:day3    exits non-zero on any failure; cleans up the rows it writes

import assert from 'node:assert/strict';
import { ApprovalError, claimApproval, createApproval } from '../lib/approval';
import { auditScope } from '../lib/audit';
import { db } from '../lib/db';
import { settle, type AngleFinding } from '../lib/inspector';
import { capture } from '../lib/money';
import { ITEMS } from '../lib/schedule';

const TAG = 'CHECK-DAY3';
const knownMarks = ITEMS['BLZ-NAVY-40R'].knownMarks;
const photoIds = { front: { pickup: 'P1', return: 'R1' }, 'left-sleeve': { pickup: 'P3', return: 'R3' } };

const finding = (over: Partial<AngleFinding>): AngleFinding => ({
  angle: 'front',
  kind: 'new_damage',
  description: 'Make-up stain on the left lapel',
  clauseId: 'S1',
  severity: 'moderate',
  box: { x: 0.3, y: 0.2, w: 0.1, h: 0.1 },
  pickupPhotoId: 'P1',
  returnPhotoId: 'R1',
  knownMarkId: null,
  confidence: 0.91,
  ...over,
});
const one = (f: Partial<AngleFinding>, remainingGBP = 60) => settle([finding(f)], { photoIds, knownMarks, remainingGBP })[0];

function checkSettlement() {
  // The demo pair: the lapel stain is charged at the middle of its band, the known cuff mark is not.
  const lapel = one({});
  assert.equal(lapel.outcome, 'charge');
  assert.equal(lapel.proposedGBP, 24);
  const cuff = one({ angle: 'left-sleeve', kind: 'known_mark', knownMarkId: 'KM-38-CUFF', pickupPhotoId: 'P3', returnPhotoId: 'R3', clauseId: null, severity: null });
  assert.equal(cuff.outcome, 'no_charge');
  assert.equal(cuff.proposedGBP, null);

  assert.deepEqual([one({ confidence: 0.6 }).outcome, one({ confidence: 0.6 }).proposedGBP], ['owner_look', null]);
  assert.equal(one({ confidence: 0.75 }).outcome, 'charge');
  assert.equal(one({ severity: 'minor' }).proposedGBP, 18);
  assert.equal(one({ kind: 'missing_part', clauseId: 'B1', severity: 'minor' }).proposedGBP, 6);
  assert.equal(one({ severity: 'major' }).outcome, 'owner_look');
  assert.equal(one({ kind: 'wear', clauseId: 'W1' }).outcome, 'no_charge');
  assert.equal(one({ kind: 'dirt' }).outcome, 'no_charge');
  assert.equal(one({ clauseId: 'X9' }).outcome, 'owner_look');
  assert.equal(one({ clauseId: null }).outcome, 'owner_look');
  assert.equal(one({ returnPhotoId: 'R3' }).outcome, 'owner_look');
  assert.equal(one({ knownMarkId: 'KM-NOPE', kind: 'known_mark' }).outcome, 'owner_look');
  assert.equal(one({ knownMarkId: 'KM-38-CUFF' }).outcome, 'owner_look'); // new damage matched to a known mark

  // Capped at the remaining hold across findings: £24 then £6 of a £30 hold, then nothing left.
  const capped = settle([finding({}), finding({}), finding({})], { photoIds, knownMarks, remainingGBP: 30 });
  assert.deepEqual(capped.map((f) => f.proposedGBP), [24, 6, null]);
  assert.deepEqual(capped.map((f) => f.outcome), ['charge', 'charge', 'owner_look']);
  assert.equal(one({ clauseId: 'R1', severity: 'moderate' }).proposedGBP, 60); // £140 replacement capped at £60
}

async function refused(run: () => Promise<unknown>, why: RegExp) {
  await assert.rejects(run, (err) => err instanceof ApprovalError && why.test(err.message));
}

async function checkGate() {
  const authorizationId = `${TAG}-${Date.now()}`;
  const { id, token } = await createApproval({ authorizationId, maxGBP: '24.00', finalCapture: true, approver: TAG });

  await refused(() => capture(token, '24.01'), /more than the approved/);
  await refused(() => capture('not-a-token', '1.00'), /rejected/);
  const [h, p, s] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), max: '60.00' })).toString('base64url');
  await refused(() => capture(`${h}.${forged}.${s}`, '60.00'), /rejected/);

  await db.approval.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await refused(() => capture(token, '24.00'), /expired or already used/);
  await db.approval.update({ where: { id }, data: { expiresAt: new Date(Date.now() + 60_000) } });

  // Claimed once (directly, so no PayPal call), then refused as used.
  assert.equal((await claimApproval(token, '24.00')).authorizationId, authorizationId);
  await refused(() => capture(token, '24.00'), /expired or already used/);

  assert.equal(await db.auditEvent.count({ where: { hireRef: TAG, type: 'capture.refused' } }), 5);
}

async function main() {
  checkSettlement();
  console.log('settlement: ok');
  await auditScope.run(TAG, checkGate);
  console.log('approval gate: ok');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.approval.deleteMany({ where: { authorizationId: { startsWith: TAG } } });
    await db.auditEvent.deleteMany({ where: { hireRef: TAG } });
    await db.$disconnect();
  });
