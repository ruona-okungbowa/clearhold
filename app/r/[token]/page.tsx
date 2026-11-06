import type { Metadata } from 'next';
import { db } from '@/lib/db';
import { amountPence, holdOf } from '@/lib/hold';
import { verifyRenterLink } from '@/lib/renter-link';
import { AI_NOTICE, ANGLES, CLAUSES, ITEMS } from '@/lib/schedule';
import { RenterActions } from './renter-actions';

export const metadata: Metadata = { title: 'Your hire', robots: { index: false } };

const gbp = (pence: number) => `£${(pence / 100).toFixed(2)}`;
const order = new Map<string, number>(ANGLES.map((a, i) => [a.id, i]));
const CARD = 'rounded-lg border border-pp-border bg-pp-surface p-4';

// The renter's view of a returned hire: the same photos staff saw, each charge and its clause, and Accept or one
// Contest. No staff controls; everything is read through the signed link in the URL.
export default async function RenterPage({ params }: PageProps<'/r/[token]'>) {
  const { token } = await params;
  const hireRef = await verifyRenterLink(token).catch(() => null);
  if (!hireRef)
    return (
      <main className="mx-auto w-full max-w-xl px-4 py-10">
        <h1 className="text-xl font-semibold">This link has expired</h1>
        <p className="mt-2 text-pp-muted">Ask the shop for a new one.</p>
      </main>
    );

  const { hire, auth, captures, remainingGBP } = await holdOf(hireRef);
  const [findings, contest, open] = await Promise.all([
    db.finding.findMany({ where: { hireId: hire.id } }),
    db.contest.findUnique({ where: { hireId: hire.id } }),
    db.approval.findFirst({
      where: { authorizationId: auth.id, finalCapture: true, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  findings.sort((a, b) => (order.get(a.angle) ?? 9) - (order.get(b.angle) ?? 9));
  const totalPence = findings.reduce((sum, f) => sum + amountPence(f), 0);
  const leftPence = Math.round(remainingGBP * 100);
  const settled = hire.status === 'settled';
  const finalCapture = captures.find((c) => c.finalCapture && c.authorizationId === auth.id);
  const photo = (id: string) => `/api/photos/${id}?t=${token}`;
  const angleLabel = (angle: string) => ANGLES.find((a) => a.id === angle)?.label ?? angle;

  return (
    <main className="mx-auto w-full max-w-xl space-y-5 px-4 py-6">
      <header>
        <p className="text-sm text-pp-muted">Hire {hire.hireRef}</p>
        <h1 className="text-xl font-semibold">{ITEMS[hire.itemRef]?.name ?? hire.itemRef}</h1>
      </header>

      {settled ? (
        <section className={CARD} role="status">
          <h2 className="font-semibold">Settled</h2>
          <p className="mt-1">
            Charged <strong>{gbp(Math.round(Number(finalCapture?.amountGBP ?? 0) * 100))}</strong>, released{' '}
            <strong>{gbp(leftPence)}</strong> back to you.
          </p>
        </section>
      ) : (
        <section className={CARD}>
          <p>
            To be charged: <strong>{gbp(totalPence)}</strong>
          </p>
          <p>
            Released back to you: <strong>{gbp(leftPence - totalPence)}</strong>
          </p>
          {!open && !contest && <p className="mt-2 text-sm text-pp-muted">Staff are still reviewing these charges.</p>}
        </section>
      )}

      {contest && (
        <section className={CARD}>
          <h2 className="font-semibold">Your contest {contest.status === 'open' ? 'is with staff' : 'was resolved'}</h2>
          <p className="mt-1 whitespace-pre-wrap">{contest.note}</p>
          {contest.photoId && (
            // eslint-disable-next-line @next/next/no-img-element -- a private photo of unknown size, not for the image optimiser
            <img src={photo(contest.photoId)} alt="Your contest photo" className="mt-2 w-full rounded" />
          )}
          <p className="mt-2 text-sm text-pp-muted">
            {contest.status === 'open'
              ? 'Nothing is charged while staff look again. They can keep, lower or remove a charge, never raise it.'
              : `Resolved by ${contest.resolvedBy}. The amounts above are the outcome.`}
          </p>
        </section>
      )}

      <ol className="space-y-4">
        {findings.map((f) => {
          const clause = CLAUSES.find((c) => c.id === f.clauseId);
          const pence = amountPence(f);
          return (
            <li key={f.id} className={CARD}>
              <h2 className="font-semibold">{angleLabel(f.angle)}</h2>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {(
                  [
                    ['Pick-up', f.pickupPhotoId],
                    ['Return', f.returnPhotoId],
                  ] as const
                ).map(([label, id]) => (
                  <figure key={label} className="min-w-0">
                    <figcaption className="text-xs text-pp-muted">{label}</figcaption>
                    {id ? (
                      // eslint-disable-next-line @next/next/no-img-element -- a private photo of unknown size, not for the image optimiser
                      <img src={photo(id)} alt={`${label} photo, ${f.angle}`} className="w-full rounded" />
                    ) : (
                      <p className="rounded border border-pp-border p-4 text-center text-sm">No photo</p>
                    )}
                  </figure>
                ))}
              </div>
              <p className="mt-2">{f.description}</p>
              {clause && (
                <p className="text-sm text-pp-muted">
                  Clause {clause.id}: {clause.name}
                </p>
              )}
              <p className="mt-1">{pence > 0 ? <strong>{gbp(pence)}</strong> : 'No charge'}</p>
            </li>
          );
        })}
      </ol>

      {!settled && (
        <RenterActions
          token={token}
          hireRef={hire.hireRef}
          approvalId={contest?.status === 'open' ? null : (open?.id ?? null)}
          totalLabel={gbp(totalPence)}
          canContest={!contest}
          findings={findings.map((f) => ({ id: f.id, label: `${f.angle}: ${f.description}` }))}
        />
      )}

      <p className="text-sm text-pp-muted">{AI_NOTICE}</p>
    </main>
  );
}
