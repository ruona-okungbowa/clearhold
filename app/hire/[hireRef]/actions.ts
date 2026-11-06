'use server';

import { refresh } from 'next/cache';
import { cancelOpenApprovals, createApproval, pence } from '@/lib/approval';
import { audit, auditScope } from '@/lib/audit';
import { db } from '@/lib/db';
import { Prisma } from '@/lib/generated/prisma/client';
import { amountPence, captureApproved, holdOf, releaseHire, resolveContest } from '@/lib/hold';
import { inspect, isNewMark, MODEL, personPence, PROMPT_VERSION } from '@/lib/inspector';
import { CLAUSES } from '@/lib/schedule';

// shortcut: no sign-in yet, so every approval is Priya's; use the signed-in staff member once auth exists.
const STAFF = 'Priya (H-01)';

const inScope = (hireRef: string, work: () => Promise<void>) => auditScope.run(hireRef, work).then(() => refresh());

// Pick-up: the fee is taken through the same approval gate as any other capture, and the hold stays open.
export async function handOver(hireRef: string) {
  await inScope(hireRef, async () => {
    const { hire, auth } = await holdOf(hireRef);
    if (hire.status !== 'booked') throw new Error(`${hireRef} is ${hire.status}, not booked`);
    const fee = hire.feeGBP.toFixed(2);
    const { token } = await createApproval({ authorizationId: auth.id, maxGBP: fee, finalCapture: false, approver: STAFF });
    await captureApproved(token, fee);
    await db.hire.update({ where: { id: hire.id }, data: { status: 'out' } });
  });
}

export async function runInspector(hireRef: string) {
  await inScope(hireRef, async () => {
    const { hire, auth, remainingGBP } = await holdOf(hireRef);
    if (hire.status === 'settled') throw new Error(`${hireRef} is already settled`);
    // A re-run replaces the findings the renter contested, and could price them higher.
    if (hire.status === 'contested') throw new Error(`The renter contested ${hireRef}: lower or remove charges, then approve`);
    await cancelOpenApprovals(auth.id);
    const [photos, marks] = await Promise.all([
      db.photo.findMany({ where: { hireId: hire.id } }),
      db.itemMark.findMany({ where: { itemRef: hire.itemRef } }),
    ]);
    // A re-run must judge the photos afresh, not excuse a mark on this hire's own earlier say-so.
    const settled = await inspect(photos, marks.filter((m) => m.hireId !== hire.id), remainingGBP);
    const newMarks = settled.filter(isNewMark).map((f, i) => ({
      id: `KM-${hireRef}-${f.angle}-${i + 1}`,
      itemRef: hire.itemRef,
      description: f.description,
      firstSeen: `hire ${hireRef}`,
      hireId: hire.id,
      photoId: f.pickupPhotoId,
    }));
    await db.$transaction([
      db.itemMark.deleteMany({ where: { hireId: hire.id } }),
      db.itemMark.createMany({ data: newMarks }),
      db.finding.deleteMany({ where: { hireId: hire.id } }),
      db.finding.createMany({
        data: settled.map((f) => ({
          hireId: hire.id,
          angle: f.angle,
          kind: f.kind,
          description: f.description,
          clauseId: f.clauseId,
          severity: f.severity,
          box: f.box ?? Prisma.JsonNull,
          pickupPhotoId: f.pickupPhotoId || null,
          returnPhotoId: f.returnPhotoId || null,
          knownMarkId: f.knownMarkId,
          confidence: f.confidence,
          outcome: f.outcome,
          reason: f.reason,
          proposedGBP: f.proposedGBP,
          model: MODEL,
          promptVersion: PROMPT_VERSION,
        })),
      }),
    ]);
    if (newMarks.length) await audit({ actor: 'ai', type: 'mark.logged', summary: newMarks.map((m) => `${m.id}: ${m.description}`).join('; ') });
  });
}

