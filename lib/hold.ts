// A hire's current hold and what is left of it, and the one place an approved capture or a release is recorded.

import { cancelOpenApprovals } from './approval';
import { audit } from './audit';
import { db } from './db';
import { capture, getAuthorization, reauthorize, voidHold } from './money';

const DAY = 86_400_000;
const HONOUR_DAYS = 3;
const RENTER_WINDOW_MS = 48 * 3_600_000;

// When staff may capture: the renter gets 48 hours from the final approval to accept or contest.
export const renterDeadline = (approvedAt: Date) => new Date(approvedAt.getTime() + RENTER_WINDOW_MS);
export const londonTime = (d: Date) => `${d.toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' })} London time`;

// What a finding would take: a person's amount if one is set (0 waives it), otherwise the AI's.
export const amountPence = (f: { setGBP: unknown; proposedGBP: unknown }) => Math.round(Number(f.setGBP ?? f.proposedGBP ?? 0) * 100);

export async function holdOf(hireRef: string) {
  const hire = await db.hire.findUnique({
    where: { hireRef },
    include: { authorizations: { orderBy: { createdAt: 'desc' } } },
  });
  const auth = hire?.authorizations[0];
  if (!hire || !auth) throw new Error(`No hold found for ${hireRef}`);
  const captures = await db.capture.findMany({ where: { authorizationId: { in: hire.authorizations.map((a) => a.id) } }, orderBy: { createdAt: 'asc' } });
  const sum = (list: typeof captures) => list.reduce((total, c) => total + Math.round(Number(c.amountGBP) * 100), 0);
  // A reauthorisation is a new hold for what was left, so only this hold's own captures come off it.
  const remainingGBP = (Math.round(Number(auth.amountGBP) * 100) - sum(captures.filter((c) => c.authorizationId === auth.id))) / 100;
  return { hire, auth, captures, capturedGBP: sum(captures) / 100, remainingGBP, heldAtBookingGBP: Number(hire.authorizations.at(-1)!.amountGBP) };
}

// The morning sweep's list: kit still out, honour period over, and due back inside a fresh honour period, so the
// new hold covers the return. Seeded hires have fake ids PayPal doesn't know.
// shortcut: one reauthorisation per hold; kit kept out past the new honour period isn't re-covered, add a second if real hires need it.
export async function holdsDueForReauth(now = new Date()) {
  const done = await db.authorization.findMany({ where: { parentId: { not: null } }, select: { parentId: true } });
  return db.authorization.findMany({
    where: {
      id: { notIn: done.map((a) => a.parentId!) },
      parentId: null,
      status: { in: ['CREATED', 'PARTIALLY_CAPTURED'] },
      honourEndsAt: { lt: now },
      expiresAt: { gt: now },
      hire: { status: 'out', seeded: false, dueBackAt: { lt: new Date(now.getTime() + HONOUR_DAYS * DAY) } },
    },
    include: { hire: true },
  });
}

// Replaces the hire's hold with a new authorization for what is left. The request id is tied to the old hold, so a
// retry after a failed database write replays at PayPal and the upsert picks up the same new hold.
export async function reauthorizeHire(hireRef: string) {
  const { hire, auth, remainingGBP } = await holdOf(hireRef);
  const amountGBP = remainingGBP.toFixed(2);
  const r = await reauthorize(`reauth-${auth.id}`, auth.id, amountGBP);
  const createdAt = new Date(r.createTime!);
  const row = {
    hireId: hire.id,
    parentId: auth.id,
    amountGBP,
    status: r.status!,
    createdAt,
    honourEndsAt: new Date(createdAt.getTime() + HONOUR_DAYS * DAY),
    expiresAt: new Date(r.expirationTime!),
  };
  await db.authorization.upsert({ where: { id: r.id! }, create: { id: r.id!, ...row }, update: row });
  await audit({ actor: 'system', type: 'hold.reauthorized', summary: `Hold ${auth.id} reauthorised for £${amountGBP} as ${r.id}, honour period to ${row.honourEndsAt.toISOString()}` });
  return r.id!;
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

// Final capture of the approved amount; PayPal releases the rest of the hold. The renter's Accept calls this directly,
// so it is immediate; check runs on the chosen approval first, which is how staff Settle adds the 48-hour wait.
// Not in a 'use server' file: exported there it would be a public endpoint with no check.
export async function settleHold(hireRef: string, check?: (approval: { createdAt: Date }) => void) {
  const { hire, auth } = await holdOf(hireRef);
  if (hire.status === 'contested') throw new Error(`The renter contested ${hireRef}: resolve it and approve again before settling`);
  const approval = await db.approval.findFirst({
    where: { authorizationId: auth.id, finalCapture: true, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!approval) throw new Error('No valid approval for a final capture: approve the charges first');
  check?.(approval);
  await captureApproved(approval.token, approval.maxGBP.toFixed(2));
  await db.hire.update({ where: { id: hire.id }, data: { status: 'settled', returnedAt: hire.returnedAt ?? new Date() } });
}

// A person's one tap on a return with nothing to charge: what is left of the hold goes back and the hire closes.
// Needs an inspection on record and the fee already taken, because a void also gives up an uncaptured fee.
export async function releaseHire(hireRef: string, approver: string) {
  const { hire, auth, remainingGBP } = await holdOf(hireRef);
  if (hire.status !== 'out' && hire.status !== 'returned' && hire.status !== 'contested') throw new Error(`${hireRef} is ${hire.status}: only a handed-over hire can be released`);
  const findings = await db.finding.findMany({ where: { hireId: hire.id } });
  if (!findings.length) throw new Error('Run the inspector first: a release needs an inspection on record');
  if (findings.some((f) => amountPence(f) > 0)) throw new Error('A finding still carries a charge: approve it, or lower it to £0');

  await cancelOpenApprovals(auth.id);
  // Tied to the hold, not the click, so a retry replays instead of voiding again.
  await voidHold(`void-${auth.id}`, auth.id);
  const { status } = await getAuthorization(auth.id);
  await db.authorization.update({ where: { id: auth.id }, data: { status: status! } });
  if (status !== 'VOIDED') throw new Error(`PayPal reports hold ${auth.id} as ${status} after the void; the hire stays open`);
  if (hire.status === 'contested') await resolveContest(hire.id, 'removed every charge');
  await db.hire.update({ where: { id: hire.id }, data: { status: 'settled', returnedAt: hire.returnedAt ?? new Date() } });
  await audit({ actor: 'human', type: 'hold.released', summary: `${approver} released £${remainingGBP.toFixed(2)} from hold ${auth.id}: no charge` });
}

// Staff answered the renter's contest by approving a total no higher than the one contested, or by releasing the hold.
// The hire leaves "contested", so Settle works again; the contest row stays, so the renter gets no second one.
export async function resolveContest(hireId: string, outcome: string) {
  // shortcut: the demo passcode doesn't say who signed in, so every resolution is just "Staff", as in app/hire/[hireRef]/actions.ts.
  const resolvedBy = 'Staff';
  await db.$transaction([
    db.contest.update({ where: { hireId }, data: { status: 'resolved', resolvedBy } }),
    db.hire.update({ where: { id: hireId }, data: { status: 'returned' } }),
  ]);
  await audit({ actor: 'human', type: 'contest.resolved', summary: `${resolvedBy} resolved the renter's contest: ${outcome}` });
}
