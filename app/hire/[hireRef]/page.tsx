import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionButton } from '@/app/(lab)/action-button';
import { Chip, dayLabel, gbp, stamp, staffUrl, Who } from '@/app/(lab)/chrome';
import { StaffPage } from '@/app/(lab)/staff-page';
import s from '@/app/(lab)/screens.module.css';
import st from '@/app/(lab)/staff.module.css';
import w from '@/app/(lab)/wire.module.css';
import { itemName } from '@/lib/catalogue';
import { db } from '@/lib/db';
import { amountPence, holdOf } from '@/lib/hold';
import { ANGLES } from '@/lib/schedule';
import { findingChip, stepOf } from '@/lib/staff-view';
import { releaseAction, runInspectorAction } from './actions';

export const metadata: Metadata = { title: 'Hire' };

const angleName = (id: string) => ANGLES.find((a) => a.id === id)?.short ?? id;
// The final approval settleHold would use: unused and unexpired.
const openOf = <T extends { usedAt: Date | null; expiresAt: Date }>(approvals: T[]) => {
  const now = new Date();
  return approvals.find((a) => !a.usedAt && a.expiresAt > now) ?? null;
};

function Six({ photos, stage, flagged }: { photos: { id: string; angle: string; stage: string }[]; stage: string; flagged: Set<string> }) {
  return (
    <ul className={st.six}>
      {ANGLES.map((a) => {
        const p = photos.find((x) => x.stage === stage && x.angle === a.id);
        return (
          <li key={a.id}>
            <div className={st.sixPic}>
              {p ? (
                // eslint-disable-next-line @next/next/no-img-element -- a private photo of unknown size, not for the image optimiser
                <img src={`/api/photos/${p.id}`} alt={`${stage === 'pickup' ? 'Pick-up' : 'Return'}: ${a.short}`} loading="lazy" className={s.vfPhoto} />
              ) : (
                'Not taken'
              )}
              {flagged.has(a.id) && <span className={st.sixFlag} title="Has a finding" />}
            </div>
            {a.short}
          </li>
        );
      })}
    </ul>
  );
}

