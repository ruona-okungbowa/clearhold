// The demo staff gate: one shared passcode (STAFF_PASSCODE) buys a 12-hour signed cookie. Not accounts.
// proxy.ts redirects signed-out page visits; requireStaff() is the real guard, at the top of every staff server action,
// because actions can be called directly. Server-side only: reads STAFF_SESSION_SECRET.
// shortcut: one passcode for every staff member, so the audit trail can't say who; add accounts before real use.

import { jwtVerify, SignJWT } from 'jose';
import { cookies } from 'next/headers';

export const STAFF_COOKIE = 'clearhold_staff';
const AUDIENCE = 'staff';

function key() {
  const secret = process.env.STAFF_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('STAFF_SESSION_SECRET must be set, at least 32 characters (see env.example)');
  return new TextEncoder().encode(secret);
}

export const staffToken = () =>
  new SignJWT().setProtectedHeader({ alg: 'HS256' }).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('12h').sign(key());

export async function verifyStaff(token: string | undefined) {
  if (!token) return false;
  const k = key(); // a missing secret should fail loudly, not read as signed out
  return jwtVerify(token, k, { audience: AUDIENCE, algorithms: ['HS256'] }).then(
    () => true,
    () => false,
  );
}

export const isStaff = async () => verifyStaff((await cookies()).get(STAFF_COOKIE)?.value);

export async function requireStaff() {
  if (!(await isStaff())) throw new Error('Staff only');
}
