// Staff: every case to answer. A contested hire, or a PayPal sandbox dispute matched to a hire through the capture id
// PayPal names as seller_transaction_id; a dispute on a capture we don't have is listed as "not ours".

import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { db } from '@/lib/db';
import { getDispute, listDisputes, type DisputeDetails } from '@/lib/paypal';
import { CasesGrid, type CaseRow } from './cases-grid';

export const metadata: Metadata = { title: 'Disputes' };

const DAY = 86_400_000;

async function loadCases() {
  const disputes: DisputeDetails[] | null = await listDisputes()
    .then((list) => Promise.all(list.map((d) => getDispute(d.dispute_id))))
    .catch((err) => {
      console.error('[disputes] PayPal unreachable', err);
      return null;
    });

  const txnIds = (disputes ?? []).flatMap((d) => d.disputed_transactions?.flatMap((t) => t.seller_transaction_id ?? []) ?? []);
  const disputed = await db.capture.findMany({ where: { id: { in: txnIds } }, select: { id: true, authorizationId: true } });
  const hires = await db.hire.findMany({
    where: { OR: [{ contest: { isNot: null } }, { authorizations: { some: { id: { in: disputed.map((c) => c.authorizationId) } } } }] },
    select: { hireRef: true, branch: true, contest: { select: { status: true } }, authorizations: { select: { id: true } } },
  });
  const hireOfAuth = new Map(hires.flatMap((h) => h.authorizations.map((a) => [a.id, h])));
  const captures = await db.capture.findMany({ where: { authorizationId: { in: [...hireOfAuth.keys()] } }, select: { authorizationId: true, amountGBP: true } });
  const chargedPence = new Map<string, number>();
  for (const c of captures) {
    const ref = hireOfAuth.get(c.authorizationId)!.hireRef;
    chargedPence.set(ref, (chargedPence.get(ref) ?? 0) + Math.round(Number(c.amountGBP) * 100));
  }
  const hireOfCapture = new Map(disputed.map((c) => [c.id, hireOfAuth.get(c.authorizationId)!]));

  const hireCols = (h: (typeof hires)[number] | undefined) => ({
    hireRef: h?.hireRef ?? null,
    branch: h?.branch ?? null,
    chargedGBP: h ? (chargedPence.get(h.hireRef) ?? 0) / 100 : null,
    contestStatus: h?.contest?.status ?? null,
  });
  const disputeRows: CaseRow[] = (disputes ?? []).map((d) => {
    const hire = d.disputed_transactions?.map((t) => hireOfCapture.get(t.seller_transaction_id ?? '')).find(Boolean);
    const due = d.seller_response_due_date && Date.parse(d.seller_response_due_date);
    return {
      ...hireCols(hire),
      disputeId: d.dispute_id,
      disputeStatus: d.status ?? null,
      reason: d.reason ?? null,
      daysLeft: due ? Math.ceil((due - Date.now()) / DAY) : null,
    };
  });
  const inDispute = new Set(disputeRows.map((r) => r.hireRef));
  const contestRows: CaseRow[] = hires
    .filter((h) => h.contest && !inDispute.has(h.hireRef))
    .map((h) => ({ ...hireCols(h), disputeId: null, disputeStatus: null, reason: null, daysLeft: null }));
  return { paypalDown: disputes === null, rows: [...disputeRows, ...contestRows] };
}

export default async function DisputesPage() {
  await connection();
  const { paypalDown, rows } = await loadCases();
  return (
    <main className="flex h-dvh flex-col gap-2 p-4">
      <header className="flex items-center gap-4">
        <h1 className="font-semibold">Disputes</h1>
        <Link href="/control-room" className="text-sm underline">
          Control room
        </Link>
      </header>
      {paypalDown && (
        <p role="alert" className="text-sm">
          PayPal disputes unavailable: showing contested hires only.
        </p>
      )}
      <div className="min-h-0 flex-1">
        <CasesGrid rows={rows} />
      </div>
    </main>
  );
}
