// A case: a PayPal dispute on one of this hire's captures, or a renter's contest. With a dispute, the page is laid out for
// answering PayPal (status, the buyer's words, evidence to send, the three answers); without one, it shows the evidence
// pack and a draft to copy, as before.

import { head } from '@vercel/blob';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import { Chip, dayLabel, gbp, stamp, staffUrl } from '@/app/(lab)/chrome';
import { EvidencePair, EvidencePhoto } from '@/app/(lab)/evidence';
import s from '@/app/(lab)/screens.module.css';
import st from '@/app/(lab)/staff.module.css';
import { StaffPage } from '@/app/(lab)/staff-page';
import w from '@/app/(lab)/wire.module.css';
import { itemName } from '@/lib/catalogue';
import { db } from '@/lib/db';
import { disputesFor, MAX_FILES, recordLines, type DisputeView } from '@/lib/disputes';
import { buildEvidencePack } from '@/lib/evidence-pack';
import { ANGLES } from '@/lib/schedule';
import { acceptClaimAndRefund, draftDisputeResponse, offerPartRefund, previewEvidence, refreshFromPayPal, sendEvidenceToPayPal } from './actions';
import { AnswerDesk } from './answer-desk';
import { DraftPanel } from './draft-panel';
import { RefreshFromPayPal } from './paypal-buttons';

export const metadata: Metadata = { title: 'Dispute' };

const DAY = 86_400_000;
// Read once per request: the page is dynamic (connection()), so "now" is the request's time.
const daysUntil = (iso: string) => Math.ceil((Date.parse(iso) - Date.now()) / DAY);
const angleName = (id: string) => ANGLES.find((a) => a.id === id)?.short ?? id;
const photo = (id: string) => `/api/photos/${id}`;
const short = (sha: string) => `${sha.slice(0, 4)}…${sha.slice(-4)}`;
const sentence = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replaceAll('_', ' ');
const RESPONSE_CHIP = { sent: 'stHuman', sending: 'stLook', failed: 'stPlain' } as const;
const RESPONSE_LABEL = { sent: 'Sent', sending: 'Outcome unknown', failed: 'Refused by PayPal' } as const;
const RESPONSE_WHAT = { evidence: 'Evidence', accept_claim: 'Accepted the claim', offer: 'Offered part back' } as const;
// Where each PayPal status sits on the steps: Opened, Waiting for us, Evidence sent, PayPal reviewing, Resolved.
const STEP_OF: Record<string, number> = { OPEN: 0, WAITING_FOR_SELLER_RESPONSE: 1, WAITING_FOR_BUYER_RESPONSE: 3, UNDER_REVIEW: 3, RESOLVED: 5 };

