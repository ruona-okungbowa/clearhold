import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionButton } from '@/app/(lab)/action-button';
import { Chip, gbp, stamp, staffUrl, StaffPage, timeLabel, Who } from '@/app/(lab)/chrome';
import { EvidencePair, EvidencePhoto, type Box } from '@/app/(lab)/evidence';
import s from '@/app/(lab)/screens.module.css';
import st from '@/app/(lab)/staff.module.css';
import w from '@/app/(lab)/wire.module.css';
import { verifyApproval } from '@/lib/approval';
import { itemName } from '@/lib/catalogue';
import { db } from '@/lib/db';
import { amountPence, holdOf, londonTime, renterDeadline } from '@/lib/hold';
import { CONFIDENCE_FLOOR } from '@/lib/inspector';
import { renterLink } from '@/lib/renter-link';
import { ANGLES, CLAUSES } from '@/lib/schedule';
import { findingChip } from '@/lib/staff-view';
import { approveAction, releaseAction, settleAction } from '../actions';
import { AmountField } from './amount-field';
import { CopyLink } from './copy-link';

export const metadata: Metadata = { title: 'Approve charges' };

const order = new Map<string, number>(ANGLES.map((a, i) => [a.id, i]));
const angleName = (id: string) => ANGLES.find((a) => a.id === id)?.short ?? id;
const photo = (id: string) => `/api/photos/${id}`;
const openOf = <T extends { usedAt: Date | null; expiresAt: Date; finalCapture: boolean }>(approvals: T[]) => {
  const now = new Date();
  return approvals.find((a) => a.finalCapture && !a.usedAt && a.expiresAt > now) ?? null;
};

