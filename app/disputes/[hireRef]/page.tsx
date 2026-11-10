import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Chip, gbp, stamp, staffUrl, StaffPage } from '@/app/(lab)/chrome';
import { EvidencePair, EvidencePhoto } from '@/app/(lab)/evidence';
import s from '@/app/(lab)/screens.module.css';
import st from '@/app/(lab)/staff.module.css';
import w from '@/app/(lab)/wire.module.css';
import { itemName } from '@/lib/catalogue';
import { db } from '@/lib/db';
import { disputesFor, MAX_FILES } from '@/lib/disputes';
import { buildEvidencePack } from '@/lib/evidence-pack';
import { ANGLES } from '@/lib/schedule';
import { acceptClaimAndRefund, draftDisputeResponse, previewEvidence, refreshFromPayPal, sendEvidenceToPayPal } from './actions';
import { DraftPanel, type EvidenceTarget } from './draft-panel';
import { AcceptClaim, RefreshFromPayPal } from './paypal-buttons';

export const metadata: Metadata = { title: 'Dispute evidence' };

const angleName = (id: string) => ANGLES.find((a) => a.id === id)?.short ?? id;
const photo = (id: string) => `/api/photos/${id}`;
const short = (sha: string) => `${sha.slice(0, 4)}…${sha.slice(-4)}`;
const sentence = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replaceAll('_', ' ');
const RESPONSE_CHIP = { sent: 'stHuman', sending: 'stLook', failed: 'stPlain' } as const;
const RESPONSE_LABEL = { sent: 'Sent', sending: 'Outcome unknown', failed: 'Refused by PayPal' } as const;

