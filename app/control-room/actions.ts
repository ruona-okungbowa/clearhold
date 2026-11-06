'use server';

import type { AgReportState } from 'ag-studio';
import { approveCharges, setAmount, settleHire } from '@/app/hire/[hireRef]/actions';
import { db } from '@/lib/db';
import { refusal } from '@/lib/refusal';
import { CONTROL_ROOM_LAYOUT } from './saved-layout';

const MAX_STATE_BYTES = 512_000;

export async function lowerFinding(hireRef: string, findingId: string, form: FormData) {
  return refusal(setAmount(hireRef, findingId, form));
}

export async function approveHire(hireRef: string) {
  return refusal(approveCharges(hireRef));
}

export async function settleApproved(hireRef: string) {
  return refusal(settleHire(hireRef));
}

// Stores api.getState() as the control room's layout. No auth yet: anyone who can reach the app can save.
export async function saveLayout(state: AgReportState): Promise<void> {
  // Reachable by direct POST, so check the shape before storing it.
  if (typeof state !== 'object' || state === null || !Array.isArray((state as { pages?: unknown }).pages)) {
    throw new Error('Layout is not a Studio state object');
  }
  const json = JSON.stringify(state);
  if (json.length > MAX_STATE_BYTES) throw new Error('Layout is too large to save');

  const data = JSON.parse(json);
  await db.studioLayout.upsert({
    where: { name: CONTROL_ROOM_LAYOUT },
    create: { name: CONTROL_ROOM_LAYOUT, state: data },
    update: { state: data },
  });
}
