'use server';

import { createHash, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SHOPS } from '@/lib/catalogue';
import { STAFF_COOKIE, STAFF_NAME, staffToken } from '@/lib/staff';

// Only a path on this site, so ?next can't send a signed-in person elsewhere.
const safeNext = (next: string) => (/^\/(?![/\\])/.test(next) ? next : '/control-room');

export async function signIn(form: FormData) {
  const expected = process.env.STAFF_PASSCODE;
  if (!expected) throw new Error('STAFF_PASSCODE must be set (see env.example)');
  const next = safeNext(String(form.get('next') ?? ''));
  const name = String(form.get('name') ?? '').trim().replace(/\s+/g, ' ');
  if (!STAFF_NAME.test(name)) redirect(`/staff-login?error=name&next=${encodeURIComponent(next)}`);
  const shop = SHOPS.find((x) => x === form.get('shop'));
  // Hashed first so both sides are the same length, which timingSafeEqual needs.
  const digest = (s: string) => createHash('sha256').update(s).digest();
  if (!timingSafeEqual(digest(String(form.get('passcode') ?? '')), digest(expected))) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    redirect(`/staff-login?error=1&next=${encodeURIComponent(next)}`);
  }
  (await cookies()).set(STAFF_COOKIE, await staffToken(name, shop), { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 12 * 3600 });
  redirect(next);
}

export async function signOut() {
  (await cookies()).delete(STAFF_COOKIE);
  redirect('/staff-login');
}
