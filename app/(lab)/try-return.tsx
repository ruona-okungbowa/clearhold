'use client';

// A hold meter over a fixed £88 (fee £28 + deposit £60) for four ways the blazer can come back.
import { useState } from 'react';
import l from './landing.module.css';
import w from './wire.module.css';

type Kind = 'taken' | 'contested' | 'held' | 'released';
type Part = { kind: Kind; label: string; gbp: number };

const OUTCOMES: { id: string; label: string; parts: Part[]; lead: string; line: string }[] = [
  {
    id: 'booked', label: 'Just booked',
    parts: [{ kind: 'held', label: 'Held', gbp: 88 }],
    lead: '£28 to hire, that’s it',
    line: 'The hire fee is taken when you pick the blazer up. The deposit is only held on PayPal.',
  },
  {
    id: 'clean', label: 'Clean return',
    parts: [{ kind: 'taken', label: 'Fee taken', gbp: 28 }, { kind: 'released', label: 'Released', gbp: 60 }],
    lead: 'Nothing more to pay',
    line: 'Nothing new in the photos. A few creases and some lint are just wear, and wear is on us.',
  },
  {
    id: 'old', label: 'An old mark',
    parts: [{ kind: 'taken', label: 'Fee taken', gbp: 28 }, { kind: 'released', label: 'Released', gbp: 60 }],
    lead: 'Not yours, nothing to pay',
    line: 'That faint cuff mark was there before you. It’s on the blazer’s record, so it’s never yours to pay for.',
  },
  {
    id: 'stain', label: 'A new stain',
    parts: [
      { kind: 'taken', label: 'Fee taken', gbp: 28 },
      { kind: 'contested', label: 'Charge, open to contest', gbp: 24 },
      { kind: 'held', label: 'Held, coming back', gbp: 36 },
    ],
    lead: '£24 for a specialist clean',
    line: 'A new lapel mark. You see both photos and the price list first, and you can push back once.',
  },
];

export function TryReturn() {
  const [id, setId] = useState('stain');
  const o = OUTCOMES.find((x) => x.id === id)!;

  return (
    <div className={l.try}>
      <fieldset className={l.tryChoices}>
        <legend>Wedding’s over. How did the blazer come back?</legend>
        {OUTCOMES.map((x) => (
          <label key={x.id} className={l.tryChoice}>
            <input type="radio" name="try-return" value={x.id} checked={x.id === id} onChange={() => setId(x.id)} />
            <span>{x.label}</span>
          </label>
        ))}
      </fieldset>
      <div aria-live="polite" className={l.tryResult}>
        <p className={`${l.tryLead} ${w.num}`}>{o.lead}</p>
        <div
          className={`${w.meter} ${l.meterBar}`}
          role="img"
          aria-label={`${o.parts.map((p) => `${p.label} £${p.gbp}`).join(', ')} of £88`}
        >
          {o.parts.map((p) => (
            <span key={p.kind} className={w[p.kind]} style={{ flexGrow: p.gbp }} />
          ))}
        </div>
        <ul className={w.meterKey}>
          {o.parts.map((p) => (
            <li key={p.kind}>
              <span className={`${w.sw} ${w[p.kind]}`} />
              {p.label}
              <strong className={w.num}>£{p.gbp}</strong>
            </li>
          ))}
        </ul>
        <p className={l.tryLine}>{o.line}</p>
      </div>
    </div>
  );
}
