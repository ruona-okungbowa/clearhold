'use client';

// The official PayPal JS SDK button, set to authorize in GBP: approving places a hold, it doesn't take money.
// The button renders once; it reads the panel's current choices through `input` when the renter taps it.

import { useRouter } from 'next/navigation';
import Script from 'next/script';
import { useRef, useState, type RefObject } from 'react';
import s from '../../screens.module.css';
import w from '../../wire.module.css';
import { confirmBooking, startBooking, type BookingInput } from './actions';

type Buttons = (options: object) => { render(el: HTMLElement): Promise<void> };
declare global {
  interface Window {
    paypal?: { Buttons: Buttons };
  }
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function PayPalHold({ clientId, input, disabled }: { clientId: string; input: RefObject<BookingInput>; disabled: boolean }) {
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const hireRef = useRef('');
  const [error, setError] = useState('');

  function render() {
    if (!box.current || !window.paypal || box.current.childElementCount) return;
    window.paypal
      .Buttons({
        style: { layout: 'vertical', shape: 'rect', label: 'paypal', height: 48 },
        createOrder: async () => {
          setError('');
          const started = await startBooking(input.current);
          hireRef.current = started.hireRef;
          return started.orderId;
        },
        onApprove: async ({ orderID }: { orderID: string }) => {
          const ref = await confirmBooking(input.current, hireRef.current, orderID);
          router.push(`/booked?ref=${encodeURIComponent(ref)}`);
        },
        onError: (err: unknown) => setError(message(err)),
      })
      .render(box.current);
  }

  return (
    <div>
      <Script src={`https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=GBP&intent=authorize`} onReady={render} />
      {/* Hidden, not removed, so the SDK's iframe survives a clash and comes back when the dates are fixed. */}
      <div ref={box} hidden={disabled} />
      {disabled && <p className={s.payPlaceholder}>Pick a free collection day to pay.</p>}
      {error && (
        <p role="alert" className={w.sErr}>
          {error}
        </p>
      )}
    </div>
  );
}
