'use client';

// The counter phone's camera: one angle at a time. The shutter opens the phone's camera through a file input with
// capture="environment"; each photo is shrunk in the browser and stored straight away with the server's clock and
// SHA-256. Send checks all six are on record, then hands over (pick-up) or runs the inspector (return).

import Link from 'next/link';
import { useRef, useState, useTransition } from 'react';
import { staffUrl } from '@/app/(lab)/chrome';
import s from '@/app/(lab)/screens.module.css';
import w from '@/app/(lab)/wire.module.css';
import { finishPickup, finishReturn } from '@/app/hire/[hireRef]/actions';
import { uploadPhoto } from '@/lib/shrink';
import { ANGLES } from '@/lib/schedule';

type Stage = 'pickup' | 'return';
export type Taken = Record<string, { id: string; at: string }>;
type Angle = (typeof ANGLES)[number];

export function Capture({
  hireRef,
  stage,
  itemName,
  samples,
  stored,
  locked,
}: {
  hireRef: string;
  stage: Stage;
  itemName: string;
  samples: boolean;
  stored: Taken;
  locked: string | null;
}) {
  const [taken, setTaken] = useState<Taken>(stored);
  const [now, setNow] = useState(() => Math.max(0, ANGLES.findIndex((a) => !stored[a.id])));
  const [flash, setFlash] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState<string | null>(null);
  const [sending, startSend] = useTransition();
  const file = useRef<HTMLInputElement>(null);

  const count = ANGLES.filter((a) => taken[a.id]).length;
  const all = count === ANGLES.length;
  const angle = ANGLES[now];
  const ret = stage === 'return';
  const photo = (id: string) => `/api/photos/${id}`;

  async function store(f: File, at: Angle = angle, sample = false) {
    setBusy(at.id);
    setError(null);
    try {
      const saved = await uploadPhoto({ hireRef, stage, angle: at.id, ...(sample && { sample: '1' }) }, f, `${at.id}.jpg`);
      setTaken((t) => ({ ...t, [at.id]: { id: saved.id, at: saved.serverAt } }));
      setFlash((n) => n + 1);
      const i = ANGLES.findIndex((a, j) => j > now && a.id !== at.id && !taken[a.id]);
      if (i !== -1) setNow(i);
      return true;
    } catch (err) {
      setError(`${at.short} not stored: ${err instanceof Error ? err.message : err}. Take it again.`);
      return false;
    } finally {
      setBusy(null);
    }
  }

  // Into the shutter's own path, so the hash, server time and inspector treat it like any photo.
  async function takeSample(at: Angle) {
    const res = await fetch(`/judge/blazer/${stage}/${at.id}.jpg`).catch(() => null);
    if (!res?.ok) {
      setError(`${at.short} sample could not be loaded. Try again.`);
      return false;
    }
    const blob = await res.blob();
    return store(new File([blob], `${at.id}.jpg`, { type: blob.type }), at, true);
  }

  async function takeAllSamples() {
    for (const a of ANGLES) if (!(await takeSample(a))) return;
    setNow(ANGLES.length - 1);
  }

  const send = () =>
    startSend(async () => {
      setError(null);
      const refused = await (ret ? finishReturn : finishPickup)(hireRef).catch(() => 'Could not reach the server; try again');
      if (refused) setError(refused);
      else setSentAt(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
    });

  if (sentAt) {
    return (
      <div className={`${w.rWrap} ${s.sent}`}>
        <p className={w.kicker}>
          {hireRef} · {itemName}
        </p>
        <h1 className={`${w.rH1} ${s.sentH1}`}>{ret ? 'Handed back and checked.' : 'All six on record.'}</h1>
        <p className={w.rLead}>
          {ret
            ? 'The inspector has compared these with the pick-up photos. Nothing is taken until a person has looked at its findings.'
            : 'These are the renter’s proof of how it left the shop, and the hire fee has been taken. Any marks in them are never charged.'}
        </p>
        <p className={s.ok}>Six photos stored, each with the time it reached us. Sent at {sentAt}.</p>
        <div className={s.actions}>
          <Link href={ret ? staffUrl.approve(hireRef) : staffUrl.hire(hireRef)} className={w.block}>
            {ret ? 'Review the findings' : 'Open the hire'}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={`${w.rWrap} ${s.capLayout}`}>
      <div className={s.capSide}>
        <p className={w.kicker}>
          {hireRef} · {itemName}
        </p>
        <h1 className={`${w.rH2} ${s.capH1}`}>{ret ? 'Hand-back photos' : 'Pick-up photos'}</h1>
        <p>
          Six photos on the hanger, against a plain wall in good light. Any order, as often as you like: the last one for each
          angle is kept. {ret ? 'They’re compared with the pick-up photos.' : 'They’re the renter’s proof of how it left the shop.'}
        </p>
        <div className={s.progress} role="progressbar" aria-label="Photos taken" aria-valuemin={0} aria-valuemax={6} aria-valuenow={count}>
          <span style={{ width: `${(count / 6) * 100}%` }} />
        </div>
        <p className={s.count} aria-live="polite">
          {count} of 6 taken{all && '. Ready to send.'}
        </p>
        {locked ? (
          <p className={w.small}>{locked}</p>
        ) : (
          <button type="button" className={`${w.block} ${w.wide}`} disabled={!all || sending || busy !== null} onClick={send}>
            {sending ? (ret ? 'Checking the photos…' : 'Taking the fee…') : ret ? 'Send 6 photos and check them' : 'Send 6 photos and hand over'}
          </button>
        )}
        {samples && !locked && (
          <div className={s.sampleBtns}>
            <button
              type="button"
              className={`${w.ghost} ${w.wide}`}
              disabled={busy !== null || sending}
              aria-label={`Use sample photo (for judges): ${angle.short}`}
              onClick={() => takeSample(angle)}
            >
              Use sample photo (for judges)
            </button>
            <button type="button" className={`${w.ghost} ${w.wide}`} disabled={busy !== null || sending} onClick={takeAllSamples}>
              Use all six sample photos
            </button>
          </div>
        )}
        {error && (
          <p role="alert" className={w.sErr}>
            {error}
          </p>
        )}
        <Link href={staffUrl.hire(hireRef)} className={w.small}>
          Back to the hire
        </Link>
      </div>

      <section className={s.phone} aria-label="Camera">
        <div className={s.phoneTop}>
          <strong>{angle.short}</strong>
          <span>{now + 1} of 6</span>
        </div>
        <div className={s.viewfinder}>
          {taken[angle.id] && (
            // eslint-disable-next-line @next/next/no-img-element -- a private photo of unknown size, not for the image optimiser
            <img key={taken[angle.id].id} src={photo(taken[angle.id].id)} alt="" className={s.vfPhoto} />
          )}
          <span className={s.vfGuide} />
          <p className={s.vfHint}>{busy === angle.id ? 'Storing…' : angle.hint}</p>
          {flash > 0 && <span key={flash} className={s.vfFlash} />}
        </div>
        <input
          ref={file}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) store(f);
          }}
        />
        <div className={s.shutterRow}>
          <button type="button" className={s.textBtn} disabled={now === 0} onClick={() => setNow(now - 1)}>
            Back
          </button>
          <button
            type="button"
            className={s.shutter}
            disabled={busy !== null || Boolean(locked)}
            aria-label={`${taken[angle.id] ? 'Retake' : 'Take'} the ${angle.short.toLowerCase()} photo`}
            onClick={() => file.current?.click()}
          />
          <button type="button" className={s.textBtn} disabled={now === ANGLES.length - 1} onClick={() => setNow(now + 1)}>
            Skip
          </button>
        </div>
        <ul className={s.thumbs} aria-label="Photos taken">
          {ANGLES.map((a, i) => (
            <li key={a.id}>
              <button
                type="button"
                className={`${s.thumb} ${i === now ? s.thumbNow : ''}`}
                aria-current={i === now ? 'step' : undefined}
                aria-label={taken[a.id] ? `${a.short}: taken at ${new Date(taken[a.id].at).toLocaleTimeString('en-GB')}` : `${a.short}: not taken`}
                onClick={() => setNow(i)}
              >
                {taken[a.id] ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a private photo of unknown size, not for the image optimiser
                  <img src={photo(taken[a.id].id)} alt="" className={s.vfPhoto} />
                ) : (
                  i + 1
                )}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <ol className={s.capSteps} aria-label="Angles">
        {ANGLES.map((a, i) => (
          <li key={a.id}>
            <button
              type="button"
              className={`${s.capStep} ${i === now ? s.capStepNow : ''} ${taken[a.id] ? s.capDone : ''}`}
              onClick={() => setNow(i)}
            >
              <span className={s.capDot}>{i + 1}</span>
              <span>
                {a.short}
                <br />
                <small>
                  {taken[a.id]
                    ? `Taken ${new Date(taken[a.id].at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}, tap to retake`
                    : a.hint}
                </small>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
