// The renter's link to their evidence page: a signed token naming one hire, valid as long as the final approval it
// was issued with. Its own secret, so an approval token can never pass as a renter link or the other way round.

import { jwtVerify, SignJWT } from 'jose';

const AUDIENCE = 'renter';

function key() {
  const secret = process.env.RENTER_LINK_SECRET;
  if (!secret || secret.length < 32) throw new Error('RENTER_LINK_SECRET must be set, at least 32 characters (see env.example)');
  return new TextEncoder().encode(secret);
}

export const renterLink = (hireRef: string, expiresAt: Date) =>
  new SignJWT().setProtectedHeader({ alg: 'HS256' }).setAudience(AUDIENCE).setSubject(hireRef).setExpirationTime(expiresAt).sign(key());

// The hire ref the token names; throws on a bad signature, the wrong audience or an expired link.
export async function verifyRenterLink(token: string) {
  const { payload } = await jwtVerify(token, key(), { audience: AUDIENCE, algorithms: ['HS256'] });
  if (typeof payload.sub !== 'string') throw new Error('Renter link names no hire');
  return payload.sub;
}
