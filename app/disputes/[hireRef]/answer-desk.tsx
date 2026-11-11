'use client';

// The two working panels of a PayPal dispute: "Evidence to send" (photos as files, our records as lines in the note) and
// "Answer PayPal" (send evidence, offer part back, or accept and refund). They share what is ticked and the edited note,
// so one component owns both; the page passes the server-rendered panels around them as `lead` and `rest`.
// Every answer goes Review → Confirm: nothing reaches PayPal before a person confirms the exact request.

import { useState, useTransition, type ReactNode } from 'react';
import { Who } from '@/app/(lab)/chrome';
import st from '@/app/(lab)/staff.module.css';
import w from '@/app/(lab)/wire.module.css';
import type { EvidencePlan } from '@/lib/disputes';
import type { Draft } from '@/lib/evidence-pack';

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };
type Paragraphs = Draft['paragraphs'];
type Gate = { open: true } | { open: false; why: string };
type Mode = 'evidence' | 'offer' | 'accept';

export type DeskPhoto = { id: string; label: string; meta: string; sizeKB: number | null; preselected: boolean; jpeg: boolean; src: string };
export type DeskRecord = { id: string; label: string; detail: string };
export type DeskDispute = { id: string; amountGBP: string; capturedGBP: string; captureId: string; evidence: Gate; offer: Gate; accept: Gate };

const unreachable = { ok: false as const, error: 'Could not reach the server, so PayPal’s answer is unknown: refresh from PayPal before trying again.' };
const AMOUNT = /^\d+(\.\d{1,2})?$/;

