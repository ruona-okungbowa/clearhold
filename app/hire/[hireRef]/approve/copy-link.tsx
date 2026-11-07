'use client';

import { useState } from 'react';
import st from '@/app/(lab)/staff.module.css';
import w from '@/app/(lab)/wire.module.css';

// The renter's link, with the page's own origin, so it pastes into a message as it is.
export function CopyLink({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={w.sField}>
      <span>Renter’s link: send it to the renter</span>
      <div className={st.copyRow}>
        <input className={w.sInput} readOnly aria-label="Renter link" value={path} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className={w.btnGhost} onClick={() => navigator.clipboard.writeText(location.origin + path).then(() => setCopied(true))}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
