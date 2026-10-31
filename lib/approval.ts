// Signed approvals: a person's permission to capture up to a maximum from one hold, once, before expiry.
// The money service claims one before every capture (lib/money.ts capture), so no code path moves
// deposit money without a person's signed say-so. Server-side only: it reads APPROVAL_SECRET.

import { randomUUID } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import { audit } from './audit';
import { db } from './db';

const ISSUER = 'clearhold';
const TTL_MS = 30 * 60_000;

export class ApprovalError extends Error {
  name = 'ApprovalError';
}

function key() {
  const secret = process.env.APPROVAL_SECRET;
  if (!secret || secret.length < 32) throw new Error('APPROVAL_SECRET must be set, at least 32 characters (see env.example)');
  return new TextEncoder().encode(secret);
}

// Whole pence, so comparisons never suffer float rounding.
export function pence(gbp: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(gbp)) throw new ApprovalError(`Not a GBP amount: ${gbp}`);
  const [pounds, p = ''] = gbp.split('.');
  return Number(pounds) * 100 + Number(p.padEnd(2, '0'));
}

export async function createApproval(a: { authorizationId: string; maxGBP: string; finalCapture: boolean; approver: string }) {
  if (pence(a.maxGBP) <= 0) throw new ApprovalError('An approval must cover more than £0');
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + TTL_MS);
  const token = await new SignJWT({ max: a.maxGBP, final: a.finalCapture, approver: a.approver })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setSubject(a.authorizationId)
    .setJti(id)
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(key());
  await db.approval.create({
    data: { id, authorizationId: a.authorizationId, maxGBP: a.maxGBP, finalCapture: a.finalCapture, approver: a.approver, expiresAt, token },
  });
  await audit({
    actor: 'human',
    type: 'approval.created',
    summary: `${a.approver} approved up to £${a.maxGBP} from hold ${a.authorizationId}${a.finalCapture ? ' (final capture)' : ''}, expires ${expiresAt.toISOString()}`,
    idempotencyKey: id,
  });
  return { id, token };
}

export type ApprovalClaims = { jti: string; sub: string; max: string; final: boolean; approver: string; exp: number };

// Signature, issuer, algorithm and expiry; throws ApprovalError on any failure.
export async function verifyApproval(token: string): Promise<ApprovalClaims> {
  let payload;
  try {
    ({ payload } = await jwtVerify(token, key(), { issuer: ISSUER, algorithms: ['HS256'] }));
  } catch (err) {
    throw new ApprovalError(`Approval rejected: ${err instanceof Error ? err.message : String(err)}`);
  }
  const { jti, sub, max, final, approver, exp } = payload;
  if (typeof jti !== 'string' || typeof sub !== 'string' || typeof max !== 'string' || typeof final !== 'boolean')
    throw new ApprovalError('Approval rejected: missing claims');
  return { jti, sub, max, final, approver: String(approver), exp: exp! };
}

// Marks the approval used, atomically, or refuses: a valid, unexpired, unused approval covering the amount.
export async function claimApproval(token: string, amountGBP: string) {
  const c = await verifyApproval(token);
  if (pence(amountGBP) <= 0) throw new ApprovalError('Capture amount must be more than £0');
  if (pence(amountGBP) > pence(c.max)) throw new ApprovalError(`£${amountGBP} is more than the approved £${c.max}`);
  const now = new Date();
  const { count } = await db.approval.updateMany({
    where: { id: c.jti, token, authorizationId: c.sub, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  if (count !== 1) throw new ApprovalError(`Approval ${c.jti} is unknown, expired or already used`);
  return { id: c.jti, authorizationId: c.sub, finalCapture: c.final };
}

// Hands an approval back after PayPal refused the capture, so a retry replays the same request id.
export const releaseApproval = (id: string) => db.approval.update({ where: { id }, data: { usedAt: null } });
