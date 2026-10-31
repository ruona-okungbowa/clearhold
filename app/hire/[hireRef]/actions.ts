'use server';

import { refresh } from 'next/cache';
import { createApproval } from '@/lib/approval';
import { auditScope } from '@/lib/audit';
import { db } from '@/lib/db';
import { Prisma } from '@/lib/generated/prisma/client';
import { captureApproved, holdOf } from '@/lib/hold';
import { inspect, MODEL, PROMPT_VERSION } from '@/lib/inspector';
import { ITEMS } from '@/lib/schedule';

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
    const { hire, remainingGBP } = await holdOf(hireRef);
    if (hire.status === 'settled') throw new Error(`${hireRef} is already settled`);
    const photos = await db.photo.findMany({ where: { hireId: hire.id } });
    const settled = await inspect(photos, ITEMS[hire.itemRef]?.knownMarks ?? [], remainingGBP);
    await db.$transaction([
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
  });
}

// A signed approval for the charged findings' total, as the final capture. Owner-look findings carry no amount.
export async function approveCharges(hireRef: string) {
  await inScope(hireRef, async () => {
    const { hire, auth, remainingGBP } = await holdOf(hireRef);
    if (hire.status === 'settled') throw new Error(`${hireRef} is already settled`);
    const charged = await db.finding.findMany({ where: { hireId: hire.id, outcome: 'charge' } });
    const totalPence = charged.reduce((sum, f) => sum + Math.round(Number(f.proposedGBP) * 100), 0);
    if (totalPence <= 0) throw new Error('Nothing to approve: no finding carries a charge');
    if (totalPence > Math.round(remainingGBP * 100)) throw new Error('The findings total more than the remaining hold; run the inspector again');
    await createApproval({ authorizationId: auth.id, maxGBP: (totalPence / 100).toFixed(2), finalCapture: true, approver: STAFF });
  });
}

// Final capture of the approved amount; PayPal releases the rest of the hold.
export async function settleHire(hireRef: string) {
  await inScope(hireRef, async () => {
    const { hire, auth } = await holdOf(hireRef);
    const approval = await db.approval.findFirst({
      where: { authorizationId: auth.id, finalCapture: true, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!approval) throw new Error('No valid approval for a final capture: approve the charges first');
    await captureApproved(approval.token, approval.maxGBP.toFixed(2));
    await db.hire.update({ where: { id: hire.id }, data: { status: 'settled', returnedAt: hire.returnedAt ?? new Date() } });
  });
}
