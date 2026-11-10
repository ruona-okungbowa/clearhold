'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { LOOKS, SHOPS, feeOf } from '@/lib/catalogue';
import s from '../screens.module.css';
import w from '../wire.module.css';

const OCCASIONS = ['All', ...new Set(LOOKS.map((l) => l.occasion))];

export function LookGrid() {
  const [occasion, setOccasion] = useState('All');
  const [shop, setShop] = useState('Halifax');
  const looks = occasion === 'All' ? LOOKS : LOOKS.filter((l) => l.occasion === occasion);

  return (
    <>
      <div className={s.filterBar}>
        <fieldset className={w.chips}>
          <legend>Occasion</legend>
          {OCCASIONS.map((o) => (
            <label key={o} className={w.chip}>
              <input type="radio" name="occasion" value={o} checked={o === occasion} onChange={() => setOccasion(o)} />
              <span>{o}</span>
            </label>
          ))}
        </fieldset>
        <label className={`${w.field} ${s.shopField}`}>
          <span>Collect from</span>
          <select className={w.select} value={shop} onChange={(e) => setShop(e.target.value)}>
            {SHOPS.map((sh) => (
              <option key={sh}>{sh}</option>
            ))}
          </select>
        </label>
      </div>
      <p role="status" className={s.status}>
        {looks.length} {looks.length === 1 ? 'look' : 'looks'} in {shop} this weekend
      </p>
      <ul className={s.lookGrid}>
        {looks.map((look, i) => (
          <li key={look.slug}>
            <Link href={`/looks/${look.slug}`} className={s.lookCard}>
              <div className={s.lookPic}>
                {look.slug === 'bestman' && <span className={s.badge}>Most hired</span>}
                <Image
                  src={`/looks/${look.img}.webp`}
                  alt=""
                  fill
                  sizes="(max-width: 900px) 50vw, 30vw"
                  loading={i < 3 ? 'eager' : 'lazy'}
                />
              </div>
              <div className={s.lookMeta}>
                <div>
                  <p className={w.kicker}>{look.occasion}</p>
                  <h2 className={w.rH3}>{look.name}</h2>
                </div>
                <p className={s.lookFrom}>
                  <strong>£{feeOf(look)}</strong> the weekend
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
