import type { Metadata } from 'next';

import { SHOPS } from '@/lib/catalogue';
import st from '@/app/(lab)/staff.module.css';
import w from '@/app/(lab)/wire.module.css';
import { signIn } from './actions';
import { Passcode } from './passcode';

export const metadata: Metadata = { title: 'Staff sign-in' };

// Wireframe look, real action: signIn checks STAFF_PASSCODE and sets the cookie proxy.ts looks for.
export default async function StaffLoginPage({ searchParams }: PageProps<'/staff-login'>) {
  const { next, error } = await searchParams;
  const bad = Boolean(error);
  return (
    <div className={w.staff}>
      <main className={st.signWrap}>
        <form action={signIn} className={st.signCard}>
          <input type="hidden" name="next" value={typeof next === 'string' ? next : ''} />
          <p className={st.brand}>
            Clearhold <span>Ledgerton Hire</span>
          </p>
          <h1 className={w.sH1}>Staff sign-in</h1>
          <p className={w.sSub}>For shop staff only. Renters don’t need an account: everything comes by email.</p>
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
            Signed in for 8 hours on this device. Every approval you make is recorded with your staff code.
          </p>
        </form>
      </main>
    </div>
  );
}
