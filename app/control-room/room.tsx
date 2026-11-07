'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { Chip, staffUrl, type ChipKind } from '@/app/(lab)/chrome';
import { EvidencePair, type Box } from '@/app/(lab)/evidence';
import st from '@/app/(lab)/staff.module.css';
import w from '@/app/(lab)/wire.module.css';
import { askDesk } from './actions';

export type RoomRow = {
  ref: string;
  item: string;
  branch: string;
  chip: ChipKind;
  status: string;
  next: string;
  nextHref: string;
  needsPerson: boolean;
  settled: boolean;
  holdOpen: boolean;
  held: number;
  ageDays: number;
  evidence: { pickupId: string | null; returnId: string | null; box: Box; what: string } | null;
};
export type Kpi = { label: string; value: string; note: string; risk?: boolean };

export const VIEWS = ['Needs a person', 'All open hires', 'Holds', 'Item history'];
const inView = (r: RoomRow, view: number) => [r.needsPerson, !r.settled, r.holdOpen, r.settled][view];
const photo = (id: string) => `/api/photos/${id}`;

export function Room({ rows, kpis, ages, shops, initialView }: { rows: RoomRow[]; kpis: Kpi[]; ages: number[]; shops: string[]; initialView: number }) {
  const router = useRouter();
  const [view, setView] = useState(initialView);
  const [shop, setShop] = useState('All shops');
  const shown = rows
    .filter((r) => inView(r, view) && (shop === 'All shops' || r.branch === shop))
    .sort((a, b) => (view === 2 ? b.ageDays - a.ageDays : 0));
  const [selRef, setSelRef] = useState<string | null>(null);
  const row = shown.find((r) => r.ref === selRef) ?? shown[0] ?? null;

  const [asked, setAsked] = useState<{ q: string; a: string } | null>(null);
  const [asking, startAsk] = useTransition();
  const ask = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const q = String(new FormData(form).get('ask') ?? '').trim();
    if (!q) return;
    startAsk(async () => {
      const res = await askDesk(q).catch(() => ({ error: 'Could not reach the server' }));
      setAsked({ q, a: 'answer' in res ? res.answer : res.error });
      form.reset();
    });
  };
  const holdTotal = ages.reduce((a, b) => a + b, 0);
  const oldHolds = ages.slice(3).reduce((a, b) => a + b, 0);

  return (
    <>
      <div className={w.sHead}>
        <div>
          <h1 className={w.sH1}>Control room</h1>
          <p className={w.sSub}>
            {shop === 'All shops' ? `All ${shops.length} shops` : `Ledgerton ${shop}`} · sandbox
          </p>
        </div>
        <div className={st.headRight}>
          <select aria-label="Shop" className={w.sInput} value={shop} onChange={(e) => setShop(e.target.value)}>
            <option>All shops</option>
            {shops.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <button type="button" className={w.btnGhost} onClick={() => router.refresh()}>
            Refresh
          </button>
        </div>
      </div>

      <ul className={st.kpis}>
        {kpis.map((k) => (
          <li key={k.label} className={k.risk ? st.kpiRisk : undefined}>
            <span>{k.label}</span>
            <strong>{k.value}</strong>
            <em>{k.note}</em>
          </li>
        ))}
      </ul>

      <div className={st.crGrid}>
        <section className={w.panel} aria-labelledby="queue-title">
          <div className={w.panelHead}>
            <h2 id="queue-title" className={w.sH2}>
              Work queue
            </h2>
            <p className={w.sSub}>Click a row to see its evidence.</p>
          </div>
          <div className={st.tabs} role="group" aria-label="Views">
            {VIEWS.map((t, i) => (
              <button key={t} type="button" aria-pressed={view === i} onClick={() => setView(i)}>
                {t}
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <p className={w.sSub}>Nothing here{shop === 'All shops' ? '' : ` for ${shop}`}.</p>
          ) : (
            <div className={st.gridWrap}>
              <table className={`${st.grid} ${st.clickable}`}>
                <thead>
                  <tr>
                    <th>Hire</th>
                    <th>Look</th>
                    <th>Shop</th>
                    <th>Status</th>
                    <th>Next step</th>
                    <th className={st.right}>Held</th>
                    <th className={st.right}>Hold age</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.ref} className={r.ref === row?.ref ? st.rowSel : undefined} aria-selected={r.ref === row?.ref} onClick={() => setSelRef(r.ref)}>
                      <td>
                        <Link href={staffUrl.hire(r.ref)}>{r.ref}</Link>
                      </td>
                      <td>{r.item}</td>
                      <td>{r.branch}</td>
                      <td>
                        <Chip kind={r.chip}>{r.status}</Chip>
                      </td>
                      <td>{r.next}</td>
                      <td className={st.right}>{r.holdOpen ? `£${r.held.toFixed(2)}` : '—'}</td>
                      <td className={`${st.right} ${r.holdOpen && r.ageDays > 3 ? st.hot : ''}`}>{r.holdOpen ? `${r.ageDays}d` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h3 className={st.ageHead}>Holds by age, in days</h3>
          <div
            className={st.ageBar}
            role="img"
            aria-label={`${holdTotal} holds by age: ${holdTotal - oldHolds} are within the 3-day honour period, ${oldHolds} are older and are refreshed before any capture`}
          >
            {ages.map((n, i) => (
              <span key={i} className={i >= 3 ? st.ageRe : undefined} style={{ height: `${Math.min(100, Math.max(n, 0.15) * 24)}%` }} />
            ))}
          </div>
          <div className={st.axis}>
            <span>0</span>
            <span>3: refreshed after this</span>
            <span>29: PayPal limit</span>
          </div>
        </section>

        <aside className={st.stack}>
          {row && (
            <section className={w.panel} aria-labelledby="ev-title">
              <div className={w.panelHead}>
                <h2 id="ev-title" className={w.sH2}>
                  {row.ref}
                </h2>
                <Chip kind={row.chip}>{row.status}</Chip>
              </div>
              {row.evidence ? (
                <EvidencePair
                  pickupId={row.evidence.pickupId}
                  returnId={row.evidence.returnId}
                  box={row.evidence.box}
                  what={row.evidence.what}
                  photo={photo}
                  className={st.sPair}
                />
              ) : (
                <p className={w.sSub}>No findings yet for this hire.</p>
              )}
              <dl className={w.kv}>
                <div>
                  <dt>Look</dt>
                  <dd>{row.item}</dd>
                </div>
                <div>
                  <dt>Shop</dt>
                  <dd>{row.branch}</dd>
                </div>
                <div>
                  <dt>Still held</dt>
                  <dd>{row.holdOpen ? `£${row.held.toFixed(2)}` : '—'}</dd>
                </div>
              </dl>
              <Link href={row.nextHref} className={w.btn}>
                {row.settled ? 'Open the hire' : row.next}
              </Link>
            </section>
          )}

          <section className={w.panel} aria-labelledby="agent-title">
            <div className={w.panelHead}>
              <h2 id="agent-title" className={w.sH2}>
                Ask the desk
              </h2>
              <Chip kind="stAi">AI</Chip>
            </div>
            {asked && (
              <div className={st.transcript} aria-live="polite">
                <p className={st.agentYou}>{asked.q}</p>
                <p className={st.agentAi}>{asked.a}</p>
              </div>
            )}
            <form className={st.askForm} onSubmit={ask}>
              <label htmlFor="ask" className={w.srOnly}>
                Ask the desk
              </label>
              <input id="ask" name="ask" maxLength={300} className={w.sInput} placeholder="Ask about holds, hires or findings" />
              <button type="submit" className={w.btnGhost} disabled={asking}>
                {asking ? '…' : 'Ask'}
              </button>
            </form>
            <p className={w.sSub}>The desk can explain. It can’t approve, capture or release money.</p>
          </section>
        </aside>
      </div>
    </>
  );
}
