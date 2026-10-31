// Money service: the only code that moves deposit money. Orders v2 (AUTHORIZE) and Payments v2
// through @paypal/paypal-server-sdk. Every money call carries a caller-chosen PayPal-Request-Id, so
// a retry with the same id is a replay, never a second charge, and every call is written to the AuditEvent
// table with its paypal-debug-id. Captures also need a signed approval (see capture).
// Server-side only: it reads the client secret from the environment.

import {
  ApiError,
  CheckoutPaymentIntent,
  Client,
  Environment,
  OrdersController,
  PaymentsController,
  type ApiResponse,
} from '@paypal/paypal-server-sdk';
import { claimApproval, releaseApproval } from './approval';
import { audit } from './audit';

let controllers: { orders: OrdersController; payments: PaymentsController } | undefined;

function api() {
  if (controllers) return controllers;
  const { PAYPAL_CLIENT_ID: id, PAYPAL_SECRET: secret } = process.env;
  if (!id || !secret) throw new Error('PAYPAL_CLIENT_ID and PAYPAL_SECRET must be set (see .env.local)');
  const client = new Client({
    clientCredentialsAuthCredentials: { oAuthClientId: id, oAuthClientSecret: secret },
    environment: Environment.Sandbox,
    timeout: 30_000,
  });
  controllers = { orders: new OrdersController(client), payments: new PaymentsController(client) };
  return controllers;
}

export class MoneyError extends Error {
  constructor(
    readonly op: string,
    readonly status: number,
    readonly issue: string | undefined,
    readonly debugId: string | undefined,
    body: string,
  ) {
    super(`PayPal ${status}${issue ? ` ${issue}` : ''} on ${op} (debug id ${debugId ?? 'none'}): ${body.slice(0, 300)}`);
    this.name = 'MoneyError';
  }
}

export type CallLog = { op: string; requestId?: string; status: number; debugId?: string; issue?: string };

// Extra sinks for each call log (the spike collects debug ids per check).
export const callListeners: ((entry: CallLog) => void)[] = [];

async function logCall(entry: CallLog, latencyMs: number) {
  console.log(`[paypal] ${JSON.stringify(entry)}`);
  for (const listen of callListeners) listen(entry);
  await audit({
    actor: 'paypal',
    type: entry.op,
    summary: `${entry.op} ${entry.status}${entry.issue ? ` ${entry.issue}` : ''}`,
    status: entry.status,
    paypalDebugId: entry.debugId,
    idempotencyKey: entry.requestId,
    latencyMs,
  });
}

async function call<T>(op: string, requestId: string | undefined, run: () => Promise<ApiResponse<T>>): Promise<T> {
  const started = Date.now();
  try {
    const res = await run();
    await logCall({ op, requestId, status: res.statusCode, debugId: res.headers['paypal-debug-id'] }, Date.now() - started);
    return res.result;
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    const body = typeof err.body === 'string' ? err.body : '';
    let issue: string | undefined;
    try {
      const parsed = JSON.parse(body) as { name?: string; details?: { issue?: string }[] };
      issue = parsed.details?.[0]?.issue ?? parsed.name;
    } catch {}
    const debugId = err.headers?.['paypal-debug-id'];
    await logCall({ op, requestId, status: err.statusCode, debugId, issue }, Date.now() - started);
    throw new MoneyError(op, err.statusCode, issue, debugId, body);
  }
}

const gbp = (value: string) => ({ currencyCode: 'GBP', value });
const full = 'return=representation';

// One order per hire: fee plus deposit, held, not charged.
export function createHoldOrder(requestId: string, total: string, referenceId: string) {
  return call('createOrder', requestId, () =>
    api().orders.createOrder({
      paypalRequestId: requestId,
      prefer: full,
      body: {
        intent: CheckoutPaymentIntent.Authorize,
        purchaseUnits: [{ referenceId, amount: gbp(total) }],
      },
    }),
  );
}

// Reads need no request id; they still log their debug id.
export const getOrder = (orderId: string) => call('getOrder', undefined, () => api().orders.getOrder({ id: orderId }));

export const getAuthorization = (authorizationId: string) =>
  call('getAuthorization', undefined, () => api().payments.getAuthorizedPayment({ authorizationId }));

// After the buyer approves: places the hold; the authorization sits in purchaseUnits[0].payments.
export function authorizeOrder(requestId: string, orderId: string) {
  return call('authorizeOrder', requestId, () =>
    api().orders.authorizeOrder({ id: orderId, paypalRequestId: requestId, prefer: full }),
  );
}

// Every capture needs a signed approval (lib/approval.ts): valid, unexpired, unused, and covering the amount.
// The approval names the hold and whether this is the final capture: false keeps the rest of the hold open
// (fee at pick-up); true releases what is left. The request id comes from the approval, so a retry after a
// PayPal failure replays instead of charging twice.
export async function capture(approvalToken: string, amount: string) {
  let approval;
  try {
    approval = await claimApproval(approvalToken, amount);
  } catch (err) {
    await audit({ actor: 'system', type: 'capture.refused', summary: `Refused £${amount}: ${err instanceof Error ? err.message : err}` });
    throw err;
  }
  const { id, authorizationId, finalCapture } = approval;
  try {
    const result = await call('capture', `capture-${id}`, () =>
      api().payments.captureAuthorizedPayment({
        authorizationId,
        paypalRequestId: `capture-${id}`,
        prefer: full,
        body: { amount: gbp(amount), finalCapture },
      }),
    );
    return { ...result, approvalId: id, authorizationId, finalCapture };
  } catch (err) {
    await releaseApproval(id);
    throw err;
  }
}

export function voidHold(requestId: string, authorizationId: string) {
  return call('void', requestId, () =>
    api().payments.voidPayment({ authorizationId, paypalRequestId: requestId, prefer: full }),
  );
}

// Valid only after the 3-day honour period; returns a new authorization id.
export function reauthorize(requestId: string, authorizationId: string, amount: string) {
  return call('reauthorize', requestId, () =>
    api().payments.reauthorizePayment({
      authorizationId,
      paypalRequestId: requestId,
      prefer: full,
      body: { amount: gbp(amount) },
    }),
  );
}