export default async function HirePage({ params }: PageProps<'/hire/[hireRef]'>) {
  const { hireRef } = await params;
  const hold = await holdOf(hireRef).catch((err: Error) => (err.message.startsWith('No hold') ? notFound() : Promise.reject(err)));
  const { hire, auth, captures, capturedGBP, remainingGBP, heldAtBookingGBP } = hold;
  const [photos, findings, events, marks, itemHires, approvals] = await Promise.all([
    db.photo.findMany({ where: { hireId: hire.id, stage: { in: ['pickup', 'return'] } }, select: { id: true, angle: true, stage: true, serverAt: true } }),
    db.finding.findMany({ where: { hireId: hire.id }, orderBy: { createdAt: 'asc' } }),
    db.auditEvent.findMany({ where: { hireRef }, orderBy: { at: 'asc' } }),
    db.itemMark.findMany({ where: { itemRef: hire.itemRef }, orderBy: { createdAt: 'asc' } }),
    db.hire.count({ where: { itemRef: hire.itemRef } }),
    db.approval.findMany({ where: { authorizationId: auth.id, finalCapture: true }, orderBy: { createdAt: 'desc' } }),
  ]);
  const open = openOf(approvals);
  const step = stepOf(hire, findings, open);
  const count = (stage: string) => photos.filter((p) => p.stage === stage).length;
  const lastAt = (stage: string) => photos.filter((p) => p.stage === stage).reduce<Date | null>((m, p) => (!m || p.serverAt > m ? p.serverAt : m), null);
  const flagged = new Set(findings.filter((f) => f.outcome !== 'no_charge').map((f) => f.angle));
  const total = findings.reduce((sum, f) => sum + amountPence(f), 0);
  const settled = hire.status === 'settled';
  const feeCapture = captures.find((c) => !c.finalCapture);
  const pickupAt = lastAt('pickup');
  const returnAt = lastAt('return');

  const steps: [string, string | null][] = [
    ['Booked', auth.createdAt && dayLabel(hire.authorizations.at(-1)!.createdAt)],
    ['Handed over', feeCapture ? dayLabel(feeCapture.createdAt) : null],
    ['Returned', hire.returnedAt && dayLabel(hire.returnedAt)],
    ['Inspected', findings[0] ? stamp(findings[0].createdAt) : null],
    ['Approved', approvals[0] ? stamp(approvals[0].createdAt) : null],
    ['Settled', settled ? 'done' : null],
  ];
  const nowStep = steps.findIndex(([, when]) => !when);
  const canRelease = !settled && findings.length > 0 && total === 0 && ['out', 'returned', 'contested'].includes(hire.status);

  return (
    <StaffPage current="hire">
      <div className={w.sHead}>
        <div>
          <p className={`${w.sSub} ${st.crumb}`}>
            <Link href={staffUrl.controlRoom}>Control room</Link> / <Link href={staffUrl.openHires}>Hires</Link>
          </p>
          <h1 className={w.sH1}>
            {hire.hireRef} · {itemName(hire.itemRef)}
          </h1>
          <p className={w.sSub}>
            Ledgerton {hire.branch} · out {dayLabel(hire.startAt)}, back {dayLabel(hire.dueBackAt)} · <Chip kind={step.chip}>{step.status}</Chip>
          </p>
        </div>
        {findings.length > 0 && (
          <Link href={staffUrl.approve(hireRef)} className={w.btn}>
            Review {findings.length} finding{findings.length === 1 ? '' : 's'}
          </Link>
        )}
      </div>

      <ol className={st.stepper} aria-label="Hire progress">
        {steps.map(([title, when], i) => (
          <li key={title} className={when ? st.stepDone : i === nowStep ? st.stepNow : undefined} aria-current={i === nowStep ? 'step' : undefined}>
            <strong>{title}</strong>
            {when ?? (i === nowStep ? 'next' : '')}
          </li>
        ))}
      </ol>

      <div className={st.hireGrid}>
        <div className={st.stack}>
          <section className={w.panel} aria-labelledby="pickup-title">
            <div className={w.panelHead}>
              <h2 id="pickup-title" className={w.sH2}>
                Pick-up{pickupAt && ` · ${stamp(pickupAt)}`}
              </h2>
              <Chip kind={count('pickup') === 6 ? 'stOk' : 'stPlain'}>{count('pickup')} of 6</Chip>
            </div>
            <Six photos={photos} stage="pickup" flagged={new Set()} />
            {feeCapture ? (
              <p className={w.sSub}>
                Handed over. The {gbp(Number(feeCapture.amountGBP))} fee was taken; the deposit stays held.
              </p>
            ) : (
              <div className={st.btnRow}>
                <Link href={staffUrl.capture(hireRef, 'pickup')} className={w.btn}>
                  Take pick-up photos and hand over
                </Link>
              </div>
            )}
          </section>

          <section className={w.panel} aria-labelledby="return-title">
            <div className={w.panelHead}>
              <h2 id="return-title" className={w.sH2}>
                Return{returnAt && ` · ${stamp(returnAt)}`}
              </h2>
              <Chip kind={count('return') === 6 ? 'stOk' : 'stPlain'}>{count('return')} of 6</Chip>
            </div>
            <Six photos={photos} stage="return" flagged={flagged} />
            {!settled && hire.status !== 'booked' && (
              <div className={st.btnRow}>
                <Link href={staffUrl.capture(hireRef, 'return')} className={w.btnGhost}>
                  {count('return') ? 'Retake return photos' : 'Take return photos'}
                </Link>
                {hire.status === 'returned' && count('return') === 6 && (
                  <ActionButton ghost action={runInspectorAction.bind(null, hireRef)} pending="Inspecting… (up to a minute)">
                    Run the inspector again
                  </ActionButton>
                )}
              </div>
            )}
          </section>

          {findings.length > 0 && (
            <section className={w.panel} aria-labelledby="insp-title">
              <div className={w.panelHead}>
                <h2 id="insp-title" className={w.sH2}>
                  Inspector
                </h2>
                <Who ai>AI · {stamp(findings[0].createdAt)}</Who>
              </div>
              <div className={st.gridWrap}>
                <table className={st.grid}>
                  <thead>
                    <tr>
                      <th>Angle</th>
                      <th>Finding</th>
                      <th>Outcome</th>
                      <th className={st.right}>Proposed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {findings.map((f) => {
                      const [chip, label] = findingChip(f);
                      return (
                        <tr key={f.id}>
                          <td>{angleName(f.angle)}</td>
                          <td>
                            {f.description}
                            {f.outcome === 'owner_look' && `, confidence ${f.confidence.toFixed(2)}`}
                          </td>
                          <td>
                            <Chip kind={chip}>{label}</Chip>
                          </td>
                          <td className={st.right}>{f.proposedGBP === null ? '—' : gbp(Number(f.proposedGBP))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>

        <div className={st.stack}>
          <section className={w.panel} aria-labelledby="hold-title">
            <div className={w.panelHead}>
              <h2 id="hold-title" className={w.sH2}>
                PayPal hold
              </h2>
              <Chip kind="stPlain">{auth.status.replace('_', ' ').toLowerCase()}</Chip>
            </div>
            <div className={w.meter} role="img" aria-label={`Captured ${gbp(capturedGBP)}, ${settled ? 'released' : 'still held'} ${gbp(remainingGBP)} of ${gbp(heldAtBookingGBP)}`}>
              {capturedGBP > 0 && <span className={w.taken} style={{ flexGrow: capturedGBP }} />}
              {remainingGBP > 0 && <span className={settled ? w.released : w.held} style={{ flexGrow: remainingGBP }} />}
            </div>
            <dl className={w.kv}>
              {[
                ['Held at booking', gbp(heldAtBookingGBP)],
                ['Captured', gbp(capturedGBP)],
                [settled ? 'Released' : 'Still held', gbp(remainingGBP)],
                ['Honour period ends', stamp(auth.honourEndsAt)],
                ['Expires', dayLabel(auth.expiresAt)],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
              <div>
                <dt>Authorization</dt>
                <dd className={w.mono}>{auth.id}</dd>
              </div>
            </dl>
            {canRelease && (
              <ActionButton ghost action={releaseAction.bind(null, hireRef)}>
                Release {gbp(remainingGBP)}, no charge
              </ActionButton>
            )}
          </section>

          <section className={w.panel} aria-labelledby="item-title">
            <h2 id="item-title" className={w.sH2}>
              This garment’s history
            </h2>
            <dl className={w.kv}>
              {[
                ['Item', hire.itemRef],
                ['Hires', String(itemHires)],
                ['Known marks', String(marks.length)],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            {marks.map((m) => (
              <p key={m.id} className={st.note}>
                {m.description}. First seen on {m.firstSeen}, never charged again.
              </p>
            ))}
          </section>
        </div>

        <section className={`${w.panel} ${st.full}`} aria-labelledby="audit-title">
          <div className={w.panelHead}>
            <h2 id="audit-title" className={w.sH2}>
              Audit trail
            </h2>
            <p className={w.sSub}>Every money call and model call, in order.</p>
          </div>
          {events.length === 0 ? (
            <p className={w.sSub}>Nothing recorded yet.</p>
          ) : (
            <div className={st.gridWrap}>
              <table className={st.grid}>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Who</th>
                    <th>What</th>
                    <th>Detail</th>
                    <th>PayPal debug id</th>
                    <th>Model</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id}>
                      <td className={w.num}>{stamp(e.at)}</td>
                      <td>{e.actor === 'ai' ? <Who ai>Inspector</Who> : e.actor}</td>
                      <td>{e.type}</td>
                      <td>{e.summary}</td>
                      <td className={w.mono}>{e.paypalDebugId ?? '—'}</td>
                      <td>{e.model ? `${e.model}${e.latencyMs ? ` · ${(e.latencyMs / 1000).toFixed(0)}s` : ''}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </StaffPage>
  );
}
