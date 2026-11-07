import Link from "next/link";

const links = [
  { href: "/control-room", label: "Control room", detail: "Every hold, hire and finding" },
  { href: "/disputes", label: "Disputes", detail: "PayPal disputes" },
  // The first aged sandbox hold in scripts/seed-holds.ts.
  { href: "/hire/LH-HAL-0101", label: "Demo hire", detail: "LH-HAL-0101" },
];

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-3xl p-16 font-paypal text-pp-ink">
      <h1 className="text-[28px] font-semibold text-pp-navy">Clearhold</h1>
      <p className="mt-2 text-lg font-semibold">
        Others detect damage. Clearhold settles the deposit.
      </p>
      <p className="mt-4 text-pp-muted">
        A hire shop takes one PayPal hold at booking, and Clearhold compares the pick-up and return photos
        to price any new damage against the shop&apos;s schedule. A person approves every charge, and
        whatever isn&apos;t charged goes back to the renter.
      </p>
      <p className="mt-8 text-sm text-pp-muted">Staff pages need the demo passcode.</p>
      <ul className="mt-2 divide-y divide-pp-border border-y border-pp-border">
        {links.map(({ href, label, detail }) => (
          <li key={href}>
            <Link
              href={href}
              className="flex items-baseline justify-between gap-4 py-3 hover:text-pp-blue"
            >
              <span className="font-semibold">{label} →</span>
              <span className="text-sm text-pp-muted">{detail}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
