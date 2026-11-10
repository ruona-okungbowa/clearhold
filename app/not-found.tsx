import type { Metadata } from 'next';
import Link from 'next/link';
import { RenterPage } from './(lab)/chrome';
import s from './(lab)/screens.module.css';
import w from './(lab)/wire.module.css';

export const metadata: Metadata = { title: 'Page not found' };

export default function NotFound() {
  return (
    <RenterPage>
      <div className={`${w.rWrap} ${s.sent}`}>
        <p className={w.kicker}>404</p>
        <h1 className={`${w.rH1} ${s.sentH1}`}>We can’t find that one.</h1>
        <p className={w.rLead}>It may have gone back on the rail. Every look we hire is on the looks page.</p>
        <div className={s.actions}>
          <Link href="/looks" className={w.block}>
            See the looks
          </Link>
        </div>
      </div>
    </RenterPage>
  );
}
