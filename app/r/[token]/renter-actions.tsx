'use client';

// Accept, or the one contest: a note, optionally a finding and one photo. The photo goes up first through the
// photo route, signed with the renter's link, and the contest then names it.

import { useState, useTransition, type FormEvent } from 'react';
import { shrink } from '@/app/c/[hireRef]/[stage]/capture-form';
import { acceptCharges, contestCharges } from './actions';

const BUTTON = 'w-full rounded-lg px-4 py-3 font-semibold disabled:opacity-50';

export function RenterActions({
  token,
  hireRef,
  approvalId,
  totalLabel,
  canContest,
  findings,
}: {
  token: string;
  hireRef: string;
  approvalId: string | null;
  totalLabel: string;
  canContest: boolean;
  findings: { id: string; label: string }[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [contesting, setContesting] = useState(false);
  const [pending, start] = useTransition();

  const run = (work: () => Promise<string | null>) => {
    setError(null);
    start(async () => setError(await work().catch(() => 'Could not reach the server; reload the page before trying again')));
  };

  const contest = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const file = form.get('photo');
    run(async () => {
      let photoId: string | null = null;
      if (file instanceof File && file.size > 0) {
        const body = new FormData();
        body.set('hireRef', hireRef);
        body.set('stage', 'contest');
        body.set('t', token);
        // A browser that can't decode the file (e.g. HEIC on desktop) sends it as it is.
        body.set('photo', await shrink(file).catch(() => file), 'contest.jpg');
        const res = await fetch('/api/photos', { method: 'POST', body });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) return `Photo not stored: ${json.error ?? res.statusText}`;
        photoId = json.id;
      }
      return contestCharges(token, { findingId: String(form.get('findingId') ?? '') || null, note: String(form.get('note') ?? ''), photoId });
    });
  };

  return (
    <section className="space-y-3">
      {approvalId && !contesting && (
        <button type="button" disabled={pending} onClick={() => run(() => acceptCharges(token, approvalId))} className={`${BUTTON} bg-pp-blue text-white`}>
          Accept {totalLabel}
        </button>
      )}
      {canContest && !contesting && (
        <button type="button" disabled={pending} onClick={() => setContesting(true)} className={`${BUTTON} border border-pp-border bg-pp-surface`}>
          Contest the charges
        </button>
      )}
      {contesting && canContest && (
        <form onSubmit={contest} className="space-y-3 rounded-lg border border-pp-border bg-pp-surface p-4">
          <p className="text-sm text-pp-muted">You can contest once. Staff will look again and can keep, lower or remove a charge, never raise it.</p>
          <label className="block">
            <span className="text-sm font-medium">Which finding? (optional)</span>
            <select name="findingId" className="mt-1 block w-full rounded border border-pp-border bg-pp-surface p-2">
              <option value="">The charges as a whole</option>
              {findings.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium">What do you disagree with?</span>
            <textarea name="note" required maxLength={500} rows={4} className="mt-1 block w-full rounded border border-pp-border bg-pp-surface p-2" />
          </label>
          <label className="block">
            <span className="text-sm font-medium">A photo of your own (optional)</span>
            <input name="photo" type="file" accept="image/*" className="mt-1 block w-full text-sm" />
          </label>
          <button disabled={pending} className={`${BUTTON} bg-pp-blue text-white`}>
            Send my contest
          </button>
          <button type="button" disabled={pending} onClick={() => setContesting(false)} className={`${BUTTON} border border-pp-border`}>
            Cancel
          </button>
        </form>
      )}
      {pending && <p role="status">Working…</p>}
      {error && (
        <p role="alert" className="text-pp-danger">
          {error}
        </p>
      )}
    </section>
  );
}
