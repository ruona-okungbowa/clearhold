// Shared chrome for the renter and staff screens. Importing the fonts here means every screen loads them.
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/app/staff-login/actions";
import w from "./wire.module.css";

export type ChipKind = "stAi" | "stHuman" | "stLook" | "stOk" | "stPlain";
export function Chip({ kind, children }: { kind: ChipKind; children: ReactNode }) {
  return <span className={`${w.st} ${w[kind]}`}>{children}</span>;
}

export function Who({ ai, children }: { ai?: boolean; children: ReactNode }) {
  return <span className={ai ? w.whoAi : w.whoHuman}>{children}</span>;
}

// `home` is '' on the landing itself (in-page anchors) and '/' everywhere else.
export function RenterNav({ home = "/", className }: { home?: string; className?: string }) {
  return (
    <header className={`${w.rNav} ${className ?? ""}`}>
      <Link href="/" className={w.wordmark}>
        Clearhold
      </Link>
      <nav aria-label="Main">
        <ul>
          <li>
            <Link href="/looks">The looks</Link>
          </li>
          <li>
            <Link href={`${home}#how`}>How it works</Link>
          </li>
          <li>
            <Link href={`${home}#rules`}>Our promise</Link>
          </li>
          <li>
            <Link href={`${home}#help`}>Help</Link>
          </li>
          <li>
            <Link href="/staff-login">Staff sign-in</Link>
          </li>
        </ul>
      </nav>
      <Link href="/looks" className={w.rNavAction}>
        Find your look
      </Link>
    </header>
  );
}

export function RenterFooter({ children }: { children?: ReactNode }) {
  return (
    <footer className={w.rFoot}>
      <span className={w.rFootMark} aria-hidden="true">
        Clearhold
      </span>
      <p className={w.rFootNote}>{children}Ledgerton Hire and its customers are fictional.</p>
    </footer>
  );
}

export function RenterPage({ tone = "lining", children }: { tone?: "lining" | "sky"; children: ReactNode }) {
  return (
    <div className={`${w.renter} ${tone === "sky" ? w.toneSky : ""}`}>
      <a href="#main" className={w.skip}>
        Skip to content
      </a>
      <RenterNav />
      <main id="main">{children}</main>
      <RenterFooter />
    </div>
  );
}

export const staffUrl = {
  controlRoom: "/control-room",
  openHires: "/control-room?view=open",
  hire: (ref: string) => `/hire/${ref}`,
  approve: (ref: string) => `/hire/${ref}/approve`,
  capture: (ref: string, stage: "pickup" | "return") => `/c/${ref}/${stage}`,
  disputes: "/disputes",
  dispute: (ref: string) => `/disputes/${ref}`,
};

const STAFF_NAV = [
  { id: "control-room", label: "Control room", href: staffUrl.controlRoom },
  { id: "hire", label: "Hires", href: staffUrl.openHires },
  { id: "disputes", label: "Disputes", href: staffUrl.disputes },
] as const;

export function StaffPage({ current, children }: { current?: (typeof STAFF_NAV)[number]["id"]; children: ReactNode }) {
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
          Signed in as staff{" "}
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

// Money as the screens show it.
export const gbp = (n: number) => `£${n.toFixed(2)}`;
export const gbp0 = (n: number) => (Number.isInteger(n) ? `£${n}` : gbp(n));

const LONDON = "Europe/London";
export const dayLabel = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: LONDON });
export const timeLabel = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: LONDON });
export const stamp = (d: Date) => `${d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: LONDON })} ${timeLabel(d)}`;
