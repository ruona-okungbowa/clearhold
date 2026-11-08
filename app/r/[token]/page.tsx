import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { dayLabel, gbp0, RenterPage, timeLabel, Who } from '@/app/(lab)/chrome';
import { EvidencePair, EvidencePhoto, type Box } from '@/app/(lab)/evidence';
import s from '@/app/(lab)/screens.module.css';
import w from '@/app/(lab)/wire.module.css';
import { itemName } from '@/lib/catalogue';
import { db } from '@/lib/db';
import { amountPence, holdOf } from '@/lib/hold';
import { verifyRenterLink } from '@/lib/renter-link';
import { AI_NOTICE, ANGLES, CLAUSES } from '@/lib/schedule';
import { OutcomeActions } from './outcome-actions';

export const metadata: Metadata = { title: 'Your hand-back', robots: { index: false } };

type Kind = 'taken' | 'contested' | 'held' | 'released';
const KEY: [Kind, string][] = [
  ['taken', 'Taken'],
  ['contested', 'Contested, not taken'],
  ['held', 'On hold'],
  ['released', 'Released to you'],
];
const order = new Map<string, number>(ANGLES.map((a, i) => [a.id, i]));
const angleName = (id: string) => ANGLES.find((a) => a.id === id)?.short ?? id;

function Expired() {
  return (
    <RenterPage>
      <div className={w.rWrap}>
        <div className={s.expired}>
          <h1 className={`${w.rH1} ${s.expiredH1}`}>This link has expired.</h1>
          <p className={w.rLead}>For your security, these links only last a few days. Ask the shop for a new one and we’ll send it straight over.</p>
        </div>
      </div>
    </RenterPage>
  );
}

