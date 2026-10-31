import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { verifyApproval } from '@/lib/approval';
import { db } from '@/lib/db';
import { holdOf } from '@/lib/hold';
import { ANGLES, CLAUSES } from '@/lib/schedule';
import { approveCharges, settleHire } from '../actions';

export const metadata: Metadata = { title: 'Approve charges' };

const gbp = (n: number) => `£${n.toFixed(2)}`;
const order = new Map<string, number>(ANGLES.map((a, i) => [a.id, i]));

export default async function ApprovePage({ params }: PageProps<'/hire/[hireRef]/approve'>) {
  const { hireRef } = await params;
  const hold = await holdOf(hireRef).catch((err: Error) => (err.message.startsWith('No hold') ? notFound() : Promise.reject(err)));
  const { hire, auth, remainingGBP } = hold;
  const [findings, approvals] = await Promise.all([
    db.finding.findMany({ where: { hireId: hire.id } }),
    db.approval.findMany({ where: { authorizationId: auth.id }, orderBy: { createdAt: 'asc' } }),
  ]);
  findings.sort((a, b) => (order.get(a.angle) ?? 9) - (order.get(b.angle) ?? 9));
  const totalGBP = findings.filter((f) => f.outcome === 'charge').reduce((sum, f) => sum + Number(f.proposedGBP), 0);
  const checks = await Promise.all(
    approvals.map((a) =>
      verifyApproval(a.token).then(
        (c) => `signature verifies (sub ${c.sub}, max £${c.max}, expires ${new Date(c.exp * 1000).toLocaleTimeString('en-GB')})`,
        (err: Error) => err.message,
      ),
    ),
  );
  const now = new Date();
  const open = approvals.find((a) => a.finalCapture && !a.usedAt && a.expiresAt > now);
  const settled = hire.status === 'settled';

  return (
    <main>
      <p>
        <Link href={`/hire/${hireRef}`}>← Hire {hireRef}</Link>
      </p>
      <h1>Findings for {hireRef}</h1>
      <p>
        Hold {auth.id}: {auth.status}. Still held: {gbp(remainingGBP)}.
      </p>

      {findings.length === 0 ? (
        <p>No findings yet. Run the inspector from the hire page.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Angle</th>
              <th>Kind</th>
              <th>What the inspector saw</th>
              <th>Clause</th>
              <th>Severity</th>
              <th>Confidence</th>
              <th>Outcome</th>
              <th>Amount</th>
              <th>Why</th>
              <th>Photos (pick-up / return)</th>
            </tr>
          </thead>
          <tbody>
            {findings.map((f) => (
              <tr key={f.id}>
                <td>{f.angle}</td>
                <td>{f.kind}</td>
                <td>{f.description}</td>
                <td>{f.clauseId && `${f.clauseId}: ${CLAUSES.find((c) => c.id === f.clauseId)?.name ?? 'not in schedule'}`}</td>
                <td>{f.severity}</td>
                <td>{f.confidence.toFixed(2)}</td>
                <td>{f.outcome === 'owner_look' ? 'Owner look' : f.outcome === 'charge' ? 'Charge' : 'No charge'}</td>
                <td>{f.proposedGBP === null ? '—' : gbp(Number(f.proposedGBP))}</td>
                <td>{f.reason}</td>
                <td>
                  {f.pickupPhotoId} / {f.returnPhotoId}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Approve</h2>
      <p>
        Proposed total: <strong>{gbp(totalGBP)}</strong>. Owner-look findings carry no amount and are not part of it.
      </p>
      {!settled && totalGBP > 0 && !open && (
        <form action={approveCharges.bind(null, hireRef)}>
          <button>Approve up to {gbp(totalGBP)} as Priya (H-01)</button>
        </form>
      )}

      <h2>Approval records</h2>
      {approvals.length === 0 ? (
        <p>None yet.</p>
      ) : (
        <ol>
          {approvals.map((a, i) => (
            <li key={a.id}>
              {a.approver} approved up to {gbp(Number(a.maxGBP))} from hold {a.authorizationId}
              {a.finalCapture ? ' (final capture)' : ' (fee, not final)'}; expires {a.expiresAt.toLocaleString('en-GB')};{' '}
              {a.usedAt ? `used ${a.usedAt.toLocaleString('en-GB')}` : 'unused'}. Check: {checks[i]}.
            </li>
          ))}
        </ol>
      )}

      {open && !settled && (
        <form action={settleHire.bind(null, hireRef)}>
          <button>
            Capture {gbp(Number(open.maxGBP))} (final) and release {gbp(remainingGBP - Number(open.maxGBP))}
          </button>
        </form>
      )}
    </main>
  );
}
