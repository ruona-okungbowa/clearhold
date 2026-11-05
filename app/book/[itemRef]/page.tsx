import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { AI_NOTICE, CLAUSES, ITEMS } from '@/lib/schedule';
import { PayPalHold } from './paypal-hold';

export const metadata: Metadata = { title: 'Book a hire' };

const gbp = (n: number) => `£${n.toFixed(2)}`;

export default async function BookPage({ params }: PageProps<'/book/[itemRef]'>) {
  const { itemRef } = await params;
  const item = ITEMS[itemRef];
  if (!item) notFound();
  const marks = await db.itemMark.findMany({ where: { itemRef }, orderBy: { createdAt: 'asc' } });
  const clientId = process.env.PAYPAL_CLIENT_ID;

  return (
    <main>
      <h1>Hire: {item.name}</h1>
      <p>
        Ledgerton {item.branch} · {item.hireDays}-day hire · item {itemRef}
      </p>

      <h2>Your money</h2>
      <ul>
        <li>Hire fee {gbp(item.feeGBP)}: taken when you collect it.</li>
        <li>Deposit {gbp(item.depositGBP)}: held, not taken. Released when you return it, minus any charge a person approves.</li>
        <li>
          <strong>Held on your PayPal today: {gbp(item.feeGBP + item.depositGBP)}.</strong> A hold lowers your available balance until
          it is released.
        </li>
      </ul>

      <h2>Damage schedule</h2>
      <table>
        <thead>
          <tr>
            <th>Clause</th>
            <th>What it covers</th>
            <th>Charge</th>
          </tr>
        </thead>
        <tbody>
          {CLAUSES.map((c) => (
            <tr key={c.id}>
              <td>{c.id}</td>
              <td>{c.name}</td>
              <td>
                {!c.chargeable
                  ? 'Never charged'
                  : c.lowGBP === c.highGBP
                    ? gbp(c.lowGBP)
                    : `${gbp(c.lowGBP)}–${gbp(c.highGBP)}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {marks.length > 0 && <p>Known marks already on this item are never charged: {marks.map((m) => m.description).join('; ')}.</p>}

      <h2>How returns are checked</h2>
      <p>{AI_NOTICE}</p>

      {clientId ? <PayPalHold clientId={clientId} itemRef={itemRef} /> : <p role="alert">PAYPAL_CLIENT_ID is not set.</p>}
    </main>
  );
}