export default async function DisputePage({ params }: PageProps<'/disputes/[hireRef]'>) {
  await connection();
  const { hireRef } = await params;
  const pack = await buildEvidencePack(hireRef).catch((err: Error) => (err.message.startsWith('No hold') ? notFound() : Promise.reject(err)));
  const { hire, findings, clauses, approvals, captures, contest } = pack;
  const clause = new Map(clauses.map((c) => [c.id, c]));
  const shotOf = new Map(pack.photos.map((p) => [p.id, p]));
  const charged = findings.filter((f) => (f.setGBP ?? f.proposedGBP ?? 0) > 0);
  const finalCapture = captures.find((c) => c.final);
  const approval = approvals.at(-1);
  const [disputes, responses, hireRow, photoRows] = await Promise.all([
    disputesFor(hire.ref),
    db.disputeResponse.findMany({ where: { hireRef: hire.ref }, orderBy: { sentAt: 'desc' } }),
    db.hire.findUniqueOrThrow({ where: { hireRef: hire.ref }, select: { refundedViaDisputeAt: true, renterName: true } }),
    db.photo.findMany({ where: { id: { in: pack.photos.map((p) => p.id) } }, select: { id: true, contentType: true, pathname: true } }),
  ]);
  const jpeg = new Set(photoRows.filter((p) => p.contentType === 'image/jpeg').map((p) => p.id));
  const paired = new Set(charged.flatMap((f) => [f.pickupPhotoId, f.returnPhotoId].filter((id): id is string => Boolean(id))));
  const shots = pack.photos.filter((p) => p.stage === 'pickup' || p.stage === 'return');
  const label = (p: (typeof shots)[number]) => `${p.stage === 'pickup' ? 'Pick-up' : 'Return'} photo · ${angleName(p.angle).toLowerCase()}${p.sample ? ' · sample' : ''}`;
  // An open dispute first; otherwise the latest, so a resolved case still shows how it ended.
  const active = disputes.find((d) => d.status !== 'RESOLVED') ?? disputes[0];

  const findingPanels = (
    <>
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
    </>
  );

  const responsePanel = responses.length > 0 && (
    <section className={w.panel} aria-labelledby="sent-title">
      <h2 id="sent-title" className={w.sH2}>
        Our answers to PayPal
      </h2>
      <ol className={st.tl}>
        {responses.map((r) => (
          <li key={r.id}>
            <time dateTime={r.sentAt.toISOString()}>{stamp(r.sentAt)}</time>
            <span>
              <Chip kind={RESPONSE_CHIP[r.status as keyof typeof RESPONSE_CHIP] ?? 'stPlain'}>{RESPONSE_LABEL[r.status as keyof typeof RESPONSE_LABEL] ?? r.status}</Chip>{' '}
              {RESPONSE_WHAT[r.kind as keyof typeof RESPONSE_WHAT] ?? r.kind}
              {r.kind === 'evidence' ? ` with ${r.photoIds.length} photo(s)` : ` · £${r.amountGBP?.toFixed(2)}`} · {r.disputeId} · by {r.sentBy}
              {r.paypalDebugId && ` · debug id ${r.paypalDebugId}`}
              <details>
                <summary>Note sent</summary>
                <p className={st.note} style={{ whiteSpace: 'pre-wrap' }}>
                  {r.notes}
                </p>
              </details>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );

  const timelinePanel = (
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
  );

  const packLink = (
    <a href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(pack, null, 2))}`} download={`evidence-pack-${hire.ref}.json`} className={w.btnGhost}>
      Evidence pack
    </a>
  );

  if (active) {
    const sizes = new Map(
      await Promise.all(
        photoRows.map(async (p) => [p.id, await head(p.pathname).then((b) => Math.round(b.size / 1024), () => null)] as const),
      ),
    );
    return (
      <StaffPage current="disputes">
        <DisputeHeader d={active} hireRef={hire.ref} item={itemName(hire.itemRef)} renter={hireRow.renterName} refundedAt={hireRow.refundedViaDisputeAt} actions={packLink} />
        <DisputeSteps d={active} evidenceSentAt={responses.find((r) => r.disputeId === active.id && r.kind === 'evidence' && r.status === 'sent')?.sentAt ?? null} />
        <div className={st.apprGrid}>
          <AnswerDesk
            dispute={{
              id: active.id,
              amountGBP: active.amountGBP ?? '0.00',
              capturedGBP: active.capturedGBP,
              captureId: active.captureId,
              evidence: active.evidence,
              offer: active.offer,
              accept: active.amountGBP ? active.accept : { open: false, why: 'PayPal gives no dispute amount' },
            }}
            photos={shots.map((p) => ({
              id: p.id,
              label: label(p),
              meta: `${stamp(new Date(p.serverAt))} · sha256 ${short(p.sha256)}`,
              sizeKB: sizes.get(p.id) ?? null,
              preselected: paired.has(p.id),
              jpeg: jpeg.has(p.id),
              src: photo(p.id),
            }))}
            records={recordLines(pack).map(({ id, label, detail }) => ({ id, label, detail }))}
            maxFiles={MAX_FILES}
            lead={<WhatPayPalSays d={active} hireRef={hire.ref} others={disputes.filter((d) => d.id !== active.id)} />}
            rest={
              <>
                {responsePanel}
                {findingPanels}
                {timelinePanel}
              </>
            }
            draft={draftDisputeResponse.bind(null, hire.ref)}
            preview={previewEvidence.bind(null, hire.ref, active.id)}
            send={sendEvidenceToPayPal.bind(null, hire.ref, active.id)}
            offer={offerPartRefund.bind(null, hire.ref, active.id)}
            accept={acceptClaimAndRefund.bind(null, hire.ref, active.id)}
          />
        </div>
      </StaffPage>
    );
  }

  // No PayPal dispute: a renter's contest, or nothing yet. The evidence pack and a draft to copy.
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
        <div className={st.btnRow}>
          <RefreshFromPayPal refresh={refreshFromPayPal} />
          {packLink}
        </div>
      </div>
      <div className={st.apprGrid}>
        <div className={st.stack}>
          <section className={w.panel}>
            <p className={w.sSub}>No PayPal dispute is matched to this hire’s captures. Refresh from PayPal to look again.</p>
          </section>
          {charged.length === 0 && (
            <section className={w.panel}>
              <p className={w.sSub}>No charged findings on this hire.</p>
            </section>
          )}
          {findingPanels}
          {responsePanel}
          {timelinePanel}
        </div>
        <aside className={s.sideSticky}>
          <DraftPanel
            draft={draftDisputeResponse.bind(null, hire.ref)}
            preview={previewEvidence.bind(null, hire.ref)}
            send={sendEvidenceToPayPal.bind(null, hire.ref)}
            photos={shots.map((p) => ({ id: p.id, label: label(p), preselected: paired.has(p.id), jpeg: jpeg.has(p.id) }))}
            target={{ why: 'no PayPal dispute is matched to this hire' }}
            maxFiles={MAX_FILES}
          />
        </aside>
      </div>
    </StaffPage>
  );
}

function DisputeHeader({
  d,
  hireRef,
  item,
  renter,
  refundedAt,
  actions,
}: {
  d: DisputeView;
  hireRef: string;
  item: string;
  renter: string | null;
  refundedAt: Date | null;
  actions: ReactNode;
}) {
  return (
    <div className={w.sHead}>
      <div>
        <p className={`${w.sSub} ${st.crumb}`}>
          <Link href={staffUrl.disputes}>Disputes</Link> / {d.id}
        </p>
        <h1 className={w.sH1}>PayPal dispute · {hireRef}</h1>
        <p className={w.sSub}>
          {[
            d.openedAt && `Opened ${stamp(new Date(d.openedAt))}`,
            d.reason && sentence(d.reason),
            d.amountGBP && `£${d.amountGBP} of capture ${d.captureId.slice(0, 4)}…`,
            item,
            renter, // staff-only; never sent to PayPal
            refundedAt && `refunded via dispute ${stamp(refundedAt)}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
      <div className={st.btnRow}>
        <RefreshFromPayPal refresh={refreshFromPayPal} />
        {actions}
      </div>
    </div>
  );
}

function DisputeSteps({ d, evidenceSentAt }: { d: DisputeView; evidenceSentAt: Date | null }) {
  const now = STEP_OF[d.status] ?? 0;
  const steps: [string, string][] = [
    ['Opened', d.openedAt ? stamp(new Date(d.openedAt)) : ''],
    ['Waiting for us', d.respondBy && now <= 1 ? `respond by ${dayLabel(new Date(d.respondBy))}` : ''],
    ['Evidence sent', evidenceSentAt ? stamp(evidenceSentAt) : now > 2 ? 'none sent' : ''],
    ['PayPal reviewing', ''],
    ['Resolved', now === 5 ? 'closed by PayPal' : ''],
  ];
  return (
    <ol className={`${st.stepper} ${st.stepper5}`} aria-label="Dispute progress">
      {steps.map(([title, when], i) => (
        <li key={title} className={i < now || (i === 2 && evidenceSentAt) ? st.stepDone : i === now ? st.stepNow : undefined} aria-current={i === now ? 'step' : undefined}>
          <strong>{title}</strong>
          {when}
        </li>
      ))}
    </ol>
  );
}

function WhatPayPalSays({ d, hireRef, others }: { d: DisputeView; hireRef: string; others: DisputeView[] }) {
  const daysLeft = d.respondBy && d.status === 'WAITING_FOR_SELLER_RESPONSE' ? daysUntil(d.respondBy) : null;
  return (
    <section className={w.panel} aria-labelledby="pp-title">
      <div className={w.panelHead}>
        <h2 id="pp-title" className={w.sH2}>
          What PayPal says
        </h2>
        <Chip kind="stPlain">{d.status}</Chip>
      </div>
      {!d.live && (
        <p role="alert" className={w.sErr}>
          PayPal is unreachable just now: this is our last copy, and every answer is off until it’s back.
        </p>
      )}
      {daysLeft !== null && (
        <p className={st.daysLeft}>
          <strong>
            {daysLeft} day{daysLeft === 1 ? '' : 's'}
          </strong>
          left to respond · by {stamp(new Date(d.respondBy!))} · then PayPal decides without us
        </p>
      )}
      <dl className={w.kv}>
        {[
          ['Dispute id', d.id],
          ['Reason', d.reason ?? '—'],
          ['Stage', d.stage ?? '—'],
          ['Amount disputed', d.amountGBP ? `£${d.amountGBP}` : '—'],
          ['Matched to', `${hireRef} · capture ${d.captureId} · £${d.capturedGBP}`],
        ].map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {d.buyerSays.length > 0 && (
        <>
          <h3 className={w.sH2}>The buyer’s message</h3>
          {d.buyerSays.map((m, i) => (
            <blockquote key={i} className={st.quote}>
              “{m.text}”
            </blockquote>
          ))}
          <p className={w.sSub}>Written by the buyer. Shown to you as it is; the AI draft never sees it.</p>
        </>
      )}
      {others.length > 0 && <p className={w.sSub}>Other PayPal disputes on this hire: {others.map((o) => `${o.id} (${sentence(o.status)})`).join(', ')}.</p>}
    </section>
  );
}