export default async function ApprovePage({ params }: PageProps<'/hire/[hireRef]/approve'>) {
  const { hireRef } = await params;
  const hold = await holdOf(hireRef).catch((err: Error) => (err.message.startsWith('No hold') ? notFound() : Promise.reject(err)));
  const { hire, auth, captures, remainingGBP } = hold;
  const [findings, approvals, contest] = await Promise.all([
    db.finding.findMany({ where: { hireId: hire.id } }),
    db.approval.findMany({ where: { authorizationId: auth.id }, orderBy: { createdAt: 'desc' } }),
    db.contest.findUnique({ where: { hireId: hire.id } }),
  ]);
  findings.sort((a, b) => (order.get(a.angle) ?? 9) - (order.get(b.angle) ?? 9));

  const settled = hire.status === 'settled';
  const contested = contest?.status === 'open';
  const open = settled ? null : openOf(approvals);
  const deadline = open && renterDeadline(open.createdAt);
  const signed = open && (await verifyApproval(open.token).then(() => true, () => false));
  const link = open ? `/r/${await renterLink(hireRef, open.expiresAt)}` : null;
  const finalCapture = captures.find((c) => c.finalCapture && c.authorizationId === auth.id);
  const totalPence = findings.reduce((sum, f) => sum + amountPence(f), 0);
  const total = settled ? Number(finalCapture?.amountGBP ?? 0) : totalPence / 100;
  // After settling, what was left of the hold went back; before, it is what the hold keeps minus the total.
  const release = settled ? remainingGBP : remainingGBP - total;
  const unpriced = findings.filter((f) => f.outcome === 'owner_look' && f.setGBP === null).length;
  const locked = settled || Boolean(open);
  const canRelease = !settled && !open && findings.length > 0 && totalPence === 0 && ['out', 'returned', 'contested'].includes(hire.status);

  return (
    <StaffPage current="hire">
      <div className={w.sHead}>
        <div>
          <p className={`${w.sSub} ${st.crumb}`}>
            <Link href={staffUrl.hire(hireRef)}>{hireRef}</Link> / Findings
          </p>
          <h1 className={w.sH1}>Findings for {hireRef}</h1>
          <p className={w.sSub}>
            {itemName(hire.itemRef)} · Ledgerton {hire.branch} · {gbp(remainingGBP)} {settled ? 'released' : 'still held'}
          </p>
        </div>
      </div>

      <div className={st.apprGrid}>
        <div className={st.stack}>
          {contest && (
            <section className={w.panel} aria-labelledby="contest-title">
              <div className={w.panelHead}>
                <h2 id="contest-title" className={w.sH2}>
                  {contested ? 'The renter contests these charges' : `Contest resolved by ${contest.resolvedBy}`}
                </h2>
                <Chip kind={contested ? 'stLook' : 'stOk'}>{contested ? 'Look again' : 'Resolved'}</Chip>
              </div>
              <p className={st.note}>
                {contest.findingId ? `On ${angleName(findings.find((f) => f.id === contest.findingId)?.angle ?? '')}: ` : 'On the charges as a whole: '}“{contest.note}”
              </p>
              {contest.photoId && (
                <div className={st.sPairWide}>
                  <EvidencePhoto src={photo(contest.photoId)} alt="The renter’s contest photo" />
                </div>
              )}
              {contested && <p className={w.sSub}>Lower or remove charges below, then approve (that resolves it) or release the hold. A contest can’t raise the total.</p>}
            </section>
          )}

          {findings.length === 0 ? (
            <section className={w.panel}>
              <p className={w.sSub}>
                No findings yet. Take the return photos, and the inspector runs when they’re sent.{' '}
                <Link href={staffUrl.capture(hireRef, 'return')}>Return photos</Link>
              </p>
            </section>
          ) : (
            <ol className={st.stack}>
              {findings.map((f) => {
                const clause = CLAUSES.find((c) => c.id === f.clauseId);
                const [chip, label] = findingChip(f);
                const pair = f.pickupPhotoId || f.returnPhotoId;
                const priceable = (f.outcome === 'charge' || f.outcome === 'owner_look') && clause?.chargeable;
                const cls = f.outcome === 'charge' ? st.fCharge : f.outcome === 'owner_look' ? st.fLook : '';
                return (
                  <li key={f.id} className={`${st.fCard} ${cls} ${pair ? '' : st.single} ${f.returnPhotoId && f.box ? st.zoomed : ''}`}>
                    {pair && (
                      <EvidencePair pickupId={f.pickupPhotoId} returnId={f.returnPhotoId} box={f.box as Box} what={angleName(f.angle)} photo={photo} className={st.sPair} zoom />
                    )}
                    <div className={st.fBody}>
                      <div className={st.fTop}>
                        <h2 className={w.sH2}>
                          {angleName(f.angle)} · {f.kind.replace('_', ' ')}
                        </h2>
                        <Chip kind={chip}>{label}</Chip>
                      </div>
                      <div className={st.saw}>
                        <Who ai>Inspector saw</Who>
                        <p>{f.description}</p>
                        <p className={w.sSub}>{f.reason}</p>
                      </div>
                      <p className={st.fMeta}>
                        {clause && (
                          <span>
                            Clause{' '}
                            <b>
                              {clause.id} · {clause.name.toLowerCase()}
                              {clause.chargeable && `, ${clause.lowGBP === clause.highGBP ? `£${clause.lowGBP}` : `£${clause.lowGBP}–£${clause.highGBP}`}`}
                            </b>
                          </span>
                        )}
                        <span>
                          Confidence <b>{f.confidence.toFixed(2)}</b>
                          <span className={st.conf} aria-hidden="true">
                            <span style={{ width: `${f.confidence * 100}%` }} />
                          </span>
                        </span>
                      </p>
                      {f.outcome === 'owner_look' && f.confidence < CONFIDENCE_FLOOR && <p className={w.sSub}>Below {CONFIDENCE_FLOOR}: a person decides, the AI proposes no amount</p>}
                      {f.setGBP !== null && (
                        <p className={w.sSub}>
                          AI proposed {f.proposedGBP === null ? 'no amount' : gbp(Number(f.proposedGBP))} → set to {gbp(Number(f.setGBP))} by {f.setBy ?? 'Staff'}
                          {hire.staffCode && ` (${hire.staffCode})`}
                        </p>
                      )}
                      {priceable ? (
                        <AmountField
                          hireRef={hireRef}
                          findingId={f.id}
                          charge={f.outcome === 'charge'}
                          proposed={f.proposedGBP === null ? null : Number(f.proposedGBP)}
                          set={f.setGBP === null ? null : Number(f.setGBP)}
                          band={[clause.lowGBP, clause.highGBP]}
                          locked={locked}
                        />
                      ) : (
                        <p className={w.sSub}>{f.kind === 'wear' ? 'Creases, lint and light pilling are wear. Never chargeable.' : 'Never charged.'}</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <aside className={s.sideSticky}>
          <section className={w.panel} aria-labelledby="tot">
            <h2 id="tot" className={w.sH2}>
              {settled ? 'Settled' : 'Total to approve'}
            </h2>
            <p className={st.total} aria-live="polite">
              {gbp(total)}
            </p>
            <div className={w.meter} role="img" aria-label={`${settled ? 'Captured' : 'To capture'} ${gbp(total)}, ${settled ? 'released' : 'to release'} ${gbp(release)}`}>
              {total > 0 && <span className={settled ? w.taken : w.held} style={{ flexGrow: total }} />}
              {release > 0 && <span className={w.released} style={{ flexGrow: release }} />}
            </div>
            <dl className={w.kv}>
              <div>
                <dt>{settled ? 'Captured' : 'Will capture'}</dt>
                <dd>{gbp(total)}</dd>
              </div>
              <div>
                <dt>{settled ? 'Released' : 'Will release'}</dt>
                <dd>{gbp(release)}</dd>
              </div>
            </dl>
            {!settled && unpriced > 0 && !open && (
              <p className={w.sSub}>
                {unpriced} owner-look finding{unpriced === 1 ? '' : 's'} with no amount: {unpriced === 1 ? 'it charges' : 'they charge'} nothing unless you set one.
              </p>
            )}

            {!settled && !open && totalPence > 0 && (
              <ActionButton action={approveAction.bind(null, hireRef)}>
                {contested ? 'Resolve the contest and approve' : 'Approve'} up to {gbp(total)}
              </ActionButton>
            )}
            {canRelease && <ActionButton action={releaseAction.bind(null, hireRef)}>Release {gbp(remainingGBP)}, no charge</ActionButton>}

            {open && (
              <>
                <p className={st.ok}>
                  Approved by {open.approver} at {timeLabel(open.createdAt)} · signed record, max {gbp(Number(open.maxGBP))}, expires {stamp(open.expiresAt)} ·{' '}
                  {signed ? 'signature verifies' : 'signature does not verify'}.
                </p>
                {link && <CopyLink path={link} />}
                {deadline && new Date() < deadline ? (
                  <>
                    <p className={w.sSub}>
                      The renter has until {londonTime(deadline)} to accept or contest. Staff can’t capture before then; if the renter accepts sooner, the charge is taken at that point.
                    </p>
                    <ActionButton action={settleAction.bind(null, hireRef)} disabled>
                      Capture after {londonTime(deadline)}
                    </ActionButton>
                  </>
                ) : (
                  <ActionButton action={settleAction.bind(null, hireRef)}>
                    Capture {gbp(Number(open.maxGBP))} (final) and release {gbp(remainingGBP - Number(open.maxGBP))}
                  </ActionButton>
                )}
                {link && (
                  <Link href={link} className={w.btnGhost}>
                    See what the renter sees
                  </Link>
                )}
              </>
            )}
            {settled && (
              <p className={st.ok}>
                Settled. {finalCapture ? `PayPal capture final at ${stamp(finalCapture.createdAt)}; the rest of the hold is voided.` : 'The hold was released with no charge.'}
              </p>
            )}
          </section>

          <section className={w.panel} aria-labelledby="rules-title">
            <h2 id="rules-title" className={w.sH2}>
              Rules on this page
            </h2>
            <ul className={st.rules}>
              <li>You can lower or waive an AI amount, never raise it.</li>
              <li>Owner-look findings charge nothing unless you set an amount.</li>
              <li>The total can’t pass what’s still held.</li>
              <li>Wear and known marks are never chargeable.</li>
              <li>Your approval is signed and expires in 48 hours.</li>
            </ul>
          </section>
        </aside>
      </div>
    </StaffPage>
  );
}
