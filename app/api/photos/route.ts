// Stores one condition photo: private Vercel Blob for the bytes, a Photo row for its SHA-256 and the
// server's clock. Re-taking an angle replaces the row; the old blob stays as history.
// A renter's contest photo (stage "contest") needs their link as t, and the hire must not be contested yet.
// shortcut: no sign-in yet, anyone with a hire ref can upload pick-up and return photos; gate on a session later.

import { createHash } from 'node:crypto';
import { put } from '@vercel/blob';
import { db } from '@/lib/db';
import { verifyRenterLink } from '@/lib/renter-link';
import { ANGLES, STAGES } from '@/lib/schedule';

// Under Vercel's 4.5 MB request limit; the capture page shrinks photos well below it.
const MAX_BYTES = 4_000_000;
// The image types Claude reads.
const TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export async function POST(req: Request) {
  const form = await req.formData();
  const [hireRef, stage, photo, t] = ['hireRef', 'stage', 'photo', 't'].map((k) => form.get(k));
  const contest = stage === 'contest';
  // One contest photo per hire, so it takes a fixed angle.
  const angle = contest ? 'contest' : form.get('angle');
  if (
    typeof hireRef !== 'string' ||
    typeof stage !== 'string' ||
    typeof angle !== 'string' ||
    !(contest || (STAGES.some((s) => s === stage) && ANGLES.some((a) => a.id === angle))) ||
    !(photo instanceof File)
  )
    return Response.json({ error: 'Send hireRef, stage, angle and photo' }, { status: 400 });
  if (contest && (await verifyRenterLink(String(t)).catch(() => null)) !== hireRef)
    return Response.json({ error: 'This link has expired' }, { status: 403 });
  const ext = TYPES[photo.type];
  if (!ext) return Response.json({ error: `${photo.type || 'This file type'} is not supported; use JPEG, PNG or WebP` }, { status: 415 });
  if (photo.size > MAX_BYTES) return Response.json({ error: 'Photo is over 4 MB' }, { status: 413 });

  const hire = await db.hire.findUnique({ where: { hireRef } });
  if (!hire) return Response.json({ error: `No hire ${hireRef}` }, { status: 404 });
  if (hire.status === 'settled') return Response.json({ error: `${hireRef} is settled; its photos are final` }, { status: 409 });
  if (contest && (await db.contest.count({ where: { hireId: hire.id } })))
    return Response.json({ error: 'This hire has already been contested' }, { status: 409 });

  const bytes = Buffer.from(await photo.arrayBuffer());
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const pathname = `hires/${hireRef}/${stage}/${angle}-${sha256.slice(0, 16)}.${ext}`;
  await put(pathname, bytes, { access: 'private', contentType: photo.type, addRandomSuffix: false, allowOverwrite: true });

  const row = { pathname, contentType: photo.type, sha256, serverAt: new Date() };
  const saved = await db.photo.upsert({
    where: { hireId_stage_angle: { hireId: hire.id, stage, angle } },
    create: { hireId: hire.id, stage, angle, ...row },
    update: row,
  });
  return Response.json({ id: saved.id, sha256, serverAt: saved.serverAt });
}
