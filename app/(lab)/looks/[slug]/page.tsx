import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { isoOf, londonToday } from '@/lib/booking';
import { LOOKS, lookBySlug } from '@/lib/catalogue';
import { db } from '@/lib/db';
import { RenterPage } from '../../chrome';
import s from '../../screens.module.css';
import w from '../../wire.module.css';
import { BookingPanel } from './booking-panel';

export const generateStaticParams = () => LOOKS.map(({ slug }) => ({ slug }));

export async function generateMetadata({ params }: PageProps<'/looks/[slug]'>): Promise<Metadata> {
  const look = lookBySlug((await params).slug);
  if (!look) return {};
  const title = `${look.name} · Ledgerton Hire`;
  return {
    title: { absolute: title },
    description: look.blurb,
    openGraph: { title, description: look.blurb, images: [`/looks/${look.img}.webp`] },
  };
}

export default async function LookPage({ params }: PageProps<'/looks/[slug]'>) {
  const look = lookBySlug((await params).slug);
  if (!look) notFound();
  await connection(); // today's date and live bookings: render per request
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
      <div className={w.rWrap}>
        <section className={s.returnStrip} aria-labelledby="at-return">
          <h2 id="at-return" className={w.rH3}>
            What happens at return
          </h2>
          <ol>
            <li>The same six photos are taken and compared with the ones from pick-up.</li>
            <li>Creases and everyday wear are never charged. Anything new is priced from the list above, and a person signs it off.</li>
            <li>You see the photos and the price first, and you can contest once. The rest of your £{look.deposit} deposit is released.</li>
          </ol>
          <Link href="/#rules">Read our fair-hire promise</Link>
        </section>
      </div>
    </RenterPage>
  );
}