export default async function DisputePage({ params }: PageProps<'/disputes/[hireRef]'>) {
  const { hireRef } = await params;
  const pack = await buildEvidencePack(hireRef).catch((err: Error) => (err.message.startsWith('No hold') ? notFound() : Promise.reject(err)));
  const { hire, findings, clauses, approvals, captures, contest } = pack;
  const clause = new Map(clauses.map((c) => [c.id, c]));
  const shotOf = new Map(pack.photos.map((p) => [p.id, p]));
  const charged = findings.filter((f) => (f.setGBP ?? f.proposedGBP ?? 0) > 0);
  const finalCapture = captures.find((c) => c.final);
  const approval = approvals.at(-1);
  const [disputes, responses, hireRow, photoTypes] = await Promise.all([
    disputesFor(hire.ref),
    db.disputeResponse.findMany({ where: { hireRef: hire.ref }, orderBy: { sentAt: 'desc' } }),
    db.hire.findUniqueOrThrow({ where: { hireRef: hire.ref }, select: { refundedViaDisputeAt: true } }),
    db.photo.findMany({ where: { id: { in: pack.photos.map((p) => p.id) } }, select: { id: true, contentType: true } }),
  ]);
  const jpeg = new Set(photoTypes.filter((p) => p.contentType === 'image/jpeg').map((p) => p.id));
  const paired = new Set(charged.flatMap((f) => [f.pickupPhotoId, f.returnPhotoId].filter((id): id is string => Boolean(id))));
  const pickPhotos = pack.photos
    .filter((p) => p.stage === 'pickup' || p.stage === 'return')
    .map((p) => ({ id: p.id, label: `${p.stage === 'pickup' ? 'Pick-up' : 'Return'} · ${angleName(p.angle).toLowerCase()}${p.sample ? ' · sample' : ''}`, preselected: paired.has(p.id), jpeg: jpeg.has(p.id) }));
  const answerable = disputes.find((d) => d.evidence.open);
  const target: EvidenceTarget = answerable
    ? { disputeId: answerable.id }
    : { why: disputes.length ? (disputes[0].evidence as { why: string }).why : 'no PayPal dispute is matched to this hire' };

  return (
    <StaffPage current="disputes">
      <div className={w.sHead}>
        <div>
          <p className={`${w.sSub} ${st.crumb}`}>
            <Link href={staffUrl.disputes}>Disputes</Link> / {hire.ref}
          </p>
          <h1 className={w.sH1}>Evidence pack · {hire.ref}</h1>
          <p className={w.sSub}>
            {itemName(hire.itemRef)} · Ledgerton {hire.branch}
            {finalCapture && ` · ${gbp(finalCapture.amountGBP)} charged`}
            {contest && ` · contest ${contest.status}`}
            {hireRow.refundedViaDisputeAt && ` · refunded via dispute ${stamp(hireRow.refundedViaDisputeAt)}`}
          </p>
        </div>
        <a
          href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(pack, null, 2))}`}
          download={`evidence-pack-${hire.ref}.json`}
          className={w.btnGhost}
        >
          Download pack (JSON)
        </a>
      </div>

      <div className={st.apprGrid}>
        <div className={st.stack}>
          <section className={w.panel} aria-labelledby="pp-title">
            <div className={w.panelHead}>
              <h2 id="pp-title" className={w.sH2}>
                PayPal dispute
              </h2>
              <RefreshFromPayPal refresh={refreshFromPayPal} />
            </div>
            {disputes.length === 0 && <p className={w.sSub}>No PayPal dispute is matched to this hire’s captures. Refresh from PayPal to look again.</p>}
            {disputes.map((d) => (
              <div key={d.id} className={st.stack}>
                <dl className={w.kv}>
                  {[
                    ['Dispute', d.id],
                    ['PayPal status', `${sentence(d.status)}${d.live ? '' : ' (last known: PayPal unreachable)'}`],
                    ['Reason', d.reason ? sentence(d.reason) : '—'],
                    ['Disputed (PayPal)', d.amountGBP ? `£${d.amountGBP}` : '—'],
                    ['Our capture', `${d.captureId} · £${d.capturedGBP}`],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
                {d.amountGBP && (
                  <AcceptClaim
                    amountGBP={d.amountGBP}
                    capturedGBP={d.capturedGBP}
                    captureId={d.captureId}
                    why={d.accept.open ? null : d.accept.why}
                    accept={acceptClaimAndRefund.bind(null, hire.ref, d.id)}
                  />
                )}
              </div>
            ))}
            {responses.length > 0 && (
              <>
                <h3 className={w.sH2}>Our responses</h3>
                <ol className={st.tl}>
                  {responses.map((r) => (
                    <li key={r.id}>
                      <time dateTime={r.sentAt.toISOString()}>{stamp(r.sentAt)}</time>
                      <span>
                        <Chip kind={RESPONSE_CHIP[r.status as keyof typeof RESPONSE_CHIP] ?? 'stPlain'}>{RESPONSE_LABEL[r.status as keyof typeof RESPONSE_LABEL] ?? r.status}</Chip>{' '}
                        {r.kind === 'accept_claim' ? `Accepted the claim, refund £${r.amountGBP?.toFixed(2)}` : `Evidence with ${r.photoIds.length} photo(s)`} · {r.disputeId} · by {r.sentBy}
                        {r.paypalDebugId && ` · debug id ${r.paypalDebugId}`}
                        <details>
                          <summary>Notes sent</summary>
                          <p className={st.note} style={{ whiteSpace: 'pre-wrap' }}>
                            {r.notes}
                          </p>
                        </details>
                      </span>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </section>

          {charged.length === 0 && (
            <section className={w.panel}>
              <p className={w.sSub}>No charged findings on this hire.</p>
            </section>
          )}
          {charged.map((f) => {
            const c = f.clauseId ? clause.get(f.clauseId) : undefined;
            const [p, r] = [f.pickupPhotoId && shotOf.get(f.pickupPhotoId), f.returnPhotoId && shotOf.get(f.returnPhotoId)];
            return (
              <section key={f.id} className={w.panel} aria-labelledby={`f-${f.id}`}>
                <div className={w.panelHead}>
                  <h2 id={`f-${f.id}`} className={w.sH2}>
                    Finding · {angleName(f.angle).toLowerCase()} · charged {gbp(f.setGBP ?? f.proposedGBP ?? 0)}
                  </h2>
                  <Chip kind="stHuman">Approved by a person</Chip>
                </div>
                <div className={st.sPairWide}>
                  <EvidencePair
                    pickupId={f.pickupPhotoId}
                    returnId={f.returnPhotoId}
                    box={f.box}
                    what={angleName(f.angle)}
                    photo={photo}
                    className={st.sPair}
                    captions={[
                      p ? `Pick-up · ${stamp(new Date(p.serverAt))} · sha256 ${short(p.sha256)}${p.sample ? ' · sample' : ''}` : 'Pick-up',
                      r ? `Return · ${stamp(new Date(r.serverAt))} · sha256 ${short(r.sha256)}${r.sample ? ' · sample' : ''}` : 'Return',
                    ]}
                  />
                </div>
                <dl className={w.kv}>
                  {[
                    ['What the inspector saw', f.description],
                    ['Clause', c ? `${c.id} · ${c.text.toLowerCase()}${c.chargeable ? ` · £${c.lowGBP}–£${c.highGBP}` : ''}` : '—'],
                    ['AI proposed', f.proposedGBP === null ? '—' : gbp(f.proposedGBP)],
                    ['Set by a person', f.setGBP === null ? 'kept the AI’s amount' : `${gbp(f.setGBP)} · ${f.setBy}`],
                    ['Approval', approval ? `${approval.approver}, up to ${gbp(approval.maxGBP)} · ${approval.signatureVerifies ? 'signature verifies' : 'signature does not verify'}` : '—'],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            );
          })}

          {contest && (
            <section className={w.panel} aria-labelledby="contest-title">
              <div className={w.panelHead}>
                <h2 id="contest-title" className={w.sH2}>
                  The renter’s contest
                </h2>
                <Chip kind={contest.status === 'open' ? 'stLook' : 'stOk'}>{contest.status === 'open' ? 'Open' : `Resolved by ${contest.resolvedBy}`}</Chip>
              </div>
              <p className={st.note}>“{contest.note}”</p>
              {contest.photoId && (
                <div className={st.sPairWide}>
                  <EvidencePhoto src={photo(contest.photoId)} alt="The renter’s contest photo" />
                </div>
              )}
            </section>
          )}

          <section className={w.panel} aria-labelledby="tl-title">
            <h2 id="tl-title" className={w.sH2}>
              Timeline
            </h2>
            {pack.timeline.length === 0 ? (
              <p className={w.sSub}>Nothing recorded.</p>
            ) : (
              <ol className={st.tl}>
                {pack.timeline.map((e, i) => (
                  <li key={i}>
                    <time dateTime={e.at}>{stamp(new Date(e.at))}</time>
                    <span>{e.summary}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <aside className={s.sideSticky}>
          <DraftPanel
            draft={draftDisputeResponse.bind(null, hire.ref)}
            preview={previewEvidence.bind(null, hire.ref)}
            send={sendEvidenceToPayPal.bind(null, hire.ref)}
            photos={pickPhotos}
            target={target}
            maxFiles={MAX_FILES}
          />
        </aside>
      </div>
    </StaffPage>
  );
}
