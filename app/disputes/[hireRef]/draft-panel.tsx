'use client';

import { useState, useTransition } from 'react';
import type { Draft } from '@/lib/evidence-pack';

export function DraftPanel({ draft }: { draft: () => Promise<{ draft: Draft } | { rejected: string }> }) {
  const [result, setResult] = useState<{ draft: Draft } | { rejected: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const text = result && 'draft' in result ? result.draft.paragraphs.map((p) => p.text).join('\n\n') : '';

  return (
    <section>
      <h2>AI draft response</h2>
      <p>
        Claude drafts a reply from the evidence pack alone; code rejects it if it cites anything not in the pack or names an
        amount the pack doesn&apos;t hold. <strong>Nothing is sent to PayPal:</strong> there is no tool or API call for it.
        Copy the draft, check it, and submit it yourself in PayPal&apos;s Resolution Center.
      </p>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setCopied(false);
          start(async () => setResult(await draft().catch(() => ({ rejected: 'could not reach the server' }))));
        }}
      >
        {pending ? 'Drafting…' : 'Draft a response'}
      </button>
      {result && 'rejected' in result && <p role="alert">Draft rejected: {result.rejected}</p>}
      {result && 'draft' in result && (
        <>
          {result.draft.paragraphs.map((p, i) => (
            <p key={i}>
              {p.text} <small>[{p.citations.map((c) => `${c.kind} ${c.id}`).join(', ')}]</small>
            </p>
          ))}
          <button type="button" onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(true))}>
            Copy draft
          </button>{' '}
          <span role="status">{copied ? 'Copied' : ''}</span>
        </>
      )}
    </section>
  );
}
