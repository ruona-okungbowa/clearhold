import type { Metadata } from 'next';
import Image from 'next/image';
import { connection } from 'next/server';
import { isoOf, londonToday } from '@/lib/booking';
import { lookBySlug } from '@/lib/catalogue';
import { db } from '@/lib/db';
import { RenterPage } from '../chrome';
import s from '../screens.module.css';
import w from '../wire.module.css';
import { BookingPanel } from './booking-panel';

export const metadata: Metadata = { title: 'Book a look' };

export default async function LookPage({ searchParams }: { searchParams: Promise<{ l?: string | string[] }> }) {
  await connection(); // today's date and live bookings: render per request
  const { l } = await searchParams;
  const look = lookBySlug(typeof l === 'string' ? l : undefined);
  const hires = await db.hire.findMany({
    where: { itemRef: { startsWith: `LOOK-${look.slug}-` }, status: { not: 'settled' } },
    select: { itemRef: true, startAt: true, dueBackAt: true },
  });

  return (
    <RenterPage>
      <div className={`${w.rWrap} ${s.lookLayout}`}>
        <div className={s.lookStage}>
          <Image
            src={`/looks/${look.img}.webp`}
            alt={`${look.name}: ${look.pieces.map(([p]) => p.toLowerCase()).join(', ')}`}
            fill
            preload
            sizes="(max-width: 900px) 100vw, 55vw"
          />
        </div>
        <BookingPanel
          key={look.slug}
          look={look}
          today={londonToday()}
          booked={hires.map((h) => ({ itemRef: h.itemRef, start: isoOf(h.startAt), end: isoOf(h.dueBackAt) }))}
          clientId={process.env.PAYPAL_CLIENT_ID}
        />
      </div>
    </RenterPage>
  );
}
