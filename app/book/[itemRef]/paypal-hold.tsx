'use client';

// The official PayPal JS SDK button, set to authorize in GBP: approving places a hold, it doesn't take money.

import { useRouter } from 'next/navigation';
import Script from 'next/script';
import { useRef, useState } from 'react';
import { confirmBooking, startBooking } from './actions';

type Buttons = (options: object) => { render(el: HTMLElement): Promise<void> };
declare global {
  interface Window {
    paypal?: { Buttons: Buttons };
  }
}

export function PayPalHold({ clientId, itemRef }: { clientId: string; itemRef: string }) {
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const hireRef = useRef('');
  const [error, setError] = useState('');

  function render() {
    if (!box.current || !window.paypal || box.current.childElementCount) return;
    window.paypal
      .Buttons({
        createOrder: async () => {
          const started = await startBooking(itemRef);
          hireRef.current = started.hireRef;
          return started.orderId;
        },
        onApprove: async ({ orderID }: { orderID: string }) => {
          const ref = await confirmBooking(itemRef, hireRef.current, orderID);
          router.push(`/hire/${ref}`);
        },
        onError: (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
      })
      .render(box.current);
  }

  return (
    <>
      <Script
        src={`https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=GBP&intent=authorize`}
        onReady={render}
      />
      <div ref={box} />
      {error && <p role="alert">Something went wrong: {error}</p>}
    </>
  );
}
