import { verifyWebhookSignature } from '@/lib/paypal';

// PayPal webhook receiver. Every delivery is checked with verify-webhook-signature before anything
// trusts it; an unverified one gets a 400 and PayPal retries it. No state changes yet: the hold and
// capture tables don't exist, so a verified event is only logged.

type VerifiedEvent = { id: string; eventType: string; resourceId?: string; debugId: string | null };

// shortcut: in-memory and dev-only, so the money spike can confirm check 8; drop when events hit the database.
const verified: VerifiedEvent[] = [];

export async function POST(request: Request) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return Response.json({ error: 'PAYPAL_WEBHOOK_ID is not set' }, { status: 503 });

  if (!request.headers.get('paypal-transmission-sig')) {
    return Response.json({ error: 'Missing PayPal signature headers' }, { status: 400 });
  }
  const raw = await request.text();
  let event: { id?: string; event_type?: string; resource?: { id?: string } };
  try {
    event = JSON.parse(raw);
  } catch {
    return Response.json({ error: 'Body must be JSON' }, { status: 400 });
  }

  const { verified: ok, debugId } = await verifyWebhookSignature(request.headers, raw, webhookId);
  console.log(
    `[paypal-webhook] ${JSON.stringify({ id: event.id, eventType: event.event_type, resourceId: event.resource?.id, verified: ok, debugId })}`,
  );
  if (!ok) return Response.json({ error: 'Signature not verified' }, { status: 400 });

  verified.push({ id: event.id ?? '', eventType: event.event_type ?? '', resourceId: event.resource?.id, debugId });
  if (verified.length > 500) verified.shift();
  return Response.json({ received: true });
}

export function GET() {
  if (process.env.NODE_ENV === 'production') return new Response(null, { status: 404 });
  return Response.json(verified);
}
