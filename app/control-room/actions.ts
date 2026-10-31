'use server';

import type { AgReportState } from 'ag-studio';
import { db } from '@/lib/db';
import { CONTROL_ROOM_LAYOUT } from './saved-layout';

const MAX_STATE_BYTES = 512_000;

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
