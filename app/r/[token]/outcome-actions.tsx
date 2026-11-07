'use client';

// Accept, or the one contest: a note, optionally a finding and one photo. The photo goes up first through the
// photo route, signed with the renter's link, and the contest then names it.

import { useState, useTransition, type FormEvent } from 'react';
import w from '@/app/(lab)/wire.module.css';
import s from '@/app/(lab)/screens.module.css';
import { uploadPhoto } from '@/lib/shrink';
import { acceptCharges, contestCharges } from './actions';

export function OutcomeActions({
  token,
  hireRef,
  approvalId,
  total,
  replyBy,
  canContest,
  findings,
}: {
  token: string;
  hireRef: string;
  approvalId: string;
  total: string;
  replyBy: string;
  canContest: boolean;
  findings: { id: string; label: string }[];
}) {
  const [contesting, setContesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
        try {
          photoId = (await uploadPhoto({ hireRef, stage: 'contest', t: token }, file, 'contest.jpg')).id;
        } catch (err) {
          return `Photo not stored: ${err instanceof Error ? err.message : err}`;
        }
      }
      return contestCharges(token, { findingId: String(form.get('findingId') ?? '') || null, note: String(form.get('note') ?? ''), photoId });
    });
  };

  if (contesting && canContest) {
    return (
      <form className={s.contestForm} onSubmit={contest}>
        <h2 className={w.rH3}>Contest the charge</h2>
        <p className={w.small}>You can do this once. We’ll look again and can keep, lower or remove the charge, never raise it.</p>
        <label className={w.field}>
          <span>Which part?</span>
          <select name="findingId" className={w.select} defaultValue={findings[0]?.id ?? ''}>
            {findings.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
            <option value="">The charges as a whole</option>
          </select>
        </label>
        <label className={w.field}>
          <span>What do you disagree with?</span>
          <textarea name="note" className={w.textarea} required maxLength={500} />
        </label>
        <label className={w.field}>
          <span>Add a photo (optional)</span>
          <input name="photo" type="file" accept="image/*" />
        </label>
        <button type="submit" className={`${w.block} ${w.wide}`} disabled={pending}>
          {pending ? 'Sending…' : 'Send to the shop'}
        </button>
        <button type="button" className={`${w.ghost} ${w.wide}`} disabled={pending} onClick={() => setContesting(false)}>
          Cancel
        </button>
        {error && (
          <p role="alert" className={w.sErr}>
            {error}
          </p>
        )}
      </form>
    );
  }

  return (
    <>
      <button type="button" className={`${w.block} ${w.wide}`} disabled={pending} onClick={() => run(() => acceptCharges(token, approvalId))}>
        {pending ? 'Working…' : `Accept ${total}`}
      </button>
      {canContest && (
        <button type="button" className={`${w.ghost} ${w.wide}`} disabled={pending} onClick={() => setContesting(true)}>
          Contest this charge
        </button>
      )}
      <p className={w.small}>Reply by {replyBy}. Until then, nothing is taken. If we don’t hear from you by then, the shop takes the {total}.</p>
      {error && (
        <p role="alert" className={w.sErr}>
          {error}
        </p>
      )}
    </>
  );
}
