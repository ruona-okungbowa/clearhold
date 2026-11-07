'use client';

// The AI draft of a response, built only from the evidence pack and rejected by code if it cites anything the pack
// doesn't hold. Nothing is sent to PayPal from here: staff copy the draft and submit it in the Resolution Center.

import { useState, useTransition } from 'react';
import { Who } from '@/app/(lab)/chrome';
import st from '@/app/(lab)/staff.module.css';
import w from '@/app/(lab)/wire.module.css';
import type { Draft } from '@/lib/evidence-pack';

export function DraftPanel({ draft }: { draft: () => Promise<{ draft: Draft } | { rejected: string }> }) {
  const [result, setResult] = useState<{ draft: Draft } | { rejected: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const text = result && 'draft' in result ? result.draft.paragraphs.map((p) => p.text).join('\n\n') : '';
  const cites = result && 'draft' in result ? [...new Set(result.draft.paragraphs.flatMap((p) => p.citations.map((c) => `${c.kind} ${c.id}`)))] : [];
  const run = () => {
    setCopied(false);
    start(async () => setResult(await draft().catch(() => ({ rejected: 'could not reach the server' }))));
  };

  return (
    <section className={w.panel} aria-labelledby="resp-title">
      <div className={w.panelHead}>
        <h2 id="resp-title" className={w.sH2}>
          Response to PayPal
        </h2>
        <Who ai>AI draft</Who>
      </div>
      {result && 'draft' in result ? (
        <>
          <div className={st.draft}>
            {result.draft.paragraphs.map((p, i) => (
              <p key={i}>{p.text}</p>
            ))}
          </div>
          <ul className={st.cites} aria-label="Facts cited">
            {cites.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className={w.sSub}>Draft a reply from the evidence pack alone. Every sentence must cite a record, or the draft is rejected.</p>
      )}
      {result && 'rejected' in result && (
        <p role="alert" className={w.sErr}>
          Draft rejected: {result.rejected}
        </p>
      )}
      <div className={st.btnRow}>
        <button type="button" className={text ? w.btnGhost : w.btn} disabled={pending} onClick={run}>
          {pending ? 'Drafting…' : text ? 'Redraft' : 'Draft a response'}
        </button>
        {text && (
          <button type="button" className={w.btn} onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(true))}>
            {copied ? 'Copied' : 'Copy draft'}
          </button>
        )}
      </div>
      <p className={w.sSub}>Check the draft, then paste it into PayPal’s Resolution Center yourself. Nothing is sent from here.</p>
    </section>
  );
}
