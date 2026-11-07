// Plain-fetch PayPal REST client for reads, webhook verification and disputes; money movement goes through
// lib/money.ts and the PayPal SDK. Server-side only: it reads the client secret from the environment.

const BASE_URL = 'https://api-m.sandbox.paypal.com';
const MAX_ATTEMPTS = 4;

export class PayPalApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    body: string,
  ) {
    super(`PayPal ${status} on ${path}: ${body.slice(0, 300)}`);
    this.name = 'PayPalApiError';
  }
}

let cachedToken: { value: string; expiresAt: number } | undefined;

async function accessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;

  const { PAYPAL_CLIENT_ID: id, PAYPAL_SECRET: secret } = process.env;
  if (!id || !secret) throw new Error('PAYPAL_CLIENT_ID and PAYPAL_SECRET must be set (see .env.local)');

  const res = await fetch(`${BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    cache: 'no-store',
  });
  if (!res.ok) throw new PayPalApiError(res.status, '/v1/oauth2/token', await res.text());

  const { access_token, expires_in } = (await res.json()) as { access_token: string; expires_in: number };
  // Refresh a minute early so an in-flight request never carries an expired token.
  cachedToken = { value: access_token, expiresAt: Date.now() + (expires_in - 60) * 1000 };
  return access_token;
}

export async function get<T>(path: string): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { Authorization: `Bearer ${await accessToken()}` },
      cache: 'no-store',
    });
    if (res.ok) return (await res.json()) as T;

    // A revoked or expired token: drop it and mint a new one once.
    if (res.status === 401 && attempt === 1) {
      cachedToken = undefined;
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 250));
      continue;
    }
    throw new PayPalApiError(res.status, path, await res.text());
  }
}

// Asks PayPal whether a webhook delivery is genuine. `rawBody` goes in byte for byte: re-serialising
// the event can change it and fail the check.
export async function verifyWebhookSignature(
  headers: Headers,
  rawBody: string,
  webhookId: string,
): Promise<{ verified: boolean; debugId: string | null }> {
  const h = (name: string) => JSON.stringify(headers.get(name) ?? '');
  const body =
    `{"auth_algo":${h('paypal-auth-algo')},"cert_url":${h('paypal-cert-url')},` +
    `"transmission_id":${h('paypal-transmission-id')},"transmission_sig":${h('paypal-transmission-sig')},` +
    `"transmission_time":${h('paypal-transmission-time')},"webhook_id":${JSON.stringify(webhookId)},` +
    `"webhook_event":${rawBody}}`;
  const path = '/v1/notifications/verify-webhook-signature';
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body,
    cache: 'no-store',
  });
  if (!res.ok) throw new PayPalApiError(res.status, path, await res.text());
  const { verification_status } = (await res.json()) as { verification_status: string };
  return { verified: verification_status === 'SUCCESS', debugId: res.headers.get('paypal-debug-id') };
}

export type Money = { value: string; currency_code: string };

// PayPal sends amounts as decimal strings; missing amounts count as 0.
export const amountOf = (m?: Money | null) => (m?.value === undefined ? 0 : Number(m.value));

// --- Disputes ----------------------------------------------------------------------

export type Dispute = {
  dispute_id: string;
  create_time?: string;
  update_time?: string;
  reason?: string;
  status?: string;
  dispute_state?: string;
  dispute_amount?: Money;
  dispute_life_cycle_stage?: string;
  dispute_channel?: string;
  outcome?: string;
  seller_response_due_date?: string;
};

// The detail fields the list leaves out; seller_transaction_id is our capture id.
export type DisputeDetails = Dispute & { disputed_transactions?: { seller_transaction_id?: string }[] };

export const getDispute = (id: string) => get<DisputeDetails>(`/v1/customer/disputes/${encodeURIComponent(id)}`);

// Disputes page by cursor: follow the `next` link until there is none.
export async function listDisputes(): Promise<Dispute[]> {
  const disputes: Dispute[] = [];
  let path: string | undefined = '/v1/customer/disputes?page_size=50';
  while (path) {
    const res: { items?: Dispute[]; links?: { rel: string; href: string }[] } = await get(path);
    disputes.push(...(res.items ?? []));
    const next = res.links?.find((l) => l.rel === 'next')?.href;
    const url = next ? new URL(next, BASE_URL) : undefined;
    path = url && url.pathname + url.search;
  }
  return disputes;
}
