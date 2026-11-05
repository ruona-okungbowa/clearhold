import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { holdOf } from '@/lib/hold';
import { ANGLES, ITEMS } from '@/lib/schedule';
import { handOver, runInspector } from './actions';

export const metadata: Metadata = { title: 'Hire' };

const gbp = (n: number) => `£${n.toFixed(2)}`;

export default async function HirePage({ params }: PageProps<'/hire/[hireRef]'>) {
  const { hireRef } = await params;
  const hold = await holdOf(hireRef).catch((err: Error) => (err.message.startsWith('No hold') ? notFound() : Promise.reject(err)));
  const { hire, auth, captures, capturedGBP, remainingGBP, heldAtBookingGBP } = hold;
  const [photos, findings, events] = await Promise.all([
    db.photo.groupBy({ by: ['stage'], where: { hireId: hire.id }, _count: true }),
    db.finding.count({ where: { hireId: hire.id } }),
    db.auditEvent.findMany({ where: { hireRef }, orderBy: { at: 'asc' } }),
  ]);
  const photoCount = (stage: string) => photos.find((p) => p.stage === stage)?._count ?? 0;
  const released = hire.status === 'settled';

  return (
    <main>
      <h1>Hire {hireRef}</h1>
      <p>
        {ITEMS[hire.itemRef]?.name ?? hire.itemRef} · {hire.branch} · status <strong>{hire.status}</strong>
      </p>

      <h2>Hold</h2>
      <ul>
        <li>
          PayPal authorization {auth.id}: <strong>{auth.status}</strong>
        </li>
        <li>Held at booking: {gbp(heldAtBookingGBP)}</li>
        <li>Captured: {gbp(capturedGBP)}</li>
        <li>{released ? `Released: ${gbp(remainingGBP)}` : `Still held: ${gbp(remainingGBP)}`}</li>
        <li>Honour period ends {auth.honourEndsAt.toLocaleString('en-GB')}; expires {auth.expiresAt.toLocaleString('en-GB')}</li>
      </ul>
      {captures.length > 0 && (
        <ol>
          {captures.map((c) => (
            <li key={c.id}>
              {gbp(Number(c.amountGBP))} captured, {c.finalCapture ? 'final' : 'not final'} ({c.id}, {c.status})
            </li>
          ))}
        </ol>
      )}

      <h2>Pick-up</h2>
      <p>
        <Link href={`/c/${hireRef}/pickup`}>Pick-up photos</Link>: {photoCount('pickup')} of {ANGLES.length}
      </p>
      {hire.status === 'booked' && (
        <form action={handOver.bind(null, hireRef)}>
          <button>Hand over (takes the {gbp(Number(hire.feeGBP))} fee, keeps the deposit held)</button>
        </form>
      )}

      <h2>Return</h2>
      <p>
        <Link href={`/c/${hireRef}/return`}>Return photos</Link>: {photoCount('return')} of {ANGLES.length}
      </p>
      {hire.status !== 'settled' && (
        <form action={runInspector.bind(null, hireRef)}>
          <button>Run the inspector</button> (one model call per angle; takes up to a minute)
        </form>
      )}
      <p>
        <Link href={`/hire/${hireRef}/approve`}>Findings and approval</Link> ({findings} findings)
      </p>

      <h2>Audit trail</h2>
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>Actor</th>
            <th>Type</th>
            <th>Summary</th>
            <th>PayPal debug id</th>
            <th>Request id</th>
            <th>Model</th>
            <th>Tokens</th>
            <th>ms</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td>{e.at.toLocaleTimeString('en-GB')}</td>
              <td>{e.actor}</td>
              <td>{e.type}</td>
              <td>{e.summary}</td>
              <td>{e.paypalDebugId}</td>
              <td>{e.idempotencyKey}</td>
              <td>{e.model && `${e.model} (${e.promptVersion})`}</td>
              <td>{e.tokens}</td>
              <td>{e.latencyMs}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
