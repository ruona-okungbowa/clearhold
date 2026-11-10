// Plain-fetch PayPal REST client for reads, webhook verification and disputes. Deposit captures go through
// lib/money.ts and the PayPal SDK; the dispute writes here (post, postMultipart) follow its rules: a caller-chosen
// PayPal-Request-Id, the paypal-debug-id kept, and an AuditEvent row per call. Only server actions a signed-in person
// clicked call them (app/disputes/[hireRef]/actions.ts); the model gets no tool and no route to them.
// Server-side only: it reads the client secret from the environment.

import { audit } from './audit';

const BASE_URL = 'https://api-m.sandbox.paypal.com';
const MAX_ATTEMPTS = 4;

export class PayPalApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    body: string,
    readonly debugId?: string | null,
  ) {
    super(`PayPal ${status} on ${path}${debugId ? ` (debug id ${debugId})` : ''}: ${body.slice(0, 300)}`);
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

export type Sent<T> = { result: T; status: number; debugId: string | null };

// A write: the same retries as get(), with one PayPal-Request-Id across every attempt, so a retry is a replay at PayPal.
async function send<T>(op: string, path: string, requestId: string, body: BodyInit, type: string): Promise<Sent<T>> {
  const started = Date.now();
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await accessToken()}`, 'PayPal-Request-Id': requestId, 'Content-Type': type },
      body,
      cache: 'no-store',
    });
    if (res.status === 401 && attempt === 1) {
      cachedToken = undefined;
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 250));
      continue;
    }
    const debugId = res.headers.get('paypal-debug-id');
    const text = await res.text();
    let issue: string | undefined;
    if (!res.ok)
      try {
        const parsed = JSON.parse(text) as { name?: string; details?: { issue?: string }[] };
        issue = parsed.details?.[0]?.issue ?? parsed.name;
      } catch {}
    console.log(`[paypal] ${JSON.stringify({ op, requestId, status: res.status, debugId, issue })}`);
    await audit({
      actor: 'paypal',
      type: op,
      summary: `${op} ${res.status}${issue ? ` ${issue}` : ''}`,
      status: res.status,
      paypalDebugId: debugId,
      idempotencyKey: requestId,
      latencyMs: Date.now() - started,
    });
    if (!res.ok) throw new PayPalApiError(res.status, path, text, debugId);
    return { result: (text ? JSON.parse(text) : {}) as T, status: res.status, debugId };
  }
}

export const post = <T>(op: string, path: string, requestId: string, body: unknown) =>
  send<T>(op, path, requestId, JSON.stringify(body), 'application/json');

export type Part = { name: string; type: string; data: string | Buffer; filename?: string };

// multipart/form-data built by hand, as PayPal's curl examples send it: the JSON part has a content type and no
// filename (FormData would give a Blob part filename="blob"), each file part has its own name.
export function postMultipart<T>(op: string, path: string, requestId: string, parts: Part[]) {
  const boundary = `clearhold-${requestId.replace(/[^A-Za-z0-9]/g, '')}`;
  const CRLF = '\r\n';
  const body = Buffer.concat([
    ...parts.flatMap((p) => [
      Buffer.from(
        `--${boundary}${CRLF}Content-Disposition: form-data; name="${p.name}"${p.filename ? `; filename="${p.filename}"` : ''}${CRLF}` +
          `Content-Type: ${p.type}${CRLF}${CRLF}`,
      ),
      Buffer.isBuffer(p.data) ? p.data : Buffer.from(p.data),
      Buffer.from(CRLF),
    ]),
    Buffer.from(`--${boundary}--${CRLF}`),
  ]);
  return send<T>(op, path, requestId, new Uint8Array(body), `multipart/form-data; boundary=${boundary}`);
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

// The detail fields the list leaves out; seller_transaction_id is our capture id. `links` holds the actions PayPal
// allows right now (provide_evidence, accept_claim, ...): no link, no action.
export type DisputeDetails = Dispute & {
  disputed_transactions?: { seller_transaction_id?: string }[];
  links?: { rel: string; href: string; method?: string }[];
  evidences?: { evidence_type?: string; source?: string; date?: string }[];
  allowed_response_options?: { accept_claim?: { accept_claim_types?: string[] } };
};

export const canDo = (d: DisputeDetails, rel: string) => Boolean(d.links?.some((l) => l.rel === rel));

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
