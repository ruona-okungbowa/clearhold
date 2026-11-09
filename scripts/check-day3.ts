// Self-check for the Day-3 guardrails: settlement (pure), the money service's approval gate, and the contest and
// 48-hour guards through the real server actions (database; PayPal's two payment calls are stubbed, so nothing moves).
//   npm run check:day3    exits non-zero on any failure; cleans up the rows it writes

import 'next/dist/server/node-environment-baseline'; // first: Next's request stores need its AsyncLocalStorage global
import assert from 'node:assert/strict';
import { PaymentsController } from '@paypal/paypal-server-sdk';
import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external';
import { workUnitAsyncStorage } from 'next/dist/server/app-render/work-unit-async-storage.external';
import { approveCharges, runInspector, setAmount, settleHire } from '../app/hire/[hireRef]/actions';
import { acceptCharges, contestCharges } from '../app/r/[token]/actions';
import { ApprovalError, claimApproval, createApproval } from '../lib/approval';
import { auditScope } from '../lib/audit';
import { db } from '../lib/db';
import { clampPence, isNewMark, personPence, settle, type AngleFinding } from '../lib/inspector';
import { capture } from '../lib/money';
import { renterLink } from '../lib/renter-link';
import { CLAUSES } from '../lib/schedule';

const TAG = 'CHECK-DAY3';
const HOUR = 3_600_000;
const knownMarks = [{ id: 'KM-38-CUFF', description: 'Faint mark on the left cuff', firstSeen: 'hire #38' }];
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

  // Capped at the remaining hold across findings: buttons of a £10 hold go £6, then the £4 left, then nothing.
  const button = { kind: 'missing_part', clauseId: 'B1' } as const;
  const capped = settle([finding(button), finding(button), finding(button)], { photoIds, knownMarks, remainingGBP: 10 });
  assert.deepEqual(capped.map((f) => f.proposedGBP), [6, 4, null]);
  assert.deepEqual(capped.map((f) => f.outcome), ['charge', 'charge', 'owner_look']);

  // S1 once per garment: the highest point carries it (ties to the first angle), the rest are kept, uncharged.
  const sleeve = { angle: 'left-sleeve', pickupPhotoId: 'P3', returnPhotoId: 'R3' };
  const stains = settle([finding({ ...sleeve }), finding({ severity: 'minor' }), finding({}), finding(button)], { photoIds, knownMarks, remainingGBP: 60 });
  assert.deepEqual(stains.map((f) => [f.outcome, f.proposedGBP]), [['no_charge', null], ['no_charge', null], ['charge', 24], ['charge', 6]]);
  assert.equal(stains[0].reason, 'Covered by the S1 charge on front');
  assert.deepEqual(stains[0].box, finding({}).box);
  // S1 comes off the hold last, so it is what gets capped; a used-up hold sends every stain to a person.
  assert.deepEqual(settle([finding({}), finding(button)], { photoIds, knownMarks, remainingGBP: 20 }).map((f) => f.proposedGBP), [14, 6]);
  assert.deepEqual(settle([finding({}), finding({ ...sleeve }), finding(button)], { photoIds, knownMarks, remainingGBP: 6 }).map((f) => f.outcome), ['owner_look', 'owner_look', 'charge']);
  assert.equal(one({ clauseId: 'R1', severity: 'moderate' }).proposedGBP, 60); // £140 replacement capped at £60

  // Unrecorded pick-up marks: logged only if confident and citing the real photo pair, and never priced.
  const mark = { kind: 'known_mark', clauseId: null, severity: null } as const;
  assert.deepEqual([one(mark).outcome, one(mark).proposedGBP, isNewMark(one(mark))], ['owner_look', null, true]);
  assert.equal(isNewMark(one({ ...mark, confidence: 0.6 })), false);
  assert.equal(isNewMark(one({ ...mark, returnPhotoId: 'R3' })), false);
  assert.equal(isNewMark(one({})), false);

  // A person's amount: into the band, then down to what the hold has left.
  const [s1, r1] = [CLAUSES.find((c) => c.id === 'S1')!, CLAUSES.find((c) => c.id === 'R1')!];
  assert.equal(clampPence(2500, s1, 6000), 2500);
  assert.equal(clampPence(9999, s1, 6000), 3000);
  assert.equal(clampPence(500, s1, 6000), 1800);
  assert.equal(clampPence(9999, s1, 1000), 1000);
  assert.equal(clampPence(100, r1, 6000), 6000); // the plan's tear: £140 replacement, £60 hold

  // The AI's charge can only go down, even below the band; an owner-look amount is clamped; blank undoes either.
  assert.equal(personPence('charge', 2400, s1, 1000, 6000), 1000);
  assert.equal(personPence('charge', 2400, s1, 9999, 6000), null); // can't raise: stays the AI's amount
  assert.equal(personPence('charge', 2400, s1, 0, 6000), 0);
  assert.equal(personPence('charge', 2400, s1, null, 6000), null);
  assert.equal(personPence('owner_look', 0, s1, 9999, 6000), 3000);
  assert.equal(personPence('owner_look', 0, s1, 0, 6000), null);
  assert.equal(personPence('owner_look', 0, s1, null, 6000), null);
}

