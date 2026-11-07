'use client';

// Runs one server action that returns a refusal (or null) and shows the refusal next to the button. The action
// refreshes the page itself, so success needs nothing here.

import { useState, useTransition, type ReactNode } from 'react';
import w from './wire.module.css';

export function ActionButton({
  action,
  children,
  pending: pendingLabel,
  ghost,
  disabled,
}: {
  action: () => Promise<string | null>;
  children: ReactNode;
  pending?: string;
  ghost?: boolean;
  disabled?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <button
        type="button"
        className={ghost ? w.btnGhost : w.btn}
        disabled={disabled || pending}
        onClick={() => {
          setError(null);
          start(async () => setError(await action().catch(() => 'Could not reach the server; reload and try again')));
        }}
      >
        {pending ? (pendingLabel ?? 'Working…') : children}
      </button>
      {error && (
        <p role="alert" className={w.sErr}>
          {error}
        </p>
      )}
    </>
  );
}
