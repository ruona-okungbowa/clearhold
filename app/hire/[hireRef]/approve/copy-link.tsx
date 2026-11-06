'use client';

import { useState } from 'react';

// The renter's link, with the page's own origin, so it pastes into a message as it is.
export function CopyLink({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <p>
      Renter link: <a href={path}>{path.slice(0, 24)}…</a>{' '}
      <button
        type="button"
        onClick={() => navigator.clipboard.writeText(location.origin + path).then(() => setCopied(true))}
      >
        {copied ? 'Copied' : 'Copy link'}
      </button>
    </p>
  );
}
