import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { connection } from 'next/server';
import { staffUrl, StaffPage } from '@/app/(lab)/chrome';
import type { EvidenceFinding } from '@/components/studio/EvidencePair';
import { aiEnabled, aiModels } from '@/lib/ai';
import { SHOPS } from '@/lib/catalogue';
import { db } from '@/lib/db';
import { amountPence } from '@/lib/hold';
import { ANGLES, CLAUSES } from '@/lib/schedule';
import { findingChip, loadHires, type HireView } from '@/lib/staff-view';
import { Room, type Kpi } from './room';
import { getSavedLayouts, LAYOUT_ROLE_COOKIE } from './saved-layout';

export const metadata: Metadata = { title: 'Control room' };

const DAY = 86_400_000;
const gbp = (pence: number) => `£${Math.round(pence / 100).toLocaleString('en-GB')}`;

function hrefOf(h: HireView) {
  const by = { hire: staffUrl.hire, approve: staffUrl.approve, pickup: (r: string) => staffUrl.capture(r, 'pickup'), return: (r: string) => staffUrl.capture(r, 'return') };
  return by[h.step.href](h.ref);
}

function findingSummary(f: HireView['findings'][number]): EvidenceFinding {
  const clause = CLAUSES.find((c) => c.id === f.clauseId);
  const [chip, outcome] = findingChip(f);
  const pence = amountPence(f);
  return {
    clause: clause ? `${clause.id} · ${clause.name}` : '',
    chip,
    outcome,
    amount: pence > 0 ? `£${(pence / 100).toFixed(2)}` : f.outcome === 'owner_look' && f.setGBP === null ? 'No amount set' : 'No charge',
    confidence: f.confidence,
    description: f.description,
    reason: f.reason,
  };
}

// The finding a person most needs to see: a charge or an owner look first, then anything with a return photo.
function evidenceOf(h: HireView) {
  const f =
    h.findings.find((x) => (x.outcome === 'charge' || x.outcome === 'owner_look') && x.returnPhotoId) ?? h.findings.find((x) => x.returnPhotoId);
  // Empty, not null, when there's none: Studio infers fields and drops a column with no values.
  return {
    evidencePickupId: f?.pickupPhotoId ?? '',
    evidenceReturnId: f?.returnPhotoId ?? '',
    evidenceBox: f?.box ? JSON.stringify(f.box) : '',
    evidenceWhat: f ? (ANGLES.find((a) => a.id === f.angle)?.short ?? f.angle) : '',
    evidenceFinding: f ? JSON.stringify(findingSummary(f)) : '',
  };
}

export default async function ControlRoomPage({ searchParams }: PageProps<'/control-room'>) {
  await connection(); // live rows: render per request
  const { view } = await searchParams;
  const data = await load();
  const initialView = view === 'open' ? 1 : 0; // VIEWS: 0 needs a person, 1 all open hires
  const initialRole = (await cookies()).get(LAYOUT_ROLE_COOKIE)?.value === 'branch' ? 'branch' : 'ops';

  return (
    <StaffPage current={initialView ? 'hire' : 'control-room'}>
      <Room
        key={initialView}
        {...data}
        shops={SHOPS}
        initialView={initialView}
        initialRole={initialRole}
        licenseKey={process.env.AG_STUDIO}
        aiModels={aiEnabled() ? aiModels() : undefined}
      />
    </StaffPage>
  );
}

