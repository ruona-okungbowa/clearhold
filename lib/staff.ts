// The demo staff gate: one shared passcode (STAFF_PASSCODE) plus the name the person gives buys a 12-hour signed cookie
// whose subject is that name. Not accounts. proxy.ts redirects signed-out page visits; requireStaff() is the real guard,
// at the top of every staff server action, because actions can be called directly; it returns the signed-in name for
// the audit trail. Server-side only: reads STAFF_SESSION_SECRET.
// shortcut: the name is self-declared behind a shared passcode, so it says who clicked, not who proved it; add accounts before real use.

import { jwtVerify, SignJWT } from 'jose';
import { cookies } from 'next/headers';

export const STAFF_COOKIE = 'clearhold_staff';
const AUDIENCE = 'staff';

function key() {
  const secret = process.env.STAFF_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('STAFF_SESSION_SECRET must be set, at least 32 characters (see env.example)');
  return new TextEncoder().encode(secret);
}

// Letters, spaces, hyphens, apostrophes and full stops: a person's name, nothing that reads as markup or a path.
export const STAFF_NAME = /^[\p{L}][\p{L} .'-]{0,58}[\p{L}.]$/u;

// `shop` is the branch picked at sign-in, shown beside the name; it grants nothing.
export const staffToken = (name: string, shop?: string) => {
  if (!STAFF_NAME.test(name)) throw new Error('A staff name is 2 to 60 letters');
  return new SignJWT(shop ? { shop } : {}).setProtectedHeader({ alg: 'HS256' }).setAudience(AUDIENCE).setSubject(name).setIssuedAt().setExpirationTime('12h').sign(key());
};

export type StaffWho = { name: string; shop: string | null };

// The signed-in person, or null. A cookie from before names were asked for has no subject and reads as signed out.
export async function staffWho(token: string | undefined): Promise<StaffWho | null> {
  if (!token) return null;
  const k = key(); // a missing secret should fail loudly, not read as signed out
  return jwtVerify(token, k, { audience: AUDIENCE, algorithms: ['HS256'] }).then(
    ({ payload }) =>
      typeof payload.sub === 'string' && STAFF_NAME.test(payload.sub) ? { name: payload.sub, shop: typeof payload.shop === 'string' ? payload.shop : null } : null,
    () => null,
  );
}

export const verifyStaff = async (token: string | undefined) => (await staffWho(token))?.name ?? null;

export const signedInStaff = async () => staffWho((await cookies()).get(STAFF_COOKIE)?.value);

export const isStaff = async () => verifyStaff((await cookies()).get(STAFF_COOKIE)?.value);

// For route handlers: reads the request's own Cookie header, so it works outside a Next request scope too.
export function isStaffRequest(req: Request) {
  const pair = req.headers.get('cookie')?.split(/;\s*/).find((c) => c.startsWith(`${STAFF_COOKIE}=`));
  return verifyStaff(pair?.slice(STAFF_COOKIE.length + 1));
}

export async function requireStaff(): Promise<string> {
  const name = await isStaff();
  if (!name) throw new Error('Staff only');
  return name;
}
