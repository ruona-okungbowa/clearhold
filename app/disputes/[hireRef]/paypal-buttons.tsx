'use client';

// "Refresh from PayPal": reads every dispute and updates our case status. It moves no money and answers nothing.

import { useState, useTransition } from 'react';
import st from '@/app/(lab)/staff.module.css';
import w from '@/app/(lab)/wire.module.css';

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

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
