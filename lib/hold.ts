// A hire's current hold and what is left of it, and the one place an approved capture is recorded.

import { db } from './db';
import { capture, getAuthorization } from './money';

export async function holdOf(hireRef: string) {
  const hire = await db.hire.findUnique({
    where: { hireRef },
    include: { authorizations: { orderBy: { createdAt: 'desc' }, take: 1 } },
  });
  const auth = hire?.authorizations[0];
  if (!hire || !auth) throw new Error(`No hold found for ${hireRef}`);
  const captures = await db.capture.findMany({ where: { authorizationId: auth.id }, orderBy: { createdAt: 'asc' } });
  const capturedPence = captures.reduce((sum, c) => sum + Math.round(Number(c.amountGBP) * 100), 0);
  const remainingGBP = (Math.round(Number(auth.amountGBP) * 100) - capturedPence) / 100;
  return { hire, auth, captures, capturedGBP: capturedPence / 100, remainingGBP };
}

// Captures through the money service (which checks the approval), records it, then syncs the hold's status.
export async function captureApproved(token: string, amountGBP: string) {
  const c = await capture(token, amountGBP);
  await db.capture.upsert({
    where: { approvalId: c.approvalId },
    update: { status: c.status! },
    create: {
      id: c.id!,
      authorizationId: c.authorizationId,
      approvalId: c.approvalId,
      amountGBP,
      finalCapture: c.finalCapture,
      status: c.status!,
    },
  });
  const a = await getAuthorization(c.authorizationId);
  await db.authorization.update({ where: { id: c.authorizationId }, data: { status: a.status! } });
  return c;
}
