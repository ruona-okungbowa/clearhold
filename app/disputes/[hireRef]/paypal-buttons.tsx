'use client';

// The two PayPal buttons on a case. Accept shows PayPal's own dispute amount (passed down from the server, never typed),
// asks once more, then sends; the server re-reads PayPal and refuses if the amount moved. Refresh only reads.

import { useState, useTransition } from 'react';
import st from '@/app/(lab)/staff.module.css';
import w from '@/app/(lab)/wire.module.css';

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

export function AcceptClaim({
  amountGBP,
  capturedGBP,
  captureId,
  why,
  accept,
}: {
  amountGBP: string;
  capturedGBP: string;
  captureId: string;
  why: string | null;
  accept: (shownGBP: string) => Promise<Result<{ debugId: string | null; amountGBP: string }>>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const go = () =>
    start(async () => {
      const r = await accept(amountGBP).catch(() => ({ ok: false as const, error: 'Could not reach the server, so PayPal’s answer is unknown: refresh from PayPal.' }));
      setConfirming(false);
      setMessage(r.ok ? { ok: true, text: `PayPal accepted: £${r.amountGBP} refunded to the buyer (debug id ${r.debugId ?? 'none'}).` } : { ok: false, text: r.error });
    });

  return (
    <div className={st.stack}>
      {confirming ? (
        <div role="region" aria-label="Confirm accepting the claim">
          <p className={st.note}>
            PayPal will close this dispute in the buyer’s favour and refund £{amountGBP} of the £{capturedGBP} taken on capture {captureId}. This can’t be undone.
          </p>
          <div className={st.btnRow}>
            <button type="button" className={w.btn} disabled={pending} onClick={go}>
              {pending ? 'Sending…' : `Confirm: refund £${amountGBP}`}
            </button>
            <button type="button" className={w.btnGhost} disabled={pending} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className={st.btnRow}>
          <button type="button" className={w.btnGhost} disabled={Boolean(why) || message?.ok} onClick={() => setConfirming(true)}>
            Accept claim and refund £{amountGBP}
          </button>
        </div>
      )}
      {why && <p className={w.sSub}>Accepting is off: {why}.</p>}
      {message && (
        <p role={message.ok ? 'status' : 'alert'} className={message.ok ? w.sSub : w.sErr}>
          {message.text}
        </p>
      )}
    </div>
  );
}

export function RefreshFromPayPal({ refresh }: { refresh: () => Promise<Result<{ ours: number }>> }) {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className={st.btnRow}>
      <button
        type="button"
        className={w.btnGhost}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await refresh().catch(() => ({ ok: false as const, error: 'Could not reach the server' }));
            setMessage(r.ok ? { ok: true, text: `Updated from PayPal: ${r.ours} dispute(s) are ours.` } : { ok: false, text: r.error });
          })
        }
      >
        {pending ? 'Refreshing…' : 'Refresh from PayPal'}
      </button>
      {message && (
        <span role={message.ok ? 'status' : 'alert'} className={message.ok ? w.sSub : w.sErr}>
          {message.text}
        </span>
      )}
    </div>
  );
}
