// Streams one condition photo from private Vercel Blob. Only the Photo id goes in or out; the Blob pathname stays here.
// shortcut: no sign-in yet, anyone with a photo id can view it; gate on the renter's or staff session later.

import { get } from '@vercel/blob';
import { db } from '@/lib/db';

export async function GET(_req: Request, ctx: RouteContext<'/api/photos/[id]'>) {
  const { id } = await ctx.params;
  const photo = await db.photo.findUnique({ where: { id }, select: { pathname: true, contentType: true } });
  if (!photo) return Response.json({ error: 'No such photo' }, { status: 404 });

  const blob = await get(photo.pathname, { access: 'private' });
  if (blob?.statusCode !== 200) return Response.json({ error: 'No such photo' }, { status: 404 });

  // Our own headers only: Blob's response headers can name the pathname.
  return new Response(blob.stream, {
    headers: { 'Content-Type': photo.contentType, 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' },
  });
}
