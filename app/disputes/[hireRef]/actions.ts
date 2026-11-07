'use server';

// The AI draft of a dispute response: only the evidence pack goes to the model, and the draft only comes back if every
// citation and amount checks out against that pack. Nothing here calls PayPal; staff copy the draft and submit it themselves.

import { z } from 'zod';
import { audit, auditScope } from '@/lib/audit';
import { buildEvidencePack, draftResponse, validateDraft, type Draft } from '@/lib/evidence-pack';
import { requireStaff } from '@/lib/staff';

export async function draftDisputeResponse(hireRef: string): Promise<{ draft: Draft } | { rejected: string }> {
  await requireStaff();
  const ref = z.string().min(1).max(40).parse(hireRef); // reachable by direct POST
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
