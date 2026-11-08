import type { AgReportState } from 'ag-studio';
import { db } from '@/lib/db';

export type LayoutRole = 'ops' | 'branch';

export const LAYOUT_ROLE_COOKIE = 'clearhold_layout_role';
export const layoutName = (role: LayoutRole) => `control-room:${role}`;

// The single layout from before roles. It's left in place: Ops reads it until Ops first saves its own.
const LEGACY_LAYOUT = 'control-room';

export async function getSavedLayouts(): Promise<Record<LayoutRole, AgReportState | null>> {
  const rows = await db.studioLayout.findMany({ where: { name: { in: [layoutName('ops'), layoutName('branch'), LEGACY_LAYOUT] } } });
  const state = (name: string) => (rows.find((r) => r.name === name)?.state as AgReportState | undefined) ?? null;
  return { ops: state(layoutName('ops')) ?? state(LEGACY_LAYOUT), branch: state(layoutName('branch')) };
}
