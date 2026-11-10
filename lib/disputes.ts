// Answering PayPal disputes: evidence, or accepting the claim. The AI only drafts (lib/evidence-pack.ts); every function
// here that calls PayPal is reached only from a staff server action a named person clicked, and takes that person's name.
// Amounts come only from PayPal's dispute or our Capture rows, never from the browser.
// Not a 'use server' file: exported there, these would be public endpoints.

import { get as getBlob } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { pence } from './approval';
import { audit } from './audit';
import { db } from './db';
import { buildEvidencePack, validateDraft, type Draft } from './evidence-pack';
import { canDo, get, getDispute, listDisputes, post, postMultipart, PayPalApiError, type DisputeDetails } from './paypal';

export class DisputeError extends Error {
  name = 'DisputeError';
}

// PayPal's dispute-reasons table lists only OTHER (notes and documents) and PROOF_OF_REFUND (a refund id) for
// MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED. PROOF_OF_FULFILLMENT is proof of shipment and needs carrier tracking_info,
// which a counter hire doesn't have, so our photos and notes go as OTHER.
// https://developer.paypal.com/platforms/disputes/reference/dispute-reasons
export const EVIDENCE_TYPE = 'OTHER';
// PayPal: .jpg/.jpeg/.gif/.png/.pdf, each under 10 MB, 50 MB per call; ours: JPEGs only, at most 10.
// https://developer.paypal.com/platforms/disputes/reference/supported-file-types-sizes
export const MAX_FILES = 10;
const MAX_FILE_BYTES = 10_000_000 - 1;
const MAX_TOTAL_BYTES = 50_000_000;
const NOTES_MAX = 2000; // evidences[].notes maxLength in the Disputes v1 schema

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE = /\+?\d[\d ()-]{8,}\d/;

// The capture a dispute names, if it is one of ours (and this hire's, when hireRef is given).
async function captureOf(d: DisputeDetails, hireRef?: string) {
  const ids = d.disputed_transactions?.flatMap((t) => t.seller_transaction_id ?? []) ?? [];
  const captures = await db.capture.findMany({ where: { id: { in: ids } } });
  for (const c of captures) {
    const auth = await db.authorization.findUnique({ where: { id: c.authorizationId }, select: { hire: { select: { hireRef: true } } } });
    if (auth && (!hireRef || auth.hire.hireRef === hireRef)) return { capture: c, hireRef: auth.hire.hireRef };
  }
  return null;
}

// Mirrors PayPal's view of one dispute into DisputeCase. Never moves money.
export async function recordCase(d: DisputeDetails) {
  const match = await captureOf(d);
  if (!match) return null;
  const row = {
    hireRef: match.hireRef,
    captureId: match.capture.id,
    status: d.status ?? 'OTHER',
    reason: d.reason ?? null,
    amountGBP: d.dispute_amount?.currency_code === 'GBP' ? d.dispute_amount.value : null,
    outcome: d.outcome ?? null,
  };
  // A send whose answer we never saw: PayPal holding seller evidence means it landed.
  if (d.evidences?.some((e) => e.source === 'SUBMITTED_BY_SELLER'))
    await db.disputeResponse.updateMany({ where: { disputeId: d.dispute_id, kind: 'evidence', status: 'sending' }, data: { status: 'sent' } });
  return db.disputeCase.upsert({ where: { id: d.dispute_id }, create: { id: d.dispute_id, ...row }, update: row });
}

// "Refresh from PayPal": every dispute, matched and mirrored. Returns how many are ours.
export async function syncDisputes() {
  let ours = 0;
  for (const d of await listDisputes()) if (await recordCase(await getDispute(d.dispute_id))) ours++;
  return ours;
}

type Gate = { open: true } | { open: false; why: string };

// What the case page shows for one PayPal dispute on this hire, and whether each answer is open right now.
export type DisputeView = {
  id: string;
  status: string;
  reason: string | null;
  amountGBP: string | null;
  captureId: string;
  capturedGBP: string;
  live: boolean; // false: PayPal unreachable, showing our last copy
  evidence: Gate;
  accept: Gate;
};

export function evidenceGate(d: DisputeDetails): Gate {
  if (d.status !== 'WAITING_FOR_SELLER_RESPONSE') return { open: false, why: `PayPal shows ${d.status}: evidence is only taken while PayPal waits for our response` };
  if (!canDo(d, 'provide_evidence')) return { open: false, why: 'PayPal is not asking for evidence on this dispute yet: it offers no provide-evidence action' };
  return { open: true };
}

