import type { Metadata } from 'next';
import { connection } from 'next/server';
import { db } from '@/lib/db';
import { getSavedLayout } from './saved-layout';
import { ControlRoom } from './control-room';

export const metadata: Metadata = { title: 'Control room' };

export default async function ControlRoomPage() {
  // Live database rows: render per request, not at build time.
  await connection();
  const [authorizations, hires, savedState] = await Promise.all([
    db.authorization.findMany({ omit: { updatedAt: true }, orderBy: { createdAt: 'asc' } }),
    db.hire.findMany({ omit: { createdAt: true }, orderBy: { startAt: 'asc' } }),
    getSavedLayout(),
  ]);

  // Decimals don't cross to the client; GBP amounts to 2dp are exact enough as numbers.
  return (
    <ControlRoom
      holds={authorizations.map((a) => ({ ...a, amountGBP: Number(a.amountGBP) }))}
      hires={hires.map((h) => ({
        ...h,
        feeGBP: Number(h.feeGBP),
        depositGBP: Number(h.depositGBP),
      }))}
      savedState={savedState}
    />
  );
}
