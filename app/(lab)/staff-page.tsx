// The staff page frame: brand, nav, who is signed in, sign out. Server-only (it reads the session cookie), so it lives
// apart from chrome.tsx, which client components import too.

import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/app/staff-login/actions";
import { signedInStaff } from "@/lib/staff";
import { STAFF_NAV, staffUrl } from "./chrome";
import w from "./wire.module.css";

export async function StaffPage({ current, children }: { current?: (typeof STAFF_NAV)[number]["id"]; children: ReactNode }) {
  const who = await signedInStaff();
  return (
    <div className={w.staff}>
      <a href="#main" className={w.skip}>
        Skip to content
      </a>
      <div className={w.sBar}>
        <Link href={staffUrl.controlRoom} className={w.sBrand}>
          Clearhold<span>Ledgerton Hire</span>
        </Link>
        <nav aria-label="Staff">
          <ul>
            {STAFF_NAV.map(({ id, label, href }) => (
              <li key={id}>
                <Link href={href} aria-current={current === id ? "page" : undefined}>
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className={w.sWho}>
          {who ? `${who.name}${who.shop ? ` · ${who.shop}` : ""}` : "Signed in as staff"}{" "}
          <form action={signOut} className={w.inlineForm}>
            <button type="submit">Sign out</button>
          </form>
        </div>
      </div>
      <main id="main" className={w.sMain}>
        {children}
      </main>
    </div>
  );
}