export function acceptGate(d: DisputeDetails, capturedGBP: string): Gate {
  const amount = d.dispute_amount;
  if (d.status === 'RESOLVED') return { open: false, why: 'PayPal has resolved this dispute' };
  if (!canDo(d, 'accept_claim')) return { open: false, why: 'PayPal does not offer accepting the claim right now' };
  if (!d.allowed_response_options?.accept_claim?.accept_claim_types?.includes('REFUND')) return { open: false, why: 'PayPal does not allow a full refund here' };
  if (!amount || amount.currency_code !== 'GBP') return { open: false, why: 'PayPal gives no GBP dispute amount' };
  if (pence(amount.value) > pence(capturedGBP)) return { open: false, why: `PayPal’s £${amount.value} is more than the £${capturedGBP} we captured` };
  return { open: true };
}

export async function disputesFor(hireRef: string): Promise<DisputeView[]> {
  const cases = await db.disputeCase.findMany({ where: { hireRef }, orderBy: { updatedAt: 'desc' } });
  return Promise.all(
    cases.map(async (c) => {
      const capture = await db.capture.findUniqueOrThrow({ where: { id: c.captureId } });
      const capturedGBP = capture.amountGBP.toFixed(2);
      const d = await getDispute(c.id).catch((err) => {
        console.error('[disputes] PayPal unreachable', err);
        return null;
      });
      if (d) await recordCase(d);
      const closed: Gate = { open: false, why: 'PayPal is unreachable just now' };
      return {
        id: c.id,
        status: d?.status ?? c.status,
        reason: d?.reason ?? c.reason,
        amountGBP: d?.dispute_amount?.value ?? c.amountGBP?.toFixed(2) ?? null,
        captureId: c.captureId,
        capturedGBP,
        live: Boolean(d),
        evidence: d ? evidenceGate(d) : closed,
        accept: d ? acceptGate(d, capturedGBP) : closed,
      };
    }),
  );
}

// --- Evidence ------------------------------------------------------------------------------------------

export type EvidencePlan = {
  disputeId: string;
  captureId: string;
  evidenceType: string;
  stage: string;
  notes: string;
  files: { photoId: string; name: string }[];
};

// Builds exactly what provide-evidence will send, or refuses. The confirm step shows this; the send rebuilds it the same way.
export async function planEvidence(hireRef: string, disputeId: string, paragraphs: Draft['paragraphs'], photoIds: string[]) {
  const pack = await buildEvidencePack(hireRef);
  const why = validateDraft(pack, { paragraphs, amountsGBP: [] });
  if (why) throw new DisputeError(`Draft rejected: ${why}`);

  const d = await getDispute(disputeId);
  const match = await captureOf(d, hireRef);
  if (!match) throw new DisputeError(`Dispute ${disputeId} is not on a capture of ${hireRef}`);
  const gate = evidenceGate(d);
  if (!gate.open) throw new DisputeError(gate.why);

  const notes = `${paragraphs.map((p) => p.text.trim()).join('\n\n')}\n\nPayPal capture ${match.capture.id} · Ledgerton Hire ref ${hireRef}`;
  if (notes.length > NOTES_MAX) throw new DisputeError(`The notes are ${notes.length} characters; PayPal takes at most ${NOTES_MAX}`);
  // Renter personal data stays with us: PayPal already holds the buyer's account, so nothing about them goes in the notes.
  const { renterName } = await db.hire.findUniqueOrThrow({ where: { hireRef }, select: { renterName: true } });
  const nameParts = (renterName ?? '').toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  if (nameParts.some((w) => notes.toLowerCase().includes(w))) throw new DisputeError('The notes name the renter: take the name out, PayPal already knows the buyer');
  if (EMAIL.test(notes) || PHONE.test(notes)) throw new DisputeError('The notes hold an email address or phone number: take it out');

  const ids = [...new Set(photoIds)];
  if (ids.length > MAX_FILES) throw new DisputeError(`At most ${MAX_FILES} photos`);
  const photos = await db.photo.findMany({ where: { id: { in: ids }, hire: { hireRef }, stage: { in: ['pickup', 'return'] } } });
  if (photos.length !== ids.length) throw new DisputeError('A chosen photo is not a pick-up or return photo of this hire');
  const notJpeg = photos.find((p) => p.contentType !== 'image/jpeg');
  if (notJpeg) throw new DisputeError(`The ${notJpeg.stage} ${notJpeg.angle} photo is not a JPEG`);
  const order = new Map(ids.map((id, i) => [id, i]));
  photos.sort((a, b) => order.get(a.id)! - order.get(b.id)!);

  const plan: EvidencePlan = {
    disputeId,
    captureId: match.capture.id,
    evidenceType: EVIDENCE_TYPE,
    // One answer per round: PayPal sets a new response due date each time it asks the seller again.
    stage: `${d.dispute_life_cycle_stage ?? 'STAGE'}:${d.seller_response_due_date ?? 'none'}`,
    notes,
    // PayPal's document name pattern: letters, digits, - _ , and spaces, then one extension.
    files: photos.map((p) => ({ photoId: p.id, name: `${hireRef}-${p.stage}-${p.angle}.jpg` })),
  };
  return { plan, photos };
}

