'use client';

import { useEffect, useRef, useState } from 'react';
import { addDays, clashes, startAllowed, type Booked } from '@/lib/booking';
import { feeOf, HIRE_DAYS, lookItemRef, PRICE_LIST, SHOPS, type Look } from '@/lib/catalogue';
import s from '../screens.module.css';
import w from '../wire.module.css';
import type { BookingInput } from './actions';
import { PayPalHold } from './paypal-hold';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);
const dayName = (iso: string) => DAYS[utc(iso).getUTCDay()];
const dayNum = (iso: string) => utc(iso).getUTCDate();
const monthName = (iso: string) => utc(iso).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const monthStart = (iso: string, offset: number) => {
  const d = utc(iso);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1)).toISOString().slice(0, 10);
};

function monthDays(first: string) {
  const d = utc(first);
  const count = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  return { blanks: (d.getUTCDay() + 6) % 7, days: Array.from({ length: count }, (_, i) => addDays(first, i)) };
}

export function BookingPanel({ look, today, booked, clientId }: { look: Look; today: string; booked: Booked[]; clientId?: string }) {
  const [size, setSize] = useState(look.sizes[Math.min(2, look.sizes.length - 1)]);
  const [shop, setShop] = useState('Halifax');
  const [month, setMonth] = useState(0);
  const forSize = (sz: string) => booked.filter((b) => b.itemRef === lookItemRef(look, sz));
  const off = (iso: string, sz = size) => !startAllowed(iso, today) || clashes(iso, forSize(sz));
  // The first free Friday, so the hire covers a weekend; otherwise the first free day.
  const firstFree = (sz: string) => {
    const days = Array.from({ length: 30 }, (_, i) => addDays(today, i + 1)).filter((d) => !off(d, sz));
    return days.find((d) => dayName(d) === 'Fri') ?? days[0] ?? null;
  };
  const [start, setStart] = useState<string | null>(() => firstFree(size));

  const fee = feeOf(look);
  const end = start && addDays(start, HIRE_DAYS);
  const ok = Boolean(start && !off(start));
  const first = monthStart(today, month);
  const { blanks, days } = monthDays(first);

  const input = useRef<BookingInput>({ itemRef: lookItemRef(look, size), branch: shop, start: start ?? '' });
  useEffect(() => {
    input.current = { itemRef: lookItemRef(look, size), branch: shop, start: start ?? '' };
  }, [look, size, shop, start]);

  return (
    <div className={s.bookCol}>
      <div className={s.intro}>
        <p className={w.kicker}>{look.occasion}</p>
        <h1 className={`${w.rH1} ${s.lookH1}`}>{look.name}</h1>
        <p className={`${w.rLead} ${s.blurb}`}>{look.blurb}</p>
      </div>

      <section className={s.inLook} aria-labelledby="in-look">
        <h2 id="in-look" className={s.fieldLabel}>In this look</h2>
        <ul className={s.pieceList}>
          {look.pieces.map(([piece, price]) => (
            <li key={piece}>
              <span>{piece}</span>
              <span>£{price}</span>
            </li>
          ))}
        </ul>
      </section>

      <fieldset className={w.chips}>
        <legend>Size</legend>
        {look.sizes.map((sz) => (
          <label key={sz} className={w.chip}>
            <input type="radio" name="size" value={sz} checked={sz === size} onChange={() => setSize(sz)} />
            <span>{sz}</span>
          </label>
        ))}
        {start && !ok && clashes(start, forSize(size)) && (
          <p className={s.sizeNote} role="status">
            Size {size} is already out on those dates. Pick another day or size.
          </p>
        )}
      </fieldset>

      <div className={s.cal}>
        <div className={s.calHead}>
          <button type="button" className={s.calArrow} aria-label="Previous month" disabled={month === 0} onClick={() => setMonth(0)}>
            ‹
          </button>
          <span id="cal-title">Pick your collection day · {monthName(first)}</span>
          <button type="button" className={s.calArrow} aria-label="Next month" disabled={month === 1} onClick={() => setMonth(1)}>
            ›
          </button>
        </div>
        <div className={s.calGrid} role="group" aria-labelledby="cal-title">
          {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => (
            <span key={d} className={s.wd} aria-hidden="true">
              {d}
            </span>
          ))}
          {Array.from({ length: blanks }, (_, i) => (
            <span key={`blank-${i}`} />
          ))}
          {days.map((iso) => {
            const isOff = off(iso);
            const taken = startAllowed(iso, today) && isOff;
            const cls = isOff
              ? s.dayOff
              : iso === start || iso === end
                ? s.dayEnd
                : start && end && iso > start && iso < end
                  ? s.dayIn
                  : '';
            return (
              <button
                key={iso}
                type="button"
                className={`${s.day} ${cls}`}
                disabled={isOff}
                aria-pressed={iso === start}
                aria-label={`${dayName(iso)} ${dayNum(iso)} ${monthName(iso)}${taken ? ', already booked' : ''}`}
                onClick={() => setStart(iso)}
              >
                {dayNum(iso)}
              </button>
            );
          })}
        </div>
        {start && end && (
          <div className={s.calKey}>
            <div>
              Collect{' '}
              <strong>
                {dayName(start)} {dayNum(start)} {monthName(start).split(' ')[0].slice(0, 3)}, from 10am
              </strong>
            </div>
            <div>
              Hand back{' '}
              <strong>
                {dayName(end)} {dayNum(end)} {monthName(end).split(' ')[0].slice(0, 3)}, by 5pm
              </strong>
            </div>
          </div>
        )}
      </div>

      <label className={w.field}>
        <span>Collect from</span>
        <select className={w.select} value={shop} onChange={(e) => setShop(e.target.value)}>
          {SHOPS.map((sh) => (
            <option key={sh} value={sh}>
              Ledgerton {sh}
            </option>
          ))}
        </select>
      </label>

      <section className={s.summary} aria-labelledby="sum-title">
        <h2 id="sum-title" className={w.rH3}>
          {look.name}, size {size}
        </h2>
        {start && end && (
          <p className={`${w.muted} ${s.sumWhen}`}>
            {dayName(start)} {dayNum(start)} to {dayName(end)} {dayNum(end)} {monthName(end).split(' ')[0].slice(0, 3)} · {shop}
          </p>
        )}
        <p className={s.sumTotal}>
          <span>Weekend hire, cleaning included</span>
          <strong>£{fee}</strong>
        </p>
        <p className={w.small}>
          Nothing is taken today. We place a hold on your PayPal for £{fee + look.deposit}: the £{fee} hire fee is taken when
          you collect, and the £{look.deposit} deposit is released when you hand it back.
        </p>
        {clientId ? (
          <PayPalHold clientId={clientId} input={input} disabled={!ok} />
        ) : (
          <p role="alert" className={w.sErr}>
            Payments aren’t set up: PAYPAL_CLIENT_ID is missing.
          </p>
        )}
      </section>

      <div>
        <details className={w.details}>
          <summary>The price list, if something needs fixing</summary>
          <div>
            <table className={s.priceTable}>
              <tbody>
                {PRICE_LIST.map((row) => (
                  <tr key={row.id}>
                    <td>{row.what}</td>
                    <td>{row.price}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>Marks already on this look are noted at pick-up and never charged to you.</p>
          </div>
        </details>
        <details className={w.details}>
          <summary>How returns are checked</summary>
          <div>
            <p>
              An AI compares your pick-up and return photos and suggests any charge from the price list. A person at the shop
              approves every charge, you see the same photos, and you can contest once.
            </p>
          </div>
        </details>
      </div>
    </div>
  );
}
