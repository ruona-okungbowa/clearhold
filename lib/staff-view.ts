// What the staff screens show for each hire: its status chip, the next step a person takes, and the money on hold.
// One place, so the control room, the hire page and the desk agent say the same thing. Server-side only.

import { itemName } from './catalogue';
import { db } from './db';
import type { Finding } from './generated/prisma/client';
import { amountPence } from './hold';

const DAY = 86_400_000;
// A hold that can still be captured; CAPTURED, VOIDED and EXPIRED ones are done with.
const OPEN_HOLD = new Set(['CREATED', 'PARTIALLY_CAPTURED']);

export type ChipKind = 'stAi' | 'stHuman' | 'stLook' | 'stOk' | 'stPlain';
export type Step = { chip: ChipKind; status: string; next: string; href: 'hire' | 'approve' | 'pickup' | 'return'; needsPerson: boolean };

type FindingLike = { outcome: string; setGBP: unknown; proposedGBP: unknown };

export const gbpText = (pence: number) => `£${(pence / 100).toFixed(pence % 100 ? 2 : 0)}`;

export function stepOf(hire: { status: string; startAt: Date; dueBackAt: Date }, findings: FindingLike[], openApproval: { maxGBP: unknown } | null): Step {
  const total = findings.reduce((sum, f) => sum + amountPence(f), 0);
  const unpriced = findings.some((f) => f.outcome === 'owner_look' && f.setGBP === null);
  const day = (d: Date) => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' });
  switch (hire.status) {
    case 'booked':
      return { chip: 'stPlain', status: 'Booked', next: `Hand over ${day(hire.startAt)}`, href: 'pickup', needsPerson: false };
    case 'out':
      return { chip: 'stPlain', status: 'Out', next: `Due back ${day(hire.dueBackAt)}`, href: 'return', needsPerson: false };
    case 'contested':
      return { chip: 'stLook', status: 'Contested', next: 'Look again', href: 'approve', needsPerson: true };
    case 'settled':
      return { chip: 'stOk', status: 'Settled', next: 'Nothing to do', href: 'hire', needsPerson: false };
  }
  if (!findings.length) return { chip: 'stPlain', status: 'Returned', next: 'Run the inspector', href: 'hire', needsPerson: true };
  if (openApproval)
    return { chip: 'stHuman', status: `Approved ${gbpText(Math.round(Number(openApproval.maxGBP) * 100))}`, next: 'Waiting for renter', href: 'approve', needsPerson: false };
  if (unpriced) return { chip: 'stLook', status: 'Owner look', next: 'Set an amount or waive', href: 'approve', needsPerson: true };
  if (total > 0) return { chip: 'stAi', status: `AI proposed ${gbpText(total)}`, next: 'Approve or lower', href: 'approve', needsPerson: true };
  return { chip: 'stOk', status: 'Clean', next: 'Release', href: 'approve', needsPerson: true };
}

// Every hire with its step, current hold and what is left of it, newest first.
export async function loadHires() {
  const now = new Date();
  const [hires, captures, findings, approvals, contests] = await Promise.all([
    db.hire.findMany({ include: { authorizations: { orderBy: { createdAt: 'desc' } } }, orderBy: { startAt: 'desc' } }),
    db.capture.findMany({ select: { authorizationId: true, amountGBP: true } }),
    db.finding.findMany(),
    db.approval.findMany({ where: { finalCapture: true, usedAt: null, expiresAt: { gt: now } }, select: { authorizationId: true, maxGBP: true } }),
    db.contest.findMany({ where: { status: 'open' }, select: { hireId: true } }),
  ]);
  const capturedOn = new Map<string, number>();
  for (const c of captures) capturedOn.set(c.authorizationId, (capturedOn.get(c.authorizationId) ?? 0) + Math.round(Number(c.amountGBP) * 100));
  const findingsOf = new Map<string, Finding[]>();
  for (const f of findings) findingsOf.set(f.hireId, [...(findingsOf.get(f.hireId) ?? []), f]);
  const approvalOn = new Map(approvals.map((a) => [a.authorizationId, a]));
  const reauthorised = new Set(hires.flatMap((h) => h.authorizations.map((a) => a.parentId).filter(Boolean)));
  const contested = new Set(contests.map((c) => c.hireId));

  return hires.map((h) => {
    const auth = h.authorizations[0];
    const fs = findingsOf.get(h.id) ?? [];
    const holdOpen = Boolean(auth && OPEN_HOLD.has(auth.status) && h.status !== 'settled');
    return {
      ref: h.hireRef,
      item: itemName(h.itemRef),
      itemRef: h.itemRef,
      branch: h.branch,
      status: h.status,
      startAt: h.startAt,
      dueBackAt: h.dueBackAt,
      returnedAt: h.returnedAt,
      step: stepOf(h, fs, auth ? (approvalOn.get(auth.id) ?? null) : null),
      heldPence: holdOpen && auth ? Math.round(Number(auth.amountGBP) * 100) - (capturedOn.get(auth.id) ?? 0) : 0,
      holdOpen,
      holdAgeDays: auth ? Math.floor((now.getTime() - auth.createdAt.getTime()) / DAY) : 0,
      holdToRefresh: Boolean(holdOpen && auth && auth.honourEndsAt < now && !reauthorised.has(auth.id)),
      contested: contested.has(h.id),
      findings: fs,
    };
  });
}

export type HireView = Awaited<ReturnType<typeof loadHires>>[number];

// A finding's chip: what the inspector concluded, or a person's amount once one is set.
export function findingChip(f: { outcome: string; kind: string; setGBP: unknown; setBy: string | null }): [ChipKind, string] {
  if (f.setGBP !== null) return ['stHuman', `${f.setBy ?? 'Staff'}: ${gbpText(Math.round(Number(f.setGBP) * 100))}`];
  if (f.outcome === 'charge') return ['stAi', 'AI: charge'];
  if (f.outcome === 'owner_look') return ['stLook', 'Owner look'];
  if (f.kind === 'known_mark') return ['stPlain', 'Known mark'];
  if (f.kind === 'wear') return ['stOk', 'Wear'];
  return ['stOk', 'No charge'];
}