async function readPhoto(pathname: string) {
  const blob = await getBlob(pathname, { access: 'private' });
  if (blob?.statusCode !== 200) throw new DisputeError('A photo could not be read from storage');
  const bytes = Buffer.from(await new Response(blob.stream).arrayBuffer());
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new DisputeError('A photo is not a JPEG');
  if (bytes.length > MAX_FILE_BYTES) throw new DisputeError('A photo is 10 MB or more; PayPal takes less than 10 MB each');
  return bytes;
}

const sameSend = (row: { notes: string; photoIds: string[] }, plan: EvidencePlan) =>
  row.notes === plan.notes && row.photoIds.join() === plan.files.map((f) => f.photoId).join();

// The send. A row is written as "sending" first: its unique (disputeId, stage) refuses a second answer to the same round,
// and a send whose outcome we never saw can only be retried unchanged, under the same PayPal-Request-Id.
export async function sendEvidence(hireRef: string, disputeId: string, paragraphs: Draft['paragraphs'], photoIds: string[], sentBy: string) {
  const { plan, photos } = await planEvidence(hireRef, disputeId, paragraphs, photoIds);
  const existing = await db.disputeResponse.findUnique({ where: { disputeId_stage: { disputeId, stage: plan.stage } } });
  if (existing?.status === 'sent') throw new DisputeError(`${existing.sentBy} already answered this round; PayPal is still reviewing it`);
  if (existing?.status === 'sending' && !sameSend(existing, plan))
    throw new DisputeError(`${existing.sentBy}’s send for this round never got an answer: press Refresh from PayPal, or retry it with the same text and photos`);

  const fresh = { sentBy, sentAt: new Date(), notes: plan.notes, photoIds: plan.files.map((f) => f.photoId), status: 'sending', paypalDebugId: null };
  const row =
    existing?.status === 'sending'
      ? existing // the same request again: PayPal replays it
      : existing // PayPal refused the last try, so nothing landed: a fresh request
        ? await db.disputeResponse.update({ where: { id: existing.id }, data: { ...fresh, requestId: `evidence-${randomUUID()}` } })
        : await db.disputeResponse
            .create({ data: { ...fresh, requestId: `evidence-${randomUUID()}`, disputeId, hireRef, kind: 'evidence', stage: plan.stage } })
            .catch((err) => {
              if (err?.code === 'P2002') throw new DisputeError('Someone else is sending a response to this round right now');
              throw err;
            });

  const files = await Promise.all(photos.map((p) => readPhoto(p.pathname)));
  if (files.reduce((n, f) => n + f.length, 0) > MAX_TOTAL_BYTES) throw new DisputeError('The photos come to more than 50 MB');
  const input = { evidences: [{ evidence_type: plan.evidenceType, notes: plan.notes }] };
  let res;
  try {
    res = await postMultipart('dispute.provideEvidence', `/v1/customer/disputes/${encodeURIComponent(disputeId)}/provide-evidence`, row.requestId, [
      { name: 'input', type: 'application/json', data: JSON.stringify(input) },
      ...files.map((data, i) => ({ name: 'evidence-file', type: 'image/jpeg', filename: plan.files[i].name, data })),
    ]);
  } catch (err) {
    // A 4xx is PayPal refusing, so nothing landed and the next try is a fresh request. Anything else stays "sending".
    if (err instanceof PayPalApiError && err.status < 500)
      await db.disputeResponse.update({ where: { id: row.id }, data: { status: 'failed', paypalDebugId: err.debugId } });
    throw err;
  }
  await db.disputeResponse.update({ where: { id: row.id }, data: { status: 'sent', paypalDebugId: res.debugId } });
  await audit({
    actor: 'human',
    type: 'dispute.evidence.sent',
    summary: `${sentBy} sent evidence (${plan.evidenceType}, ${files.length} photo(s)) to PayPal for dispute ${disputeId} on capture ${plan.captureId}`,
    status: res.status,
    paypalDebugId: res.debugId,
    idempotencyKey: row.requestId,
  });
  await getDispute(disputeId).then(recordCase, () => null);
  return { debugId: res.debugId, status: res.status };
}

