'use client';

// The AI draft of a response, built only from the evidence pack and rejected by code if it cites anything the pack
// doesn't hold. A person edits it, picks the photos, and sends it: "Send to PayPal…" asks the server to validate the edit
// and build the exact request, the confirm step shows that request, and only "Confirm and send" calls PayPal.

import { useState, useTransition } from 'react';
import { Who } from '@/app/(lab)/chrome';
import st from '@/app/(lab)/staff.module.css';
import w from '@/app/(lab)/wire.module.css';
import type { EvidencePlan } from '@/lib/disputes';
import type { Draft } from '@/lib/evidence-pack';

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };
type Paragraphs = Draft['paragraphs'];

export type PickPhoto = { id: string; label: string; preselected: boolean; jpeg: boolean };
// The dispute evidence would answer, or why there is none to answer right now.
export type EvidenceTarget = { disputeId: string } | { why: string };

export function DraftPanel({
  draft,
  preview,
  send,
  photos,
  target,
  maxFiles,
}: {
  draft: () => Promise<{ draft: Draft } | { rejected: string }>;
  preview: (disputeId: string, paragraphs: Paragraphs, photoIds: string[]) => Promise<Result<{ plan: EvidencePlan }>>;
  send: (disputeId: string, paragraphs: Paragraphs, photoIds: string[]) => Promise<Result<{ debugId: string | null }>>;
  photos: PickPhoto[];
  target: EvidenceTarget;
  maxFiles: number;
}) {
  const [paragraphs, setParagraphs] = useState<Paragraphs | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  const [chosen, setChosen] = useState(() => photos.filter((p) => p.preselected && p.jpeg).map((p) => p.id).slice(0, maxFiles));
  const [plan, setPlan] = useState<EvidencePlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const text = paragraphs?.map((p) => p.text).join('\n\n') ?? '';
  const cites = paragraphs ? [...new Set(paragraphs.flatMap((p) => p.citations.map((c) => `${c.kind} ${c.id}`)))] : [];
  const disputeId = 'disputeId' in target ? target.disputeId : null;

  const run = () => {
    setCopied(false);
    setPlan(null);
    setError(null);
    start(async () => {
      const r = await draft().catch(() => ({ rejected: 'could not reach the server' }));
      if ('draft' in r) {
        setParagraphs(r.draft.paragraphs);
        setRejected(null);
      } else setRejected(r.rejected);
    });
  };
  const edit = (i: number, value: string) => {
    setPlan(null);
    setParagraphs((ps) => ps && ps.map((p, j) => (j === i ? { ...p, text: value } : p)));
  };
  const toggle = (id: string) => {
    setPlan(null);
    setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  };
  const review = () => {
    if (!disputeId || !paragraphs) return;
    start(async () => {
      setError(null);
      const r = await preview(disputeId, paragraphs, chosen).catch(() => ({ ok: false as const, error: 'could not reach the server' }));
      if (r.ok) setPlan(r.plan);
      else setError(r.error);
    });
  };
  const confirm = () => {
    if (!disputeId || !paragraphs) return;
    start(async () => {
      setError(null);
      const r = await send(disputeId, paragraphs, chosen).catch(() => ({
        ok: false as const,
        error: 'Could not reach the server, so PayPal’s answer is unknown: refresh from PayPal before retrying.',
      }));
      if (r.ok) {
        setSent(r.debugId ?? 'none');
        setPlan(null);
      } else setError(r.error);
    });
  };

  return (
    <section className={w.panel} aria-labelledby="resp-title">
      <div className={w.panelHead}>
        <h2 id="resp-title" className={w.sH2}>
          Response to PayPal
        </h2>
        <Who ai>AI draft</Who>
      </div>

      {sent ? (
        <p role="status" className={w.sSub}>
          Sent to PayPal (debug id {sent}). The record is under “PayPal dispute” on this page.
        </p>
      ) : plan ? (
        <div role="region" aria-labelledby="confirm-title" className={st.stack}>
          <h3 id="confirm-title" className={w.sH2}>
            Check what will be sent
          </h3>
          <dl className={w.kv}>
            {[
              ['Dispute', plan.disputeId],
              ['Capture', plan.captureId],
              ['Evidence type', plan.evidenceType],
              ['Photos', plan.files.length ? plan.files.map((f) => f.name).join(', ') : 'none'],
            ].map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <pre className={st.draft} style={{ whiteSpace: 'pre-wrap' }}>
            {plan.notes}
          </pre>
          <div className={st.btnRow}>
            <button type="button" className={w.btn} disabled={pending} onClick={confirm}>
              {pending ? 'Sending…' : 'Confirm and send to PayPal'}
            </button>
            <button type="button" className={w.btnGhost} disabled={pending} onClick={() => setPlan(null)}>
              Back to editing
            </button>
          </div>
        </div>
      ) : paragraphs ? (
        <>
          {paragraphs.map((p, i) => (
            <label key={i} className={w.sField}>
              <span>
                Paragraph {i + 1} · cites {p.citations.map((c) => `${c.kind} ${c.id}`).join(', ')}
              </span>
              <textarea className={w.sInput} rows={4} value={p.text} onChange={(e) => edit(i, e.target.value)} />
            </label>
          ))}
          <ul className={st.cites} aria-label="Facts cited">
            {cites.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <fieldset className={w.sField}>
            <legend>
              Photos to attach ({chosen.length} of at most {maxFiles})
            </legend>
            {photos.map((p) => (
              <label key={p.id} style={{ display: 'block' }}>
                <input
                  type="checkbox"
                  checked={chosen.includes(p.id)}
                  disabled={!p.jpeg || (!chosen.includes(p.id) && chosen.length >= maxFiles)}
                  onChange={() => toggle(p.id)}
                />{' '}
                {p.label}
                {!p.jpeg && ' (not a JPEG, can’t be sent)'}
              </label>
            ))}
          </fieldset>
        </>
      ) : (
        <p className={w.sSub}>Draft a reply from the evidence pack alone. Every sentence must cite a record, or the draft is rejected.</p>
      )}

      {rejected && (
        <p role="alert" className={w.sErr}>
          Draft rejected: {rejected}
        </p>
      )}
      {error && (
        <p role="alert" className={w.sErr}>
          {error}
        </p>
      )}

      {!plan && !sent && (
        <div className={st.btnRow}>
          <button type="button" className={text ? w.btnGhost : w.btn} disabled={pending} onClick={run}>
            {pending && !paragraphs ? 'Drafting…' : text ? 'Redraft' : 'Draft a response'}
          </button>
          {text && (
            <>
              <button type="button" className={w.btnGhost} onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(true))}>
                {copied ? 'Copied' : 'Copy draft'}
              </button>
              <button type="button" className={w.btn} disabled={pending || !disputeId || chosen.length > maxFiles} onClick={review}>
                Send to PayPal…
              </button>
            </>
          )}
        </div>
      )}
      <p className={w.sSub}>
        {'why' in target
          ? `Sending is off: ${target.why}.`
          : 'Send to PayPal checks the edited draft against the evidence pack, then shows exactly what will be sent before anything goes.'}
      </p>
    </section>
  );
}
