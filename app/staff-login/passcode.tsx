'use client';

import { useState } from 'react';
import w from '@/app/(lab)/wire.module.css';
import st from '@/app/(lab)/staff.module.css';

export function Passcode({ bad }: { bad: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <div className={st.passField}>
      <label htmlFor="passcode">Staff passcode</label>
      <div className={st.passRow}>
        <input
          id="passcode"
          name="passcode"
          className={w.sInput}
          type={show ? 'text' : 'password'}
          inputMode="numeric"
          autoComplete="current-password"
          autoFocus
          required
          aria-invalid={bad || undefined}
          aria-describedby={bad ? 'passcode-error' : undefined}
        />
        <button type="button" aria-pressed={show} onClick={() => setShow(!show)}>
          {show ? 'Hide' : 'Show'}
        </button>
      </div>
      {bad && (
        <p id="passcode-error" role="alert" className={w.sErr}>
          That passcode isn’t right. Check with your manager if you’ve forgotten it.
        </p>
      )}
    </div>
  );
}