// A person lowers the AI's charge or prices an owner-look finding (lib/inspector.ts personPence holds the rules),
// against what the other findings leave of the hold. Nothing moves until the total is signed in approveCharges.
export async function setAmount(hireRef: string, findingId: string, form: FormData) {
  await inScope(hireRef, async () => {
    const { hire, auth, remainingGBP } = await holdOf(hireRef);
    if (hire.status === 'settled') throw new Error(`${hireRef} is already settled`);
    const findings = await db.finding.findMany({ where: { hireId: hire.id } });
    const finding = findings.find((f) => f.id === findingId);
    if (finding?.outcome !== 'owner_look' && finding?.outcome !== 'charge') throw new Error('Only a charge or an owner-look finding on this hire can take an amount');
    const clause = CLAUSES.find((c) => c.id === finding.clauseId);
    if (!clause?.chargeable) throw new Error('This finding has no chargeable clause, so it cannot be priced');

    const raw = String(form.get('amountGBP') ?? '').trim();
    const others = findings.filter((f) => f.id !== findingId).reduce((sum, f) => sum + amountPence(f), 0);
    const leftPence = Math.round(remainingGBP * 100) - others;
    const proposedPence = Math.round(Number(finding.proposedGBP ?? 0) * 100);
    const setPence = personPence(finding.outcome, proposedPence, clause, raw ? pence(raw) : null, leftPence);
    if (finding.outcome === 'owner_look' && setPence !== null && setPence <= 0) throw new Error('The other findings already use up the remaining hold');
    // Lowering the existing charge is fine; pricing a second finding under the same once-per-garment clause is not.
    if (
      clause.oncePerGarment &&
      finding.outcome === 'owner_look' &&
      setPence !== null &&
      findings.some((f) => f.id !== findingId && f.clauseId === clause.id && (f.outcome === 'charge' || f.setGBP !== null))
    )
      throw new Error(`${clause.id} is charged once per garment; adjust the existing ${clause.id} charge instead`);

    await cancelOpenApprovals(auth.id);
    const setGBP = setPence === null ? null : (setPence / 100).toFixed(2);
    await db.finding.update({ where: { id: findingId }, data: { setGBP, setBy: setGBP && STAFF } });
    await audit({
      actor: 'human',
      type: 'finding.amount_set',
      summary: setGBP
        ? `${STAFF} set £${setGBP} on ${finding.angle} (${clause.id}, ${finding.outcome}); entered £${raw}, £${(leftPence / 100).toFixed(2)} of the hold was free`
        : `${STAFF} cleared the amount on ${finding.angle} (${clause.id})`,
    });
  });
}

// One tap: nothing to charge, so the rest of the hold goes back.
export async function releaseHold(hireRef: string) {
  await inScope(hireRef, () => releaseHire(hireRef, STAFF));
}

// A signed approval for the total of the AI's charges and any amounts a person set, as the final capture.
export async function approveCharges(hireRef: string) {
  await inScope(hireRef, async () => {
    const { hire, auth, remainingGBP } = await holdOf(hireRef);
    if (hire.status === 'settled') throw new Error(`${hireRef} is already settled`);
    const findings = await db.finding.findMany({ where: { hireId: hire.id } });
    const totalPence = findings.reduce((sum, f) => sum + amountPence(f), 0);
    if (totalPence <= 0) throw new Error('Nothing to approve: no finding carries a charge');
    if (totalPence > Math.round(remainingGBP * 100)) throw new Error('The findings total more than the remaining hold; run the inspector again');
    if (hire.status === 'contested') {
      // The renter contested the total in the last final approval; a contest can keep, lower or remove it, never raise it.
      const contested = await db.approval.findFirst({ where: { authorizationId: auth.id, finalCapture: true }, orderBy: { createdAt: 'desc' } });
      if (!contested || totalPence > pence(contested.maxGBP.toFixed(2)))
        throw new Error(`A contest can only keep or lower the charge: £${(totalPence / 100).toFixed(2)} is more than the £${contested?.maxGBP.toFixed(2)} contested`);
    }
    // The renter has 48 hours from this approval to accept or contest, and their link lives exactly as long as it,
    // so 30 minutes would kill the link and the capture inside the window. The extra hour lets staff settle at its end.
    await createApproval({ authorizationId: auth.id, maxGBP: (totalPence / 100).toFixed(2), finalCapture: true, approver: STAFF }, 49 * 3_600_000);
    if (hire.status === 'contested') await resolveContest(hire.id, `approved £${(totalPence / 100).toFixed(2)}`);
  });
}

// Final capture of the approved amount; PayPal releases the rest of the hold.
export async function settleHire(hireRef: string) {
  await inScope(hireRef, async () => {
    const { hire, auth } = await holdOf(hireRef);
    if (hire.status === 'contested') throw new Error(`The renter contested ${hireRef}: resolve it and approve again before settling`);
    const approval = await db.approval.findFirst({
      where: { authorizationId: auth.id, finalCapture: true, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!approval) throw new Error('No valid approval for a final capture: approve the charges first');
    await captureApproved(approval.token, approval.maxGBP.toFixed(2));
    await db.hire.update({ where: { id: hire.id }, data: { status: 'settled', returnedAt: hire.returnedAt ?? new Date() } });
  });
}
