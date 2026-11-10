'use server';

// Staff actions on a dispute case. The AI draft: only the evidence pack goes to the model, and the draft only comes back if
// every citation and amount checks out against that pack; the model gets no tool and calls nothing. The rest are a named
// person's clicks: each one checks the staff session first, takes the name from it, and only then lets lib/disputes.ts
// call PayPal. Every input is parsed here, because a server action is reachable by a direct POST.

import { refresh } from 'next/cache';
import { z } from 'zod';
import { audit, auditScope } from '@/lib/audit';
import { acceptClaim, DisputeError, MAX_FILES, planEvidence, sendEvidence, syncDisputes, type EvidencePlan } from '@/lib/disputes';
import { buildEvidencePack, Draft, draftResponse, validateDraft } from '@/lib/evidence-pack';
import { PayPalApiError } from '@/lib/paypal';
import { requireStaff } from '@/lib/staff';

const Ref = z.string().min(1).max(40);
const DisputeId = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);
const Paragraphs = Draft.shape.paragraphs.min(1).max(12);
const PhotoIds = z.array(z.string().min(1).max(40)).max(MAX_FILES);
const Gbp = z.string().regex(/^\d+(\.\d{1,2})?$/);

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

// Refusals the person can act on are shown as they are; anything else is logged and summarised.
function failure(err: unknown): { ok: false; error: string } {
  if (err instanceof DisputeError) return { ok: false, error: err.message };
  if (err instanceof PayPalApiError) return { ok: false, error: `PayPal refused (${err.status}${err.debugId ? `, debug id ${err.debugId}` : ''}). Nothing was recorded as sent.` };
  if (err instanceof z.ZodError) return { ok: false, error: 'That request was not valid.' };
  console.error('[disputes]', err);
  return { ok: false, error: 'Something went wrong and PayPal’s answer is unknown. Refresh from PayPal before trying again.' };
}

export async function draftDisputeResponse(hireRef: string): Promise<{ draft: Draft } | { rejected: string }> {
  await requireStaff();
  const ref = Ref.parse(hireRef);
  return auditScope.run(ref, async () => {
    const pack = await buildEvidencePack(ref);
    const draft = await draftResponse(pack).catch((err) => {
      console.error('[disputes] draft failed', err);
      return null;
    });
    const why = draft ? validateDraft(pack, draft) : 'the model call failed';
    if (why || !draft) {
      await audit({ actor: 'system', type: 'dispute.draft.rejected', summary: `Draft rejected: ${why}` });
      return { rejected: why ?? 'no draft' };
    }
    return { draft };
  });
}

// The confirm step: validates the edited draft and shows exactly what would go to PayPal. Sends nothing.
export async function previewEvidence(hireRef: string, disputeId: string, paragraphs: Draft['paragraphs'], photoIds: string[]): Promise<Result<{ plan: EvidencePlan }>> {
  await requireStaff();
  try {
    const { plan } = await planEvidence(Ref.parse(hireRef), DisputeId.parse(disputeId), Paragraphs.parse(paragraphs), PhotoIds.parse(photoIds));
    return { ok: true, plan };
  } catch (err) {
    return failure(err);
  }
}

export async function sendEvidenceToPayPal(hireRef: string, disputeId: string, paragraphs: Draft['paragraphs'], photoIds: string[]): Promise<Result<{ debugId: string | null }>> {
  const name = await requireStaff();
  const ref = Ref.parse(hireRef);
  const result = await auditScope.run(ref, async () => {
    try {
      const { debugId } = await sendEvidence(ref, DisputeId.parse(disputeId), Paragraphs.parse(paragraphs), PhotoIds.parse(photoIds), name);
      return { ok: true as const, debugId };
    } catch (err) {
      await audit({ actor: 'system', type: 'dispute.evidence.refused', summary: `Evidence for ${disputeId} not sent (${name}): ${err instanceof Error ? err.message.slice(0, 200) : err}` });
      return failure(err);
    }
  });
  refresh();
  return result;
}

export async function acceptClaimAndRefund(hireRef: string, disputeId: string, shownGBP: string): Promise<Result<{ debugId: string | null; amountGBP: string }>> {
  const name = await requireStaff();
  const ref = Ref.parse(hireRef);
  const result = await auditScope.run(ref, async () => {
    try {
      const { debugId, amountGBP } = await acceptClaim(ref, DisputeId.parse(disputeId), Gbp.parse(shownGBP), name);
      return { ok: true as const, debugId, amountGBP };
    } catch (err) {
      await audit({ actor: 'system', type: 'dispute.accept.refused', summary: `Accepting ${disputeId} not sent (${name}): ${err instanceof Error ? err.message.slice(0, 200) : err}` });
      return failure(err);
    }
  });
  refresh();
  return result;
}

// Reads PayPal and updates our case status only. Moves no money.
export async function refreshFromPayPal(): Promise<Result<{ ours: number }>> {
  await requireStaff();
  try {
    const ours = await syncDisputes();
    refresh();
    return { ok: true, ours };
  } catch (err) {
    return failure(err);
  }
}
