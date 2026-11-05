// Sandbox check of capture, release and replay against real PayPal sandbox holds, through the same lib/hold.ts
// code the hire pages call.
//   npm run check:money             SPENDS one spare aged hold from scripts/.aged-holds.json; a voided hold can't be reused
//   npm run check:money -- reauth   SPENDS one part-captured hold due for the sweep: reauthorises it, then final capture
// Exits non-zero on any failure.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ApprovalError, createApproval } from '../lib/approval';
import { auditScope } from '../lib/audit';
import { db } from '../lib/db';
import { captureApproved, holdOf, holdsDueForReauth, reauthorizeHire, releaseHire } from '../lib/hold';
import { capture, getAuthorization, MoneyError, voidHold } from '../lib/money';

const WHO = 'check:money';
const step = (done: string) => console.log(`  ok  ${done}`);
const refusedBy = (why: RegExp) => (err: Error) => why.test(err.message);

async function main() {
  const spares: string[] = (JSON.parse(readFileSync('scripts/.aged-holds.json', 'utf8')) as { role: string; authId?: string }[])
    .filter((h) => h.role === 'spare' && h.authId)
    .map((h) => h.authId!);
  const auth = await db.authorization.findFirst({ where: { id: { in: spares }, status: 'CREATED', hire: { status: 'booked' } }, include: { hire: true } });
  if (!auth) throw new Error('No unspent spare hold: every spare in scripts/.aged-holds.json is used or not booked');
  const { hireRef, id: hireId, feeGBP } = auth.hire;
  console.log(`Spending spare hold ${auth.id} on hire ${hireRef}`);
  assert.equal((await getAuthorization(auth.id)).status, 'CREATED');

  await auditScope.run(hireRef, async () => {
    await assert.rejects(releaseHire(hireRef, WHO), refusedBy(/only a handed-over hire/));
    step('release refused before the fee is taken');

    // Capture, then replay of the same approval.
    const fee = feeGBP.toFixed(2);
    const { token } = await createApproval({ authorizationId: auth.id, maxGBP: fee, finalCapture: false, approver: WHO });
    const taken = await captureApproved(token, fee);
    assert.equal(taken.status, 'COMPLETED');
    assert.equal((await getAuthorization(auth.id)).status, 'PARTIALLY_CAPTURED');
    await db.hire.update({ where: { id: hireId }, data: { status: 'out' } });
    step(`fee £${fee} captured, hold stays open`);
    await assert.rejects(capture(token, fee), (err) => err instanceof ApprovalError);
    assert.equal(await db.capture.count({ where: { authorizationId: auth.id } }), 1);
    step('replaying the capture is refused, one capture on record');

    // Release guards, with real rows standing in for the inspector's findings.
    await assert.rejects(releaseHire(hireRef, WHO), refusedBy(/needs an inspection/));
    step('release refused with no inspection on record');
    const base = { hireId, kind: 'new_damage', description: WHO, confidence: 0.9, reason: WHO, model: WHO, promptVersion: WHO };
    const charge = await db.finding.create({ data: { ...base, angle: 'front', outcome: 'charge', clauseId: 'S1', proposedGBP: 24 } });
    await db.finding.create({ data: { ...base, angle: 'back', outcome: 'owner_look' } });
    await assert.rejects(releaseHire(hireRef, WHO), refusedBy(/still carries a charge/));
    step('release refused while a finding carries a charge');
    await db.finding.update({ where: { id: charge.id }, data: { setGBP: '0.00', setBy: WHO } });

    // The release.
    await releaseHire(hireRef, WHO);
    const { hire, auth: after, remainingGBP } = await holdOf(hireRef);
    assert.equal(after.status, 'VOIDED');
    assert.equal(hire.status, 'settled');
    assert.ok(hire.returnedAt);
    assert.equal(remainingGBP, Number(auth.amountGBP) - Number(fee));
    assert.equal((await getAuthorization(auth.id)).status, 'VOIDED');
    step(`released £${remainingGBP.toFixed(2)}: hold VOIDED at PayPal and in the database, hire settled`);

    // Replay of the void, a second tap, and a capture on the dead hold.
    await voidHold(`void-${auth.id}`, auth.id);
    assert.equal((await getAuthorization(auth.id)).status, 'VOIDED');
    step('replaying the void changes nothing');
    await assert.rejects(releaseHire(hireRef, WHO), refusedBy(/settled: only a handed-over hire/));
    step('a second release is refused before reaching PayPal');
    const late = await createApproval({ authorizationId: auth.id, maxGBP: '1.00', finalCapture: true, approver: WHO });
    await assert.rejects(captureApproved(late.token, '1.00'), (err) => err instanceof MoneyError && err.status === 422);
    assert.equal(await db.capture.count({ where: { authorizationId: auth.id } }), 1);
    step('PayPal refuses a capture on the voided hold');
    await db.approval.delete({ where: { id: late.id } });
  });
  await db.finding.deleteMany({ where: { hireId, model: WHO } });
  console.log(`\nAll passed. Hire ${hireRef} stays settled with its hold voided.`);
}

async function reauth() {
  const due = await holdsDueForReauth();
  console.log(`Due for the sweep: ${due.map((a) => a.hire.hireRef).join(', ') || 'none'}`);
  assert.ok(due.every((a) => a.hire.status === 'out' && !a.hire.seeded));
  // The last one, so earlier holds stay available for the reauthorisation on camera.
  const { hireRef, id: hireId } = due.at(-1)?.hire ?? {};
  if (!hireRef || !hireId) throw new Error('No hold is due for reauthorisation');
  const before = await holdOf(hireRef);
  assert.equal(before.remainingGBP, 60);
  assert.equal(before.auth.status, 'PARTIALLY_CAPTURED');

  await auditScope.run(hireRef, async () => {
    const newId = await reauthorizeHire(hireRef);
    const after = await holdOf(hireRef);
    assert.equal(after.auth.id, newId);
    assert.equal(after.auth.parentId, before.auth.id);
    assert.equal(after.remainingGBP, 60);
    assert.equal(after.capturedGBP, 28);
    assert.equal(after.heldAtBookingGBP, 88);
    assert.ok(after.auth.honourEndsAt > new Date());
    step(`${before.auth.id} reauthorised as ${newId} (${after.auth.status}): £60 held, £28 fee still counted, linked to the hire`);
    assert.ok(!(await holdsDueForReauth()).some((a) => a.hire.hireRef === hireRef));
    step('the sweep no longer lists this hire');

    const { token } = await createApproval({ authorizationId: newId, maxGBP: '24.00', finalCapture: true, approver: WHO });
    const taken = await captureApproved(token, '24.00');
    assert.equal(taken.status, 'COMPLETED');
    const held = await getAuthorization(newId);
    assert.equal(held.status, 'CAPTURED');
    await db.hire.update({ where: { id: hireId }, data: { status: 'settled', returnedAt: new Date() } });
    const done = await holdOf(hireRef);
    assert.equal(done.capturedGBP, 52);
    step('final capture of £24 on the new hold: CAPTURED, rest released');
  });
  console.log(`\nAll passed. Hire ${hireRef} stays settled.`);
}

(process.argv[2] === 'reauth' ? reauth() : main())
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
