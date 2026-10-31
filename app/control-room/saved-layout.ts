import type { AgReportState } from 'ag-studio';
import { db } from '@/lib/db';

// The StudioLayout row the control room saves to and loads from.
export const CONTROL_ROOM_LAYOUT = 'control-room';

export async function getSavedLayout(): Promise<AgReportState | null> {
  const row = await db.studioLayout.findUnique({ where: { name: CONTROL_ROOM_LAYOUT } });
  return (row?.state as AgReportState | undefined) ?? null;
}
