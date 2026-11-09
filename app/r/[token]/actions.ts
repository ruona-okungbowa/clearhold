'use server';

// The renter's two answers to the charges, each checked against their signed link: Accept captures at once, without
// the 48-hour wait staff have, and Contest (once per hire) pulls the approval back to staff. Refusals come back as
// text for the page to show.

import { refresh } from 'next/cache';
import { z } from 'zod';
import { cancelOpenApprovals } from '@/lib/approval';
import { audit, auditScope } from '@/lib/audit';
import { db } from '@/lib/db';
import { Prisma } from '@/lib/generated/prisma/client';
import { holdOf, settleHold } from '@/lib/hold';
import { refusal } from '@/lib/refusal';
import { verifyRenterLink } from '@/lib/renter-link';

const ContestInput = z.object({
  findingId: z.string().min(1).nullable(),
  note: z.string().trim().min(1, 'Say what you disagree with').max(500, 'Keep the note to 500 characters'),
  photoId: z.string().min(1).nullable(),
});

const hireOf = (token: string) =>
  verifyRenterLink(token).catch(() => {
    throw new Error('This link has expired');
  });

// approvalId is the approval the page showed, so the renter only ever agrees to the total they saw.
export async function acceptCharges(token: string, approvalId: string) {
  return refusal(
    (async () => {
      const hireRef = await hireOf(token);
      const { auth } = await holdOf(hireRef);
      const open = await db.approval.findFirst({
        where: { authorizationId: auth.id, finalCapture: true, usedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
      });
      if (open?.id !== approvalId) throw new Error('The charges changed since you opened this page; reload it to see them');
      await auditScope.run(hireRef, () => settleHold(hireRef));
      refresh();
      await audit({ hireRef, actor: 'human', type: 'renter.accepted', summary: `Renter accepted the £${open.maxGBP.toFixed(2)} charge` });
    })(),
  );
}

export async function contestCharges(token: string, input: z.input<typeof ContestInput>) {
  return refusal(
    (async () => {
      const hireRef = await hireOf(token);
      const parsed = ContestInput.safeParse(input);
      if (!parsed.success) throw new Error(parsed.error.issues[0].message);
      const { findingId, note, photoId } = parsed.data;
      const { hire, auth } = await holdOf(hireRef);
      if (findingId && !(await db.finding.count({ where: { id: findingId, hireId: hire.id } }))) throw new Error('That finding is not on this hire');
      if (photoId && !(await db.photo.count({ where: { id: photoId, hireId: hire.id, stage: 'contest' } }))) throw new Error('That photo is not on this hire');

      // What the renter is contesting: the last total staff signed, on any of the hire's holds.
      const contested = await db.approval.findFirst({
        where: { authorizationId: { in: hire.authorizations.map((a) => a.id) }, finalCapture: true },
        orderBy: { createdAt: 'desc' },
      });
      if (!contested) throw new Error('Staff have not approved a charge yet, so there is nothing to contest');

      try {
        await db.$transaction(async (tx) => {
          await tx.contest.create({ data: { hireId: hire.id, findingId, note, photoId, status: 'open', contestedGBP: contested.maxGBP } });
          // Conditional, so a hire settled since the page loaded can't be reopened.
          const { count } = await tx.hire.updateMany({ where: { id: hire.id, status: { in: ['out', 'returned'] } }, data: { status: 'contested' } });
          if (!count) throw new Error(`This hire is ${hire.status}; it can no longer be contested`);
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new Error('This hire has already been contested: you can contest once');
        throw err;
      }
      await auditScope.run(hireRef, async () => {
        await cancelOpenApprovals(auth.id);
        await audit({ actor: 'human', type: 'contest.opened', summary: `Renter contested${findingId ? ` finding ${findingId}` : ' the charges'}: ${note}` });
      });
      refresh();
    })(),
  );
}
