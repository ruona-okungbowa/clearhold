'use client';

// A person's amount on one finding. The AI's charge can only go down (0 waives it, Restore clears the person's
// amount); an owner look takes an amount inside its clause's band, blank for none. The server (setAmount, through
// lib/inspector.ts personPence) applies the same rules, so this only says no sooner.

import { useState, useTransition } from 'react';
import st from '@/app/(lab)/staff.module.css';
import w from '@/app/(lab)/wire.module.css';
import { setAmountAction } from '../actions';

export function AmountField({
  hireRef,
  findingId,
  charge,
  proposed,
  set,
  band,
  locked,
}: {
  hireRef: string;
  findingId: string;
  charge: boolean;
  proposed: number | null;
  set: number | null;
  band: [number, number];
  locked: boolean;
}) {
  const [value, setValue] = useState(set === null ? (charge && proposed !== null ? proposed.toFixed(2) : '') : set.toFixed(2));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const n = value.trim() === '' ? null : Number(value);
  const bad = n !== null && (!Number.isFinite(n) || n < 0 || (charge && proposed !== null && n > proposed));
  const id = `amt-${findingId}`;

  const save = (entered: string) =>
    start(async () => {
      setError(await setAmountAction(hireRef, findingId, entered).catch(() => 'Could not reach the server; try again'));
    });

  const help = charge
    ? bad
      ? `You can lower the AI’s amount, not raise it. £${proposed?.toFixed(2)} is the most.`
      : n !== null && proposed !== null && n < proposed
        ? `AI proposed £${proposed.toFixed(2)}; you’re lowering it to £${n.toFixed(2)}.`
        : `AI proposed £${proposed?.toFixed(2)}.`
    : `Below 0.75 confidence there’s no default charge. Leave it blank for no charge (£${band[0]}–£${band[1]}).`;

  return (
    <div className={st.fBody}>
      <div className={st.amtRow}>
        <label className={`${w.sField} ${st.amtField}`} htmlFor={id}>
          <span>{charge ? `Charge (up to £${proposed?.toFixed(2)})` : `Amount, if any (£${band[0]}–£${band[1]})`}</span>
          <span className={st.amtPre}>
            <input
              id={id}
              className={w.sInput}
              inputMode="decimal"
              placeholder={charge ? undefined : 'No charge'}
              value={value}
              disabled={locked || pending}
              aria-invalid={bad || undefined}
              aria-describedby={`${id}-help`}
              onChange={(e) => setValue(e.target.value)}
            />
          </span>
        </label>
        <button type="button" className={w.btn} disabled={locked || pending || bad} onClick={() => save(value.trim())}>
          {pending ? 'Saving…' : 'Save'}
        </button>
        {charge && (
          <>
            <button
              type="button"
              className={w.btnGhost}
              disabled={locked || pending}
              onClick={() => {
                setValue('0.00');
                save('0');
              }}
            >
              Waive
            </button>
            <button
              type="button"
              className={w.btnGhost}
              disabled={locked || pending || set === null}
              onClick={() => {
                setValue(proposed?.toFixed(2) ?? '');
                save('');
              }}
            >
              Restore £{proposed?.toFixed(2)}
            </button>
          </>
        )}
      </div>
      <div id={`${id}-help`}>
        <p className={bad ? w.sErr : w.sSub}>{help}</p>
        {error && (
          <p role="alert" className={w.sErr}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
