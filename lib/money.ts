// Money service: the only code that moves deposit money. Orders v2 (AUTHORIZE) and Payments v2
// through @paypal/paypal-server-sdk. Every money call carries a caller-chosen PayPal-Request-Id, so
// a retry with the same id is a replay, never a second charge, and every call logs its paypal-debug-id.
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

// shortcut: logs to stdout only, move to the audit table once the database exists.
function logCall(entry: CallLog) {
  console.log(`[paypal] ${JSON.stringify(entry)}`);
  for (const listen of callListeners) listen(entry);
}

async function call<T>(op: string, requestId: string | undefined, run: () => Promise<ApiResponse<T>>): Promise<T> {
  try {
    const res = await run();
    logCall({ op, requestId, status: res.statusCode, debugId: res.headers['paypal-debug-id'] });
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
    logCall({ op, requestId, status: err.statusCode, debugId, issue });
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

// finalCapture false keeps the rest of the hold open (fee at pick-up); true releases what is left.
export function capture(requestId: string, authorizationId: string, amount: string, finalCapture: boolean) {
  return call('capture', requestId, () =>
    api().payments.captureAuthorizedPayment({
      authorizationId,
      paypalRequestId: requestId,
      prefer: full,
      body: { amount: gbp(amount), finalCapture },
    }),
  );
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
