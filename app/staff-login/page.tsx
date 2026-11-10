import type { Metadata } from 'next';

import { SHOPS } from '@/lib/catalogue';
import { RenterNav } from '@/app/(lab)/chrome';
import st from '@/app/(lab)/staff.module.css';
import w from '@/app/(lab)/wire.module.css';
import { signIn } from './actions';
import { Passcode } from './passcode';

export const metadata: Metadata = { title: 'Staff sign-in' };

// Wireframe look, real action: signIn checks STAFF_PASSCODE and sets the cookie proxy.ts looks for.
export default async function StaffLoginPage({ searchParams }: PageProps<'/staff-login'>) {
  const { next, error } = await searchParams;
  const badName = error === 'name';
  const bad = Boolean(error) && !badName;
  return (
    <div className={w.staff}>
      <a href="#main" className={w.skip}>
        Skip to content
      </a>
      <RenterNav className={st.signNav} />
      <main id="main" className={st.signWrap}>
        <form action={signIn} className={st.signCard}>
          <input type="hidden" name="next" value={typeof next === 'string' ? next : ''} />
          <p className={st.brand}>
            Clearhold <span>Ledgerton Hire</span>
          </p>
          <h1 className={w.sH1}>Staff sign-in</h1>
          <p className={w.sSub}>For shop staff only. Renters don’t need an account: everything comes by email.</p>
          <label className={w.sField}>
            <span>Your name</span>
            <input
              name="name"
              className={w.sInput}
              autoComplete="name"
              required
              minLength={2}
              maxLength={60}
              aria-invalid={badName || undefined}
              aria-describedby={badName ? 'name-error' : undefined}
            />
          </label>
          {badName && (
            <p id="name-error" role="alert" className={w.sErr}>
              Give your name as letters (2 to 60): it is recorded on everything you approve or send.
            </p>
          )}
          <Passcode bad={bad} />
          <label className={w.sField}>
            <span>Shop</span>
            <select name="shop" className={w.sInput} defaultValue="Halifax">
              {SHOPS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <button type="submit" className={w.btn}>
            Sign in
          </button>
          <p className={w.sSub}>
            Signed in for 8 hours on this device. Every approval you make, and anything you send to PayPal, is recorded with your name.
          </p>
        </form>
      </main>
    </div>
  );
}
