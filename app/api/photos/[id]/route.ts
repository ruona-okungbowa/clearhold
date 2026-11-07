// Streams one condition photo from private Vercel Blob. Only the Photo id goes in or out; the Blob pathname stays here.
// With ?t=<renter link> it serves only photos of that link's hire; without one, only to signed-in staff.

import { get } from '@vercel/blob';
import { db } from '@/lib/db';
import { verifyRenterLink } from '@/lib/renter-link';
import { isStaff } from '@/lib/staff';

export async function GET(req: Request, ctx: RouteContext<'/api/photos/[id]'>) {
  const { id } = await ctx.params;
  const t = new URL(req.url).searchParams.get('t');
  const renterHire = t === null ? null : await verifyRenterLink(t).catch(() => '');
  if (renterHire === '') return Response.json({ error: 'This link has expired' }, { status: 403 });
  if (renterHire === null && !(await isStaff())) return Response.json({ error: 'No such photo' }, { status: 404 });
  const photo = await db.photo.findUnique({ where: { id }, select: { pathname: true, contentType: true, hire: { select: { hireRef: true } } } });
  // Another hire's photo looks the same as no photo, so a link can't probe for ids.
  if (!photo || (renterHire !== null && photo.hire.hireRef !== renterHire)) return Response.json({ error: 'No such photo' }, { status: 404 });

  const blob = await get(photo.pathname, { access: 'private' });
  if (blob?.statusCode !== 200) return Response.json({ error: 'No such photo' }, { status: 404 });

  // Our own headers only: Blob's response headers can name the pathname.
  return new Response(blob.stream, {
    headers: { 'Content-Type': photo.contentType, 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' },
  });
}
