import type { Metadata } from 'next';
import { RenterPage } from '../chrome';
import s from '../screens.module.css';
import w from '../wire.module.css';
import { LookGrid } from './look-grid';

export const metadata: Metadata = { title: 'The looks' };

export default function LooksPage() {
  return (
    <RenterPage>
      <div className={w.rWrap}>
        <header className={s.rHead}>
          <h1 className={w.rH1}>The looks.</h1>
          <p className={w.rLead}>
            Head to toe, ready for the weekend. Every look is cleaned between hires, and the price covers Friday to
            Monday.
          </p>
        </header>
        <LookGrid />
      </div>
    </RenterPage>
  );
}