// The renter's view of a returned hire, read through the signed link in the URL: the same photos staff saw, each
// charge and its clause, the money, and Accept or one Contest. No staff controls.
export default async function YourReturnPage({ params }: PageProps<'/r/[token]'>) {
  const { token } = await params;
  const hireRef = await verifyRenterLink(token).catch(() => null);
  if (!hireRef) return <Expired />;

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

  const total = findings.reduce((sum, f) => sum + amountPence(f), 0) / 100;
  const left = remainingGBP;
  const taken = Number(captures.find((c) => c.finalCapture && c.authorizationId === auth.id)?.amountGBP ?? 0);
  const state =
    hire.status === 'settled' ? (taken > 0 ? 'settled' : 'clean') : contest?.status === 'open' ? 'contested' : open ? 'review' : 'checking';
  const photo = (id: string) => `/api/photos/${id}?t=${encodeURIComponent(token)}`;
  const charged = findings.filter((f) => amountPence(f) > 0);
  const deposit = Number(hire.depositGBP);

  const head: Record<typeof state, [string, string]> = {
    checking: [
      'We’re checking it over.',
      'Your hand-back photos are in. We compare them with your pick-up photos, and a person signs off. You’ll hear from us, usually today.',
    ],
    review: [
      charged.length === 1 ? 'One thing needs fixing.' : `${charged.length} things need fixing.`,
      `Everything else is fine${findings.some((f) => f.kind === 'wear' || f.kind === 'known_mark') ? ', including wear and any old marks, which aren’t yours' : ''}.`,
    ],
    contested: [
      'Thanks. We’re looking again.',
      'Someone at the shop will look at your note and photo. They can keep, lower or remove the charge, never raise it. Nothing is taken while they look.',
    ],
    settled: ['All settled.', `${gbp0(taken)} was taken, and ${gbp0(left)} of your deposit has been released.`],
    clean: ['All clear. Thanks.', `Nothing to pay. Your ${gbp0(deposit)} deposit has been released, and creases are on us.`],
  };

  const money: Record<typeof state, { kicker: string; big: number; line?: ReactNode; parts: Partial<Record<Kind, number>> }> = {
    checking: { kicker: 'Your deposit', big: left, line: 'Still on hold while we check. Nothing has been taken.', parts: { held: left } },
    clean: { kicker: 'Released back to you', big: left, parts: { released: left } },
    review: { kicker: 'To pay', big: total, line: <>Comes back to you: <strong>{gbp0(left - total)}</strong></>, parts: { held: left } },
    contested: { kicker: 'To pay', big: total, line: <>Comes back to you: <strong>{gbp0(left - total)}</strong></>, parts: { contested: total, held: left - total } },
    settled: { kicker: 'Taken', big: taken, line: <>Released: <strong>{gbp0(left)}</strong></>, parts: { taken, released: left } },
  };
  const m = money[state];
  const parts = KEY.filter(([k]) => (m.parts[k] ?? 0) > 0).map(([k, label]) => ({ k, label, gbp: m.parts[k]! }));
  const meterTotal = parts.reduce((sum, p) => sum + p.gbp, 0);
  const replyBy = open && new Date(open.expiresAt.getTime() - 3_600_000);

  return (
    <RenterPage>
      <div className={w.rWrap}>
        <div className={s.outcome}>
          <div className={s.outMain}>
            <header className={s.outHead}>
              <p className={w.kicker}>
                {hire.hireRef} · {itemName(hire.itemRef)}
                {hire.returnedAt && ` · handed back ${dayLabel(hire.returnedAt)}`}
              </p>
              <h1 className={`${w.rH1} ${s.outH1}`}>{head[state][0]}</h1>
              <p className={w.rLead}>{head[state][1]}</p>
            </header>

            {state !== 'checking' && findings.length > 0 && (
              <ol className={s.findList}>
                {findings.map((f) => {
                  const amount = amountPence(f) / 100;
                  const clause = CLAUSES.find((c) => c.id === f.clauseId);
                  return (
                    <li key={f.id} className={s.finding}>
                      <div className={s.findHead}>
                        <h2 className={w.rH3}>
                          {angleName(f.angle)}: {f.description}
                        </h2>
                        {amount > 0 ? (
                          <p className={s.findAmt}>{gbp0(amount)}</p>
                        ) : (
                          <p className={s.findFree}>{f.kind === 'known_mark' ? 'Not yours' : 'No charge'}</p>
                        )}
                      </div>
                      {(f.pickupPhotoId || f.returnPhotoId) && (
                        <EvidencePair
                          pickupId={f.pickupPhotoId}
                          returnId={f.returnPhotoId}
                          box={f.box as Box}
                          what={angleName(f.angle)}
                          photo={photo}
                          captions={[`Pick-up, ${dayLabel(hire.startAt)}`, `Hand-back${hire.returnedAt ? `, ${dayLabel(hire.returnedAt)}` : ''}`]}
                          zoom
                        />
                      )}
                      {clause?.chargeable && amount > 0 && (
                        <p className={s.clause}>
                          Price list: {clause.name.toLowerCase()}, {clause.lowGBP === clause.highGBP ? gbp0(clause.lowGBP) : `${gbp0(clause.lowGBP)} to ${gbp0(clause.highGBP)}`}.
                        </p>
                      )}
                      {amount > 0 && (
                        <ul className={s.trailList}>
                          {f.proposedGBP !== null && (
                            <li>
                              <Who ai>Spotted</Who> in your hand-back photos: <strong>{gbp0(Number(f.proposedGBP))}</strong>
                            </li>
                          )}
                          <li>
                            <Who>Checked</Who> by {f.setBy ?? open?.approver ?? 'staff'} at Ledgerton {hire.branch}: <strong>{gbp0(amount)}</strong>
                          </li>
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}

            {contest && (
              <section className={w.card} aria-labelledby="your-contest">
                <h2 id="your-contest" className={w.rH3}>
                  Your contest {contest.status === 'open' ? '' : `· resolved by ${contest.resolvedBy}`}
                </h2>
                <blockquote className={s.quote}>“{contest.note}”</blockquote>
                {contest.photoId && <EvidencePhoto src={photo(contest.photoId)} alt="Your contest photo" />}
                <p className={w.small}>
                  {contest.photoId ? 'One photo attached · ' : ''}sent {dayLabel(contest.createdAt)}, {timeLabel(contest.createdAt)}
                </p>
              </section>
            )}
          </div>

          <aside className={s.sideSticky} aria-label="Your deposit">
            <div className={w.card}>
              <p className={w.kicker}>{m.kicker}</p>
              <p className={s.bigNum}>{gbp0(m.big)}</p>
              {m.line && <p>{m.line}</p>}
              {parts.length > 0 && (
                <>
                  <div className={w.meter} role="img" aria-label={`${parts.map((p) => `${p.label} ${gbp0(p.gbp)}`).join(', ')} of ${gbp0(meterTotal)}`}>
                    {parts.map((p) => (
                      <span key={p.k} className={w[p.k]} style={{ flexGrow: p.gbp }} />
                    ))}
                  </div>
                  <ul className={w.meterKey}>
                    {parts.map((p) => (
                      <li key={p.k}>
                        <span className={`${w.sw} ${w[p.k]}`} />
                        {p.label}
                        <strong>{gbp0(p.gbp)}</strong>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {state === 'review' && open && replyBy && (
                <OutcomeActions
                  token={token}
                  hireRef={hire.hireRef}
                  approvalId={open.id}
                  total={gbp0(total)}
                  replyBy={`${dayLabel(replyBy)}, ${timeLabel(replyBy)}`}
                  canContest={!contest}
                  findings={charged.map((f) => ({ id: f.id, label: `${angleName(f.angle)}: ${f.description}, ${gbp0(amountPence(f) / 100)}` }))}
                />
              )}
              {state === 'contested' && <p className={w.small}>We’ll reply within two days. Once we have, you’ll see the result here.</p>}
              {state === 'settled' && <p className={w.small}>Released money can take up to 5 working days to show in PayPal.</p>}
            </div>
            <p className={s.notice}>{AI_NOTICE}</p>
          </aside>
        </div>
      </div>
    </RenterPage>
  );
}
