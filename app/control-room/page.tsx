import type { Metadata } from 'next';
import { connection } from 'next/server';
import { staffUrl, StaffPage } from '@/app/(lab)/chrome';
import { type Box } from '@/app/(lab)/evidence';
import { SHOPS } from '@/lib/catalogue';
import { ANGLES } from '@/lib/schedule';
import { loadHires, type HireView } from '@/lib/staff-view';
import { Room, type Kpi, type RoomRow } from './room';

export const metadata: Metadata = { title: 'Control room' };

const DAY = 86_400_000;
const gbp = (pence: number) => `£${Math.round(pence / 100).toLocaleString('en-GB')}`;

function hrefOf(h: HireView) {
  const by = { hire: staffUrl.hire, approve: staffUrl.approve, pickup: (r: string) => staffUrl.capture(r, 'pickup'), return: (r: string) => staffUrl.capture(r, 'return') };
  return by[h.step.href](h.ref);
}

// The finding a person most needs to see: a charge or an owner look first, then anything with a return photo.
function evidenceOf(h: HireView): RoomRow['evidence'] {
  const f =
    h.findings.find((x) => (x.outcome === 'charge' || x.outcome === 'owner_look') && x.returnPhotoId) ?? h.findings.find((x) => x.returnPhotoId);
  if (!f) return null;
  return { pickupId: f.pickupPhotoId, returnId: f.returnPhotoId, box: f.box as Box, what: ANGLES.find((a) => a.id === f.angle)?.short ?? f.angle };
}

export default async function ControlRoomPage({ searchParams }: PageProps<'/control-room'>) {
  await connection(); // live rows: render per request
  const { view } = await searchParams;
  const { rows, kpis, ages } = await load();
  const initialView = view === 'open' ? 1 : 0; // Room's VIEWS: 0 needs a person, 1 all open hires

  return (
    <StaffPage current={initialView ? 'hire' : 'control-room'}>
      <Room key={initialView} rows={rows} kpis={kpis} ages={ages} shops={SHOPS} initialView={initialView} />
    </StaffPage>
  );
}

async function load() {
  const hires = await loadHires();
  const now = Date.now();

  const open = hires.filter((h) => h.holdOpen);
  const waiting = hires.filter((h) => h.step.needsPerson);
  const oldestWait = Math.max(0, ...waiting.map((h) => Math.floor((now - (h.returnedAt ?? h.dueBackAt).getTime()) / DAY)));
  const ownerLooks = hires.filter((h) => h.status !== 'settled').flatMap((h) => h.findings.filter((f) => f.outcome === 'owner_look' && f.setGBP === null));
  const contests = hires.filter((h) => h.contested);
  const refresh = hires.filter((h) => h.holdToRefresh);
  const ages = Array.from({ length: 30 }, (_, d) => open.filter((h) => Math.min(h.holdAgeDays, 29) === d).length);

  const kpis: Kpi[] = [
    { label: 'Held on PayPal now', value: gbp(open.reduce((sum, h) => sum + h.heldPence, 0)), note: `across ${open.length} hire${open.length === 1 ? '' : 's'}` },
    { label: 'Waiting for a person', value: String(waiting.length), note: waiting.length ? `oldest ${oldestWait} day${oldestWait === 1 ? '' : 's'}` : 'all clear' },
    { label: 'Owner looks', value: String(ownerLooks.length), note: 'AI below 0.75 confidence' },
    { label: 'Contests open', value: String(contests.length), note: contests.length ? contests.map((h) => h.ref).join(', ') : 'none open' },
    { label: 'Holds to refresh', value: String(refresh.length), note: 'past the 3-day honour period', risk: refresh.length > 0 },
  ];

  const rows: RoomRow[] = hires.map((h) => ({
    ref: h.ref,
    item: h.item,
    branch: h.branch,
    chip: h.step.chip,
    status: h.step.status,
    next: h.step.next,
    nextHref: hrefOf(h),
    needsPerson: h.step.needsPerson,
    settled: h.status === 'settled',
    holdOpen: h.holdOpen,
    held: h.heldPence / 100,
    ageDays: h.holdAgeDays,
    evidence: evidenceOf(h),
  }));
  return { rows, kpis, ages };
}