async function load() {
  const [views, authorizations, hires, findings, openApprovals, contests, finalCaptures, marks, frontPhotos, layouts] = await Promise.all([
    loadHires(),
    db.authorization.findMany({ omit: { updatedAt: true }, orderBy: { createdAt: 'asc' } }),
    // No renterName: Studio's data sources are readable by the desk agent, and it must not see renters' names.
    db.hire.findMany({ omit: { createdAt: true, renterName: true }, orderBy: { startAt: 'asc' } }),
    db.finding.findMany({ omit: { knownMarkId: true, model: true, promptVersion: true, createdAt: true }, orderBy: { createdAt: 'asc' } }),
    // The same test settleHire applies; the token stays on the server.
    db.approval.findMany({ where: { finalCapture: true, usedAt: null, expiresAt: { gt: new Date() } }, select: { authorizationId: true } }),
    db.contest.findMany({ select: { hireId: true, note: true, photoId: true, status: true } }),
    db.capture.findMany({ where: { finalCapture: true, amountGBP: { gt: 0 } }, select: { authorizationId: true, amountGBP: true } }),
    db.itemMark.findMany({ select: { id: true, itemRef: true, description: true, firstSeen: true, hireId: true, photoId: true } }),
    db.photo.findMany({ where: { stage: 'pickup', angle: 'front' }, select: { id: true, hireId: true } }),
    getSavedLayouts(),
  ]);
  const now = Date.now();

  const open = views.filter((h) => h.holdOpen);
  const waiting = views.filter((h) => h.step.needsPerson);
  const oldestWait = Math.max(0, ...waiting.map((h) => Math.floor((now - (h.returnedAt ?? h.dueBackAt).getTime()) / DAY)));
  const ownerLooks = views.filter((h) => h.status !== 'settled').flatMap((h) => h.findings.filter((f) => f.outcome === 'owner_look' && f.setGBP === null));
  const contestsOpen = views.filter((h) => h.contested);
  const refresh = views.filter((h) => h.holdToRefresh);
  const ages = Array.from({ length: 30 }, (_, d) => open.filter((h) => Math.min(h.holdAgeDays, 29) === d).length);

  const kpis: Kpi[] = [
    { label: 'Held on PayPal now', value: gbp(open.reduce((sum, h) => sum + h.heldPence, 0)), note: `across ${open.length} hire${open.length === 1 ? '' : 's'}` },
    { label: 'Waiting for a person', value: String(waiting.length), note: waiting.length ? `oldest ${oldestWait} day${oldestWait === 1 ? '' : 's'}` : 'all clear' },
    { label: 'Owner looks', value: String(ownerLooks.length), note: 'AI below 0.75 confidence' },
    { label: 'Contests open', value: String(contestsOpen.length), note: contestsOpen.length ? contestsOpen.map((h) => h.ref).join(', ') : 'none open' },
    { label: 'Holds to refresh', value: String(refresh.length), note: 'past the 3-day honour period', risk: refresh.length > 0 },
  ];

  // settleHire only looks at a hire's newest hold, and these come oldest first, so the newest wins.
  const currentHold = new Map(authorizations.map((a) => [a.hireId, a.id]));
  const approvedHolds = new Set(openApprovals.map((a) => a.authorizationId));
  const openContest = new Map(contests.filter((c) => c.status === 'open').map((c) => [c.hireId, c]));

  // The Risk page's per-hire numbers, which Studio's built-in charts average. Percentages as 0 or 100, so an
  // average is the rate. A decision is a settled hire that charged something or was contested.
  const contested = new Set(contests.map((c) => c.hireId));
  const holdHire = new Map(authorizations.map((a) => [a.id, a.hireId]));
  const charged = new Set(finalCaptures.map((c) => holdHire.get(c.authorizationId)));
  const decided = (h: (typeof hires)[number]) => h.status === 'settled' && (charged.has(h.id) || contested.has(h.id));
  const decisionsBy = new Map<string, number>();
  for (const h of hires) if (h.staffCode && decided(h)) decisionsBy.set(h.staffCode, (decisionsBy.get(h.staffCode) ?? 0) + 1);

  // Condition history: each hire's outcome and what it charged. Captured money once settled, else the findings' amounts.
  const capturedGBP = new Map<string, number>();
  for (const c of finalCaptures) {
    const hireId = holdHire.get(c.authorizationId)!;
    capturedGBP.set(hireId, (capturedGBP.get(hireId) ?? 0) + Number(c.amountGBP));
  }
  const inspected = new Map<string, { pence: number; ownerLook: boolean }>();
  for (const f of findings) {
    const x = inspected.get(f.hireId) ?? { pence: 0, ownerLook: false };
    if (f.outcome !== 'no_charge') x.pence += amountPence(f);
    x.ownerLook ||= f.outcome === 'owner_look';
    inspected.set(f.hireId, x);
  }
  const frontPhoto = new Map(frontPhotos.map((p) => [p.hireId, p.id]));
  const chargedOf = (h: (typeof hires)[number]) => capturedGBP.get(h.id) ?? (h.status === 'settled' ? 0 : (inspected.get(h.id)?.pence ?? 0) / 100);
  const outcomeOf = (h: (typeof hires)[number]) => {
    const x = inspected.get(h.id);
    if (contested.has(h.id)) return 'contested';
    if (!x) return 'not inspected';
    if (chargedOf(h) > 0) return 'charged';
    return x.ownerLook ? 'owner look' : 'clean';
  };

  const viewOf = new Map(views.map((v) => [v.ref, v]));

  // Decimals don't cross to the client; GBP amounts to 2dp are exact enough as numbers.
  return {
    kpis,
    ages,
    layouts,
    renters: Object.fromEntries(views.flatMap((v) => (v.renterName ? [[v.ref, v.renterName]] : []))),
    holds: authorizations.map((a) => ({ ...a, amountGBP: Number(a.amountGBP) })),
    hires: hires.map((h) => {
      const v = viewOf.get(h.hireRef)!;
      return {
        ...h,
        feeGBP: Number(h.feeGBP),
        depositGBP: Number(h.depositGBP),
        openApproval: approvedHolds.has(currentHold.get(h.id)!),
        // Empty, not null, when there's none: Studio infers fields and drops a column with no values.
        contestNote: openContest.get(h.id)?.note ?? '',
        contestPhotoId: openContest.get(h.id)?.photoId ?? '',
        staffCode: h.staffCode ?? '',
        keptPct: charged.has(h.id) ? 100 : 0,
        decided: decided(h),
        contestedPct: contested.has(h.id) ? 100 : 0,
        // Every hire carries its staff code's total, so a row filter can keep codes with 20 or more.
        staffDecisions: h.staffCode ? (decisionsBy.get(h.staffCode) ?? 0) : 0,
        pickupPhotoId: frontPhoto.get(h.id) ?? '',
        outcome: outcomeOf(h),
        chargedGBP: chargedOf(h),
        // The work queue and Evidence pair.
        look: v.item,
        chip: v.step.chip,
        stepStatus: v.step.status,
        nextStep: v.step.next,
        nextHref: hrefOf(v),
        needsPerson: v.step.needsPerson,
        isSettled: v.status === 'settled',
        holdOpen: v.holdOpen,
        heldGBP: v.heldPence / 100,
        ageDays: v.holdAgeDays,
        ...evidenceOf(v),
      };
    }),
    findings: findings.map((f) => ({
      ...f,
      // Studio fields hold primitives, so the box travels as JSON. Null amounts stay null: 0 would mean waived.
      box: f.box && JSON.stringify(f.box),
      proposedGBP: f.proposedGBP === null ? null : Number(f.proposedGBP),
      setGBP: f.setGBP === null ? null : Number(f.setGBP),
    })),
    marks,
  };
}
