import { audit } from '@/lib/audit';
import { recordCase } from '@/lib/disputes';
import { getDispute, verifyWebhookSignature } from '@/lib/paypal';

// PayPal webhook receiver. Every delivery is checked with verify-webhook-signature before anything trusts it; an
// unverified one gets a 400 and PayPal retries it. Dispute events (created, updated, resolved) update our DisputeCase
// status only: the payload just names the dispute, and its status is read back from PayPal's API. Nothing here moves
// money or answers a dispute; that takes a person on the case page. Other verified events are only logged.

type VerifiedEvent = { id: string; eventType: string; resourceId?: string; debugId: string | null };

// shortcut: in-memory and dev-only, so the money spike can confirm check 8; drop it once that check reads AuditEvent.
const verified: VerifiedEvent[] = [];

const DISPUTE_EVENTS = new Set(['CUSTOMER.DISPUTE.CREATED', 'CUSTOMER.DISPUTE.UPDATED', 'CUSTOMER.DISPUTE.RESOLVED']);

export async function POST(request: Request) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return Response.json({ error: 'PAYPAL_WEBHOOK_ID is not set' }, { status: 503 });

  if (!request.headers.get('paypal-transmission-sig')) {
    return Response.json({ error: 'Missing PayPal signature headers' }, { status: 400 });
  }
  const raw = await request.text();
  let event: { id?: string; event_type?: string; resource?: { id?: string; dispute_id?: string } };
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

  if (DISPUTE_EVENTS.has(event.event_type ?? '') && event.resource?.dispute_id) {
    try {
      const recorded = await recordCase(await getDispute(event.resource.dispute_id));
      await audit({
        actor: 'paypal',
        type: 'webhook.dispute',
        hireRef: recorded?.hireRef,
        summary: `${event.event_type} for ${event.resource.dispute_id}: ${recorded ? `status ${recorded.status}` : 'not one of ours'}`,
        paypalDebugId: debugId,
        idempotencyKey: event.id,
      });
    } catch (err) {
      // PayPal retries a non-2xx delivery, so a failed read is picked up later.
      console.error('[paypal-webhook] dispute sync failed', err);
      return Response.json({ error: 'Could not read the dispute from PayPal' }, { status: 503 });
    }
  }

  verified.push({ id: event.id ?? '', eventType: event.event_type ?? '', resourceId: event.resource?.id, debugId });
  if (verified.length > 500) verified.shift();
  return Response.json({ received: true });
}

export function GET() {
  if (process.env.NODE_ENV === 'production') return new Response(null, { status: 404 });
  return Response.json(verified);
}