async function checkMarks() {
  const seeded = await db.itemMark.findUnique({ where: { id: 'KM-38-CUFF' } });
  assert.equal(seeded?.itemRef, 'BLZ-NAVY-40R');
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

let paypalCaptures = 0;

function stubPayPal() {
  PaymentsController.prototype.captureAuthorizedPayment = (async () => {
    paypalCaptures += 1;
    return { statusCode: 201, headers: {}, result: { id: `${TAG}-C-${Date.now()}-${paypalCaptures}`, status: 'COMPLETED' } };
  }) as never;
  PaymentsController.prototype.getAuthorizedPayment = (async () => ({ statusCode: 200, headers: {}, result: { status: 'CAPTURED' } })) as never;
}

// The server actions call refresh(), which only runs inside a Server Action's request stores.
const inAction = <T>(run: () => Promise<T>) =>
  workAsyncStorage.run({ page: '/check-day3' } as never, () => workUnitAsyncStorage.run({ phase: 'action' } as never, run));

let hires = 0;

// A returned hire on a fake hold, with one £24 charge and a live renter link.
async function returnedHire() {
  const hireRef = `${TAG}-${Date.now()}-${++hires}`;
  const now = new Date();
  const hire = await db.hire.create({
    data: { hireRef, branch: 'Halifax', itemRef: TAG, feeGBP: 28, depositGBP: 60, startAt: now, dueBackAt: now, returnedAt: now, status: 'returned', seeded: true },
  });
  const auth = await db.authorization.create({
    data: { id: `${hireRef}-A`, hireId: hire.id, amountGBP: 60, status: 'CREATED', createdAt: now, honourEndsAt: now, expiresAt: new Date(now.getTime() + 24 * HOUR) },
  });
  const { id: findingId } = await db.finding.create({
    data: { hireId: hire.id, angle: 'front', kind: 'new_damage', description: TAG, clauseId: 'S1', severity: 'moderate', confidence: 0.91, outcome: 'charge', reason: TAG, proposedGBP: 24, model: TAG, promptVersion: TAG },
  });
  const token = await renterLink(hireRef, new Date(now.getTime() + 24 * HOUR));
  const newestFinal = () => db.approval.findFirstOrThrow({ where: { authorizationId: auth.id, finalCapture: true }, orderBy: { createdAt: 'desc' } });
  const hireStatus = async () => (await db.hire.findUniqueOrThrow({ where: { id: hire.id } })).status;
  const contest = () => db.contest.findUniqueOrThrow({ where: { hireId: hire.id } });
  return { hireRef, hireId: hire.id, authId: auth.id, findingId, token, newestFinal, hireStatus, contest };
}

const approve = (hireRef: string) => inAction(() => approveCharges(hireRef));
const staffSettle = (hireRef: string) => inAction(() => settleHire(hireRef));
const backdate = (id: string, ms: number) => db.approval.update({ where: { id }, data: { createdAt: new Date(Date.now() - ms) } });
const WINDOW_REFUSAL = /^The renter has until .+ London time to accept or contest$/;

async function checkContestGuards() {
  const h = await returnedHire();
  await approve(h.hireRef);
  assert.equal(await inAction(() => contestCharges(h.token, { findingId: null, note: 'Not me', photoId: null })), null);
  assert.equal(await h.hireStatus(), 'contested');
  assert.equal((await h.contest()).contestedGBP?.toFixed(2), '24.00');

  const lower = new FormData();
  lower.set('amountGBP', '20');
  await inAction(() => setAmount(h.hireRef, h.findingId, lower));
  await approve(h.hireRef);
  assert.equal((await h.newestFinal()).maxGBP.toFixed(2), '20.00');
  assert.equal((await h.contest()).status, 'resolved');
  assert.equal(await h.hireStatus(), 'returned');

  // (a) Resolved at a lower amount, and the inspector still can't replace the findings.
  await assert.rejects(inAction(() => runInspector(h.hireRef)), /^Error: This hire was contested; its findings are final\. Lower or remove charges instead$/);
  assert.equal((await db.finding.findUniqueOrThrow({ where: { id: h.findingId } })).setGBP?.toFixed(2), '20.00');
  console.log('(a) resolved contest refuses Run Inspector: ok');

  // (b) The ceiling is the £24 contested, not the £20 it was resolved at. setAmount can't raise, so the row is set directly.
  const total = (proposedGBP: number, setGBP: number | null) => db.finding.update({ where: { id: h.findingId }, data: { proposedGBP, setGBP } });
  const approvals = () => db.approval.count({ where: { authorizationId: h.authId } });
  const before = await approvals();
  await total(24.01, null);
  await assert.rejects(approve(h.hireRef), /keep or lower the charge: £24\.01 is more than the £24\.00 contested/);
  assert.equal(await approvals(), before);
  await total(24, null);
  await approve(h.hireRef);
  assert.equal((await h.newestFinal()).maxGBP.toFixed(2), '24.00');
  await total(24, 10);
  await approve(h.hireRef);
  assert.equal((await h.newestFinal()).maxGBP.toFixed(2), '10.00');
  assert.equal((await h.contest()).status, 'resolved');
  console.log('(b) after a resolve, higher refused, equal and lower accepted: ok');

  // (c) Once per hire, even after the first was resolved.
  assert.match((await contestCharges(h.token, { findingId: null, note: 'Again', photoId: null })) ?? '', /already been contested/);
  console.log('(c) second contest refused: ok');
}

async function checkRenterWindow() {
  const inside = await returnedHire();
  await approve(inside.hireRef);
  const approval = await inside.newestFinal();
  const captures = paypalCaptures;
  await assert.rejects(staffSettle(inside.hireRef), (err: Error) => WINDOW_REFUSAL.test(err.message));
  await backdate(approval.id, 48 * HOUR - 60_000);
  await assert.rejects(staffSettle(inside.hireRef), (err: Error) => WINDOW_REFUSAL.test(err.message));
  assert.equal(paypalCaptures, captures);
  assert.equal((await inside.newestFinal()).usedAt, null);
  assert.equal(await inside.hireStatus(), 'returned');

  assert.equal(await inAction(() => acceptCharges(inside.token, approval.id)), null);
  assert.equal(paypalCaptures, captures + 1);
  assert.equal(await inside.hireStatus(), 'settled');
  assert.equal((await db.capture.findUniqueOrThrow({ where: { approvalId: approval.id } })).amountGBP.toFixed(2), '24.00');
  console.log('(d) staff refused inside 48 hours, renter Accept captures: ok');

  const after = await returnedHire();
  await approve(after.hireRef);
  const closed = await after.newestFinal();
  await backdate(closed.id, 48 * HOUR + 60_000);
  await staffSettle(after.hireRef);
  assert.equal(paypalCaptures, captures + 2);
  assert.equal(await after.hireStatus(), 'settled');
  assert.ok((await after.newestFinal()).usedAt);
  assert.equal((await db.capture.findUniqueOrThrow({ where: { approvalId: closed.id } })).finalCapture, true);
  console.log('(e) staff settle after 48 hours captures: ok');
}

async function main() {
  checkSettlement();
  console.log('settlement: ok');
  await checkMarks();
  console.log('item marks: ok');
  await auditScope.run(TAG, checkGate);
  console.log('approval gate: ok');
  stubPayPal();
  await checkContestGuards();
  await checkRenterWindow();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    const hire = { hireRef: { startsWith: TAG } };
    await db.contest.deleteMany({ where: { hire } });
    await db.finding.deleteMany({ where: { hire } });
    await db.capture.deleteMany({ where: { authorizationId: { startsWith: TAG } } });
    await db.approval.deleteMany({ where: { authorizationId: { startsWith: TAG } } });
    await db.authorization.deleteMany({ where: { hire } });
    await db.hire.deleteMany({ where: hire });
    await db.auditEvent.deleteMany({ where: { hireRef: { startsWith: TAG } } });
    await db.$disconnect();
  });