export function AnswerDesk({
  dispute,
  photos,
  records,
  maxFiles,
  lead,
  rest,
  draft,
  preview,
  send,
  offer,
  accept,
}: {
  dispute: DeskDispute;
  photos: DeskPhoto[];
  records: DeskRecord[];
  maxFiles: number;
  lead: ReactNode;
  rest: ReactNode;
  draft: () => Promise<{ draft: Draft } | { rejected: string }>;
  preview: (paragraphs: Paragraphs, photoIds: string[], recordIds: string[]) => Promise<Result<{ plan: EvidencePlan }>>;
  send: (paragraphs: Paragraphs, photoIds: string[], recordIds: string[]) => Promise<Result<{ debugId: string | null }>>;
  offer: (offerGBP: string) => Promise<Result<{ debugId: string | null; amountGBP: string }>>;
  accept: (shownGBP: string) => Promise<Result<{ debugId: string | null; amountGBP: string }>>;
}) {
  const gates: Record<Mode, Gate> = { evidence: dispute.evidence, offer: dispute.offer, accept: dispute.accept };
  const [mode, setMode] = useState<Mode>((['evidence', 'offer', 'accept'] as const).find((m) => gates[m].open) ?? 'evidence');
  const [paragraphs, setParagraphs] = useState<Paragraphs | null>(null);
  const [editing, setEditing] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);
  const [chosen, setChosen] = useState(() => photos.filter((p) => p.preselected && p.jpeg).map((p) => p.id).slice(0, maxFiles));
  const [chosenRecords, setChosenRecords] = useState(() => records.map((r) => r.id));
  const [offerGBP, setOfferGBP] = useState('');
  const [review, setReview] = useState<{ kind: 'evidence'; plan: EvidencePlan } | { kind: 'offer' | 'accept' } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const gate = gates[mode];
  const disputed = Number(dispute.amountGBP);
  const offerOk = AMOUNT.test(offerGBP) && Number(offerGBP) > 0 && Number(offerGBP) < disputed && Number(offerGBP) <= Number(dispute.capturedGBP);
  const kb = (ids: string[]) => photos.filter((p) => ids.includes(p.id)).reduce((n, p) => n + (p.sizeKB ?? 0), 0);
  const cites = paragraphs ? [...new Set(paragraphs.flatMap((p) => p.citations.map((c) => `${c.kind} ${c.id}`)))] : [];
  const clear = () => {
    setReview(null);
    setError(null);
  };
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const redraft = () => {
    clear();
    setEditing(false);
    start(async () => {
      const r = await draft().catch(() => ({ rejected: 'could not reach the server' }));
      if ('draft' in r) {
        setParagraphs(r.draft.paragraphs);
        setRejected(null);
      } else setRejected(r.rejected);
    });
  };
  const toReview = () => {
    clear();
    if (mode !== 'evidence') return setReview({ kind: mode });
    if (!paragraphs) return;
    start(async () => {
      const r = await preview(paragraphs, chosen, chosenRecords).catch(() => unreachable);
      if (r.ok) setReview({ kind: 'evidence', plan: r.plan });
      else setError(r.error);
    });
  };
  const confirm = () =>
    start(async () => {
      setError(null);
      const r =
        mode === 'evidence' && paragraphs
          ? await send(paragraphs, chosen, chosenRecords).catch(() => unreachable)
          : mode === 'offer'
            ? await offer(offerGBP).catch(() => unreachable)
            : await accept(dispute.amountGBP).catch(() => unreachable);
      setReview(null);
      if (!r.ok) return setError(r.error);
      setDone(
        mode === 'evidence'
          ? `Evidence sent to PayPal (debug id ${r.debugId ?? 'none'}).`
          : mode === 'offer'
            ? `Offer of £${'amountGBP' in r ? r.amountGBP : offerGBP} sent to the buyer (debug id ${r.debugId ?? 'none'}).`
            : `PayPal accepted: £${'amountGBP' in r ? r.amountGBP : dispute.amountGBP} refunded to the buyer (debug id ${r.debugId ?? 'none'}).`,
      );
    });

  const primary =
    mode === 'evidence'
      ? `Review and send ${chosen.length} file${chosen.length === 1 ? '' : 's'}`
      : mode === 'offer'
        ? offerOk
          ? `Review offer of £${Number(offerGBP).toFixed(2)}`
          : 'Review offer'
        : `Review refund of £${dispute.amountGBP}`;
  const primaryOff = pending || !gate.open || (mode === 'evidence' ? !paragraphs || editing || chosen.length > maxFiles : mode === 'offer' ? !offerOk : false);

  return (
    <>
      <div className={st.stack}>
        {lead}
        <section className={w.panel} aria-labelledby="ev-title">
          <div className={w.panelHead}>
            <h2 id="ev-title" className={w.sH2}>
              Evidence to send
            </h2>
            <p className={w.sSub}>From the evidence pack. Untick anything you don’t want PayPal to see.</p>
          </div>
          <ul className={st.evList} aria-label="Photos, sent as files">
            {photos.map((p) => (
              <li key={p.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={chosen.includes(p.id)}
                    disabled={done !== null || !p.jpeg || (!chosen.includes(p.id) && chosen.length >= maxFiles)}
                    onChange={() => {
                      clear();
                      setChosen((c) => toggle(c, p.id));
                    }}
                  />
                  {/* eslint-disable-next-line @next/next/no-img-element -- a private, cookie-guarded photo route, not an optimisable asset */}
                  <img className={st.evThumb} src={p.src} alt="" />
                  <span>
                    {p.label}
                    <small>{p.jpeg ? p.meta : `${p.meta} · not a JPEG, can’t be sent`}</small>
                  </span>
                </label>
                <span className={st.evMeta}>{p.sizeKB === null ? '' : `${p.sizeKB} KB`}</span>
              </li>
            ))}
          </ul>
          <ul className={st.evList} aria-label="Records, summarised in the note">
            {records.map((r) => (
              <li key={r.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={chosenRecords.includes(r.id)}
                    disabled={done !== null}
                    onChange={() => {
                      clear();
                      setChosenRecords((c) => toggle(c, r.id));
                    }}
                  />
                  <span className={st.evDoc}>NOTE</span>
                  <span>
                    {r.label}
                    <small>{r.detail}</small>
                  </span>
                </label>
                <span className={st.evMeta}>in the note</span>
              </li>
            ))}
          </ul>
          <p className={st.evFoot}>
            <span>
              {chosen.length} of {photos.length} photos · {chosenRecords.length} of {records.length} records
            </span>
            <span>{kb(chosen)} KB in files</span>
          </p>
          <p className={w.sSub}>PayPal takes photos and PDFs only, so our records go in the note as one line each, written by code from the pack.</p>
        </section>
        {rest}
      </div>

      <aside className={st.stack}>
        <section className={w.panel} aria-labelledby="answer-title">
          <h2 id="answer-title" className={w.sH2}>
            Answer PayPal
          </h2>
          <fieldset className={st.answerOpts} disabled={done !== null || pending}>
            <legend className={w.srOnly}>How to answer</legend>
            {(
              [
                ['evidence', 'Send evidence', `Keep the £${dispute.amountGBP}. PayPal reviews the photos and the records.`],
                ['offer', 'Offer part back', `Refund some of the £${dispute.amountGBP}. The buyer can accept or keep the dispute open.`],
                ['accept', `Accept and refund £${dispute.amountGBP}`, 'Closes the dispute. PayPal refunds the buyer in full.'],
              ] as const
            ).map(([m, title, help]) => (
              <label key={m}>
                <input
                  type="radio"
                  name="answer"
                  checked={mode === m}
                  disabled={!gates[m].open}
                  onChange={() => {
                    clear();
                    setMode(m);
                  }}
                />
                <span>
                  <strong>{title}</strong>
                  <small>{gates[m].open ? help : `Not open: ${(gates[m] as { why: string }).why}.`}</small>
                </span>
              </label>
            ))}
          </fieldset>

          {mode === 'offer' && (
            <label className={w.sField}>
              <span>Offer (£, less than £{dispute.amountGBP})</span>
              <input
                className={w.sInput}
                inputMode="decimal"
                value={offerGBP}
                aria-invalid={offerGBP !== '' && !offerOk}
                onChange={(e) => {
                  clear();
                  setOfferGBP(e.target.value.trim());
                }}
              />
            </label>
          )}

          <div className={w.panelHead}>
            <h3 className={w.sH2}>Note to PayPal</h3>
            {mode === 'evidence' && <Who ai>AI draft</Who>}
          </div>
          {mode !== 'evidence' ? (
            <p className={st.note}>
              {mode === 'offer'
                ? `Sent with the offer: “Ledgerton Hire offers a refund of £${offerOk ? Number(offerGBP).toFixed(2) : '…'} of the £${dispute.amountGBP} disputed.”`
                : `Sent with the refund: “Ledgerton Hire accepts this claim and refunds the full £${dispute.amountGBP}.”`}
            </p>
          ) : !paragraphs ? (
            <p className={w.sSub}>Draft a note from the evidence pack alone. Every sentence must cite a record, or the draft is rejected.</p>
          ) : editing ? (
            paragraphs.map((p, i) => (
              <label key={i} className={w.sField}>
                <span>Paragraph {i + 1}</span>
                <textarea
                  className={w.sInput}
                  rows={5}
                  value={p.text}
                  onChange={(e) => setParagraphs((ps) => ps && ps.map((q, j) => (j === i ? { ...q, text: e.target.value } : q)))}
                />
              </label>
            ))
          ) : (
            <div className={st.draft}>
              {paragraphs.map((p, i) => (
                <p key={i}>{p.text}</p>
              ))}
              <ul className={st.cites} aria-label="Facts cited">
                {cites.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          )}
          {rejected && (
            <p role="alert" className={w.sErr}>
              Draft rejected: {rejected}
            </p>
          )}
          {mode === 'evidence' && done === null && (
            <div className={st.btnRow}>
              {paragraphs && (
                <button
                  type="button"
                  className={w.btnGhost}
                  disabled={pending}
                  onClick={() => {
                    clear();
                    setEditing(!editing);
                  }}
                >
                  {editing ? 'Done editing' : 'Edit'}
                </button>
              )}
              <button type="button" className={paragraphs ? w.btnGhost : w.btn} disabled={pending} onClick={redraft}>
                {pending && !paragraphs ? 'Drafting…' : paragraphs ? 'Redraft' : 'Draft a note'}
              </button>
            </div>
          )}

          {review ? (
            <div role="region" aria-labelledby="confirm-title" className={st.stack}>
              <h3 id="confirm-title" className={w.sH2}>
                Check what will be sent
              </h3>
              {review.kind === 'evidence' ? (
                <>
                  <dl className={w.kv}>
                    {[
                      ['Dispute', review.plan.disputeId],
                      ['Capture', review.plan.captureId],
                      ['Evidence type', review.plan.evidenceType],
                      ['Files', review.plan.files.length ? review.plan.files.map((f) => f.name).join(', ') : 'none'],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd>{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <pre className={st.draft} style={{ whiteSpace: 'pre-wrap' }}>
                    {review.plan.notes}
                  </pre>
                </>
              ) : (
                <p className={st.note}>
                  {review.kind === 'offer'
                    ? `PayPal will offer the buyer £${Number(offerGBP).toFixed(2)} of the £${dispute.amountGBP} disputed. If they accept, PayPal refunds it from capture ${dispute.captureId}.`
                    : `PayPal will close this dispute in the buyer’s favour and refund £${dispute.amountGBP} of the £${dispute.capturedGBP} taken on capture ${dispute.captureId}. This can’t be undone.`}
                </p>
              )}
              <div className={st.btnRow}>
                <button type="button" className={w.btn} disabled={pending} onClick={confirm}>
                  {pending ? 'Sending…' : 'Confirm and send to PayPal'}
                </button>
                <button type="button" className={w.btnGhost} disabled={pending} onClick={() => setReview(null)}>
                  Back
                </button>
              </div>
            </div>
          ) : done === null ? (
            <button type="button" className={w.btn} disabled={primaryOff} onClick={toReview}>
              {pending && mode === 'evidence' && paragraphs ? 'Checking…' : primary}
            </button>
          ) : null}

          {error && (
            <p role="alert" className={w.sErr}>
              {error}
            </p>
          )}
          {done ? (
            <p role="status" className={w.sSub}>
              {done}
            </p>
          ) : (
            <p className={w.sSub}>{gate.open ? 'Nothing goes to PayPal until you confirm on the next step.' : `Not open: ${(gate as { why: string }).why}.`}</p>
          )}
        </section>

        <section className={w.panel} aria-labelledby="rules-title">
          <h2 id="rules-title" className={w.sH2}>
            Rules on this page
          </h2>
          <ul className={st.rules}>
            <li>A person sends every answer; the AI only drafts the note.</li>
            <li>An offer can only be less than what was disputed, and never more than we captured.</li>
            <li>The note cites records; it never quotes the buyer as fact.</li>
            <li>Answers go to PayPal’s sandbox only.</li>
          </ul>
        </section>
      </aside>
    </>
  );
}
