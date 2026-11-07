// Staff: every case to answer. A renter's contest, or a PayPal sandbox dispute matched to a hire through the capture id
// PayPal names as seller_transaction_id; a dispute on a capture we don't have is listed as "not ours".

import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Chip, staffUrl, StaffPage, type ChipKind } from '@/app/(lab)/chrome';
import st from '@/app/(lab)/staff.module.css';
import w from '@/app/(lab)/wire.module.css';
import { db } from '@/lib/db';
import { getDispute, listDisputes, type DisputeDetails } from '@/lib/paypal';

export const metadata: Metadata = { title: 'Disputes' };

const DAY = 86_400_000;
const OPEN_DISPUTE = new Set(['OPEN', 'WAITING_FOR_SELLER_RESPONSE', 'WAITING_FOR_BUYER_RESPONSE', 'UNDER_REVIEW']);

type Case = { hireRef: string | null; type: string; reason: string; charged: number | null; daysLeft: number | null; chip: ChipKind; status: string; open: boolean };

const sentence = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replaceAll('_', ' ');

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
    select: { hireRef: true, contest: { select: { status: true, note: true } }, authorizations: { select: { id: true } } },
  });
  const hireOfAuth = new Map(hires.flatMap((h) => h.authorizations.map((a) => [a.id, h])));
  const captures = await db.capture.findMany({ where: { authorizationId: { in: [...hireOfAuth.keys()] }, finalCapture: true }, select: { authorizationId: true, amountGBP: true } });
  const charged = new Map<string, number>();
  for (const c of captures) {
    const ref = hireOfAuth.get(c.authorizationId)!.hireRef;
    charged.set(ref, (charged.get(ref) ?? 0) + Number(c.amountGBP));
  }
  const hireOfCapture = new Map(disputed.map((c) => [c.id, hireOfAuth.get(c.authorizationId)!]));

  const disputeCases: Case[] = (disputes ?? []).map((d) => {
    const hire = d.disputed_transactions?.map((t) => hireOfCapture.get(t.seller_transaction_id ?? '')).find(Boolean);
    const due = d.seller_response_due_date ? Date.parse(d.seller_response_due_date) : null;
    const open = OPEN_DISPUTE.has(d.status ?? '');
    return {
      hireRef: hire?.hireRef ?? null,
      type: 'PayPal dispute',
      reason: hire ? sentence(d.reason ?? 'No reason given') : 'Not one of ours (no matching capture)',
      charged: hire ? (charged.get(hire.hireRef) ?? 0) : null,
      daysLeft: due && open ? Math.ceil((due - Date.now()) / DAY) : null,
      chip: !hire ? 'stPlain' : open ? 'stLook' : 'stOk',
      status: !hire ? 'Not ours' : sentence(d.status ?? 'open'),
      open: Boolean(hire) && open,
    };
  });
  const inDispute = new Set(disputeCases.map((c) => c.hireRef));
  const contestCases: Case[] = hires
    .filter((h) => h.contest && !inDispute.has(h.hireRef))
    .map((h) => {
      const open = h.contest!.status === 'open';
      return {
        hireRef: h.hireRef,
        type: 'Renter contest',
        reason: h.contest!.note.length > 80 ? `${h.contest!.note.slice(0, 80)}…` : h.contest!.note,
        charged: charged.get(h.hireRef) ?? 0,
        daysLeft: null,
        chip: open ? 'stLook' : 'stOk',
        status: open ? 'Look again' : 'Resolved',
        open,
      };
    });
  const cases = [...disputeCases, ...contestCases].sort((a, b) => Number(b.open) - Number(a.open) || (a.daysLeft ?? 99) - (b.daysLeft ?? 99));
  return { paypalDown: disputes === null, cases };
}

export default async function DisputesPage({ searchParams }: PageProps<'/disputes'>) {
  await connection();
  const { show } = await searchParams;
  const all = show === 'all';
  const { paypalDown, cases } = await loadCases();
  const open = cases.filter((c) => c.open);
  const due = open.filter((c) => c.daysLeft !== null && c.daysLeft <= 3);
  const closed = cases.filter((c) => !c.open && c.hireRef);
  const shown = all ? cases : open;

  return (
    <StaffPage current="disputes">
      <div className={w.sHead}>
        <div>
          <h1 className={w.sH1}>Disputes</h1>
          <p className={w.sSub}>Sorted by response deadline. Anything answered here is sent by a person.</p>
        </div>
        <nav className={st.btnRow} aria-label="Show">
          <Link href="/disputes" className={all ? w.btnGhost : w.btn} aria-current={all ? undefined : 'page'}>
            Open cases
          </Link>
          <Link href="/disputes?show=all" className={all ? w.btn : w.btnGhost} aria-current={all ? 'page' : undefined}>
            All cases
          </Link>
        </nav>
      </div>

      {paypalDown && (
        <p role="alert" className={w.sErr}>
          PayPal disputes are unavailable just now: showing renter contests only.
        </p>
      )}

      <ul className={`${st.kpis} ${st.kpis4}`}>
        <li>
          <span>Open</span>
          <strong>{open.length}</strong>
          <em>
            {open.filter((c) => c.type === 'Renter contest').length} contests, {open.filter((c) => c.type === 'PayPal dispute').length} PayPal
          </em>
        </li>
        <li className={due.length ? st.kpiRisk : undefined}>
          <span>Due within 3 days</span>
          <strong>{due.length}</strong>
          <em>{due.length ? due.map((c) => c.hireRef).join(', ') : 'none'}</em>
        </li>
        <li>
          <span>Amount in dispute</span>
          <strong>£{open.reduce((sum, c) => sum + (c.charged ?? 0), 0).toFixed(0)}</strong>
          <em>charged on open cases</em>
        </li>
        <li>
          <span>Resolved</span>
          <strong>
            {closed.length} of {cases.filter((c) => c.hireRef).length}
          </strong>
          <em>all time</em>
        </li>
      </ul>

      <section className={w.panel} aria-labelledby="cases-title">
        <h2 id="cases-title" className={w.sH2}>
          Cases
        </h2>
        {shown.length === 0 ? (
          <p className={w.sSub}>{all ? 'No cases yet.' : 'No open cases.'}</p>
        ) : (
          <div className={st.gridWrap}>
            <table className={st.grid}>
              <thead>
                <tr>
                  <th>Hire</th>
                  <th>Type</th>
                  <th>Reason</th>
                  <th className={st.right}>Charged</th>
                  <th className={st.right}>Days to respond</th>
                  <th>Status</th>
                  <th>
                    <span className={w.srOnly}>Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c, i) => (
                  <tr key={`${c.hireRef}-${c.type}-${i}`}>
                    <td>{c.hireRef ?? '—'}</td>
                    <td>{c.type}</td>
                    <td>{c.reason}</td>
                    <td className={st.right}>{c.charged === null ? '—' : `£${c.charged.toFixed(2)}`}</td>
                    <td className={`${st.right} ${c.daysLeft !== null && c.daysLeft <= 3 ? st.hot : ''}`}>{c.daysLeft ?? '—'}</td>
                    <td>
                      <Chip kind={c.chip}>{c.status}</Chip>
                    </td>
                    <td>{c.hireRef && <Link href={staffUrl.dispute(c.hireRef)}>Open</Link>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </StaffPage>
  );
}
