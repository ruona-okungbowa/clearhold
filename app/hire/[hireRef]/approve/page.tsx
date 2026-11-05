import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { verifyApproval } from '@/lib/approval';
import { db } from '@/lib/db';
import { holdOf } from '@/lib/hold';
import { ANGLES, CLAUSES } from '@/lib/schedule';
import { approveCharges, releaseHold, setAmount, settleHire } from '../actions';

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
  const totalGBP = findings.reduce((sum, f) => sum + Number(f.setGBP ?? f.proposedGBP ?? 0), 0);
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
  const unpriced = findings.filter((f) => f.outcome === 'owner_look' && f.setGBP === null).length;

  return (
    <main>
      <p>
        <Link href={`/hire/${hireRef}`}>← Hire {hireRef}</Link>
      </p>
      <h1>Findings for {hireRef}</h1>
      <p>
        Hold {auth.id}: {auth.status}. {settled ? 'Released' : 'Still held'}: {gbp(remainingGBP)}.
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
            {findings.map((f) => {
              const clause = CLAUSES.find((c) => c.id === f.clauseId);
              return (
                <tr key={f.id}>
                  <td>{f.angle}</td>
                  <td>{f.kind}</td>
                  <td>{f.description}</td>
                  <td>{f.clauseId && `${f.clauseId}: ${clause?.name ?? 'not in schedule'}`}</td>
                  <td>{f.severity}</td>
                  <td>{f.confidence.toFixed(2)}</td>
                  <td>{f.outcome === 'owner_look' ? 'Owner look' : f.outcome === 'charge' ? 'Charge' : 'No charge'}</td>
                  <td>
                    {f.setGBP === null
                      ? f.proposedGBP === null
                        ? '—'
                        : gbp(Number(f.proposedGBP))
                      : f.outcome === 'charge'
                        ? `${gbp(Number(f.setGBP))}, lowered from ${gbp(Number(f.proposedGBP))} by ${f.setBy}`
                        : `${gbp(Number(f.setGBP))}, set by ${f.setBy}`}
                    {(f.outcome === 'owner_look' || f.outcome === 'charge') && clause?.chargeable && !settled && (
                      <form action={setAmount.bind(null, hireRef, f.id)}>
                        <label>
                          {f.outcome === 'charge'
                            ? `Lower to, in £ (up to ${gbp(Number(f.proposedGBP))}; 0 waives it, blank restores it)`
                            : `Amount in £ (${clause.lowGBP === clause.highGBP ? gbp(clause.lowGBP) : `${gbp(clause.lowGBP)}–${gbp(clause.highGBP)}`}, capped at the hold; blank clears)`}{' '}
                          <input className="border" name="amountGBP" type="number" min="0" step="0.01" defaultValue={f.setGBP === null ? '' : Number(f.setGBP).toFixed(2)} />
                        </label>{' '}
                        <button>{f.outcome === 'charge' ? 'Lower' : 'Set amount'}</button>
                      </form>
                    )}
                  </td>
                  <td>{f.reason}</td>
                  <td>
                    {f.pickupPhotoId} / {f.returnPhotoId}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <h2>Approve</h2>
      <p>
        Total to approve: <strong>{gbp(totalGBP)}</strong>. An owner-look finding counts only once a person sets its amount.
      </p>
      {!settled && totalGBP > 0 && !open && (
        <form action={approveCharges.bind(null, hireRef)}>
          <button>Approve up to {gbp(totalGBP)} as Priya (H-01)</button>
        </form>
      )}
      {!settled && totalGBP === 0 && findings.length > 0 && hire.status !== 'booked' && (
        <form action={releaseHold.bind(null, hireRef)}>
          {unpriced > 0 && <p>{unpriced} owner-look finding(s) have no amount: releasing means no charge for them.</p>}
          <button>Release {gbp(remainingGBP)}, no charge, as Priya (H-01)</button>
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
