import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { itemOf } from '@/lib/catalogue';
import { db } from '@/lib/db';
import { dayLabel, gbp0, RenterPage } from '../chrome';
import s from '../screens.module.css';
import w from '../wire.module.css';

export const metadata: Metadata = { title: 'You’re booked', robots: { index: false } };

const icsStamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

// A one-event calendar file for the collection, as a data URI.
function calendarFile(ref: string, what: string, shop: string, at: Date) {
  const end = new Date(at.getTime() + 30 * 60_000);
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Clearhold//Booking//EN',
    'BEGIN:VEVENT',
    `UID:${ref}@clearhold`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(at)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:Collect ${what} from Ledgerton ${shop}`,
    `DESCRIPTION:Booking ${ref}. Show this reference at the counter.`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
}

// The page the PayPal button lands on. The ref is all it needs: a hire holds no renter details to leak.
export default async function BookedPage({ searchParams }: { searchParams: Promise<{ ref?: string | string[] }> }) {
  const { ref } = await searchParams;
  const hire =
    typeof ref === 'string'
      ? await db.hire.findUnique({ where: { hireRef: ref }, include: { authorizations: { orderBy: { createdAt: 'asc' }, take: 1 } } })
      : null;
  const item = hire && itemOf(hire.itemRef);
  if (!hire || !item) notFound();

  const fee = Number(hire.feeGBP);
  const deposit = Number(hire.depositGBP);
  const held = Number(hire.authorizations[0]?.amountGBP ?? fee + deposit);
  const collect = `${dayLabel(hire.startAt)}, from 10am`;
  const handBack = `${dayLabel(hire.dueBackAt)}, by 5pm`;
  const steps = [
    { title: 'Booked', body: `Nothing taken yet. A ${gbp0(held)} hold sits on your PayPal.`, done: true },
    {
      title: `Collect it: ${collect}`,
      body: `Try it on at the counter. While you do, we take six quick photos so any marks already there are on record, not on you. Then the ${gbp0(fee)} hire fee is taken.`,
    },
    { title: 'Wear it', body: 'Creases, lint and a bit of pilling are expected. Cleaning is in the price.' },
    {
      title: `Hand it back: ${handBack}`,
      body: 'Drop it at the shop. The same six photos are taken and compared, and most returns are signed off the same day.',
    },
    {
      title: 'Deposit released',
      body: `Your ${gbp0(deposit)} comes back off hold. If anything new needs fixing, you see both photos and the price first, and you can contest once.`,
    },
  ];

  return (
    <RenterPage tone="sky">
      <section className={s.confirmHero}>
        <div className={`${w.rWrap} ${s.confirmGrid}`}>
          <div className={s.confirmLeft}>
            <p className={s.thanks}>Thank you.</p>
            <h1 className={w.rH1}>You’re booked.</h1>
            <p className={w.rLead}>
              {item.name} is waiting for you at Ledgerton {hire.branch}.
            </p>
            <div className={s.actions}>
              <a href={calendarFile(hire.hireRef, item.name, hire.branch, hire.startAt)} download={`${hire.hireRef}.ics`} className={w.block}>
                Add to calendar
              </a>
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`Ledgerton Hire ${hire.branch}`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className={w.ghost}
              >
                Get directions
              </a>
            </div>
          </div>
          <div className={s.refBox}>
            <p className={w.kicker}>Show this when you collect</p>
            <p className={s.refCode}>{hire.hireRef}</p>
          </div>
        </div>
      </section>

      <div className={`${w.rWrap} ${s.twoCol}`}>
        <section aria-labelledby="next-title">
          <h2 id="next-title" className={w.rH2}>
            What happens next
          </h2>
          <ol className={s.timeline}>
            {steps.map((st) => (
              <li key={st.title} className={st.done ? s.done : undefined}>
                <div>
                  <h3 className={w.rH3}>{st.title}</h3>
                  <p>{st.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <aside className={s.sideSticky} aria-label="Your booking">
          <div className={w.card}>
            {item.look && (
              <div className={s.sidePic}>
                <Image src={`/looks/${item.look.img}.webp`} alt="" fill sizes="(max-width: 900px) 100vw, 30vw" />
              </div>
            )}
            <dl className={s.facts}>
              {[
                ['Look', item.name],
                ['Collect', collect],
                ['Hand back', handBack],
                ['Shop', `Ledgerton ${hire.branch}`],
                ['Hire fee, taken at collection', gbp0(fee)],
                ['Deposit, held then released', gbp0(deposit)],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            <p className={s.notice}>Plans changed? Call Ledgerton {hire.branch} with your reference.</p>
          </div>
        </aside>
      </div>
    </RenterPage>
  );
}