// --- Accept the claim -------------------------------------------------------------------------------------

// Accepts liability with a full refund of PayPal's own dispute amount, never more than our capture. `shownGBP` is the
// amount the person confirmed on screen; if PayPal's has changed since, nothing is sent.
export async function acceptClaim(hireRef: string, disputeId: string, shownGBP: string, sentBy: string) {
  const d = await getDispute(disputeId);
  const match = await captureOf(d, hireRef);
  if (!match) throw new DisputeError(`Dispute ${disputeId} is not on a capture of ${hireRef}`);
  const capturedGBP = match.capture.amountGBP.toFixed(2);
  const gate = acceptGate(d, capturedGBP);
  if (!gate.open) throw new DisputeError(gate.why);
  const amountGBP = d.dispute_amount!.value;
  if (pence(amountGBP) !== pence(shownGBP)) throw new DisputeError(`PayPal’s amount is now £${amountGBP}, not the £${shownGBP} you confirmed: reload and check`);

  const existing = await db.disputeResponse.findUnique({ where: { disputeId_stage: { disputeId, stage: 'accept' } } });
  if (existing?.status === 'sent') throw new DisputeError(`${existing.sentBy} already accepted this claim`);
  const notes = `Ledgerton Hire accepts this claim and refunds the full £${amountGBP}.`;
  // One request id per dispute: accepting is all-or-nothing, so every retry is the same request.
  const requestId = existing?.requestId ?? `accept-${disputeId}`;
  const data = { sentBy, sentAt: new Date(), notes, photoIds: [], amountGBP, status: 'sending', paypalDebugId: null };
  const row = existing
    ? await db.disputeResponse.update({ where: { id: existing.id }, data })
    : await db.disputeResponse.create({ data: { ...data, disputeId, hireRef, kind: 'accept_claim', stage: 'accept', requestId } });

  let res;
  try {
    // accept_claim_type REFUND: PayPal refunds the whole dispute amount, and its docs say to leave refund_amount out.
    res = await post('dispute.acceptClaim', `/v1/customer/disputes/${encodeURIComponent(disputeId)}/accept-claim`, requestId, {
      note: notes,
      accept_claim_type: 'REFUND',
    });
  } catch (err) {
    if (err instanceof PayPalApiError && err.status < 500)
      await db.disputeResponse.update({ where: { id: row.id }, data: { status: 'failed', paypalDebugId: err.debugId } });
    throw err;
  }
  await db.disputeResponse.update({ where: { id: row.id }, data: { status: 'sent', paypalDebugId: res.debugId } });
  await db.hire.update({ where: { hireRef }, data: { refundedViaDisputeAt: new Date() } });
  await audit({
    actor: 'human',
    type: 'dispute.claim.accepted',
    summary: `${sentBy} accepted PayPal dispute ${disputeId}: refund of £${amountGBP} on capture ${match.capture.id} (captured £${capturedGBP})`,
    status: res.status,
    paypalDebugId: res.debugId,
    idempotencyKey: requestId,
  });
  // Our copies of the capture and the case, read back from PayPal; a failed read leaves them for the next refresh.
  await get<{ status?: string }>(`/v2/payments/captures/${encodeURIComponent(match.capture.id)}`)
    .then(async (c) => {
      if (c.status) await db.capture.update({ where: { id: match.capture.id }, data: { status: c.status } });
    })
    .catch((err) => console.error('[disputes] capture read failed', err));
  await getDispute(disputeId).then(recordCase, () => null);
  return { debugId: res.debugId, status: res.status, amountGBP };
}
