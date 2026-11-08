// 12 weeks of seeded history for Ledgerton Hire's six shops, about 5,400 hires (the control room's Risk page).
//   npm run db:seed-history
// No PayPal and no model: every outcome comes from a fixed-seed PRNG, so a run on the same day writes the same
// rows. Dates run back from today so the timeline and the weekly charts are current.
// Every row is seeded: hires have seeded: true, holds are SEED-H-*, approvals SEED-A-*, captures SEED-C-*.
// A re-run deletes the previous history first. seed-holds' LH-TST-* test holds and live sandbox hires are left alone.
// Each hire is of one garment from a stock of STOCK per type, plus the demo blazer (BLZ-NAVY-40R), whose 8 hires in
// Halifax tell the condition-history story: one of them logs KM-38-CUFF and the later ones see it and don't charge.

import assert from 'node:assert/strict';
import { db } from '../lib/db';
import { NEW_MARK, PROMPT_VERSION } from '../lib/inspector';
import { demoRenter } from './demo-renter';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const WEEKS = 12;
const HIRES_PER_DAY = 64; // 84 days x 64 = about 5,400
const FEE = 28;
const DEPOSIT = 60; // the cap on any charge: what is left of the hold once the fee is taken
const HONOUR_DAYS = 3;
const HOLD_DAYS = 29;
const HIGH_CONTEST_CODE = 'H-03'; // the Halifax demo story
const MODEL = 'seed-history'; // not a model call: marks findings this script made up

// Name, hire-ref code, staff code letter, share of hires, staff headcount. The last of each shop is part-time.
const SHOPS = [
  { branch: 'Halifax', ref: 'HAL', letter: 'H', weight: 1.0, staff: 4 },
  { branch: 'Leeds', ref: 'LEE', letter: 'L', weight: 1.4, staff: 5 },
  { branch: 'Bradford', ref: 'BRA', letter: 'B', weight: 1.1, staff: 4 },
  { branch: 'Huddersfield', ref: 'HUD', letter: 'U', weight: 0.9, staff: 3 },
  { branch: 'Wakefield', ref: 'WAK', letter: 'W', weight: 0.8, staff: 4 },
  { branch: 'Dewsbury', ref: 'DEW', letter: 'D', weight: 0.6, staff: 3 },
];
// Garment types by ref prefix; each hire is of one garment, e.g. MS-40R-017.
const GARMENT_TYPES = ['MS-40R', 'KLT-38', 'TUX-42L', 'LS-36S', 'TC-44R', 'HD-40', 'DS-38R'];
const STOCK = 96; // per type: about 8 hires per garment over the 12 weeks
const BLAZER = 'BLZ-NAVY-40R';
const CUFF_MARK = { id: 'KM-38-CUFF', itemRef: BLAZER, description: 'Faint mark on the left cuff', firstSeen: 'hire #38' };
// The blazer's hires, oldest first, each settled in Halifax at least 10 days after the last; the fourth logs the cuff mark.
const BLAZER_STORY = ['clean', 'charged', 'clean', 'clean', 'clean', 'contested', 'clean', 'charged'] as const;
const LOGS_CUFF = 3;
const CONTEST_NOTES = [
  'That stain was there when I collected it.',
  'The button was loose at pick-up; I mentioned it at the counter.',
  'I had it dry cleaned before returning it, the mark is a shadow.',
  'This charge seems high for such a small mark.',
  'The tear is on a seam that was already worn.',
  'I was told at collection the cuff had been repaired.',
];

// mulberry32: small, fast and the same on every machine.
function prng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
const rand = prng(20261106);
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
const chance = (p: number) => rand() < p;
const box = () => {
  const [x, y] = [0.15 + rand() * 0.5, 0.15 + rand() * 0.5];
  return { x: +x.toFixed(2), y: +y.toFixed(2), w: +(0.05 + rand() * 0.1).toFixed(2), h: +(0.05 + rand() * 0.1).toFixed(2) };
};

type FindingSeed = {
  angle: string;
  kind: string;
  description: string;
  clauseId: string | null;
  severity: string | null;
  confidence: number;
  outcome: 'charge' | 'owner_look' | 'no_charge';
  reason: string;
  proposedGBP: number | null;
  setGBP?: number | null;
};
type Outcome = 'clean' | 'charged' | 'owner_look';

// What the inspector would have settled, as settle() words it.
function chargedFindings(): FindingSeed[] {
  const kind = rand();
  const s1 = (): FindingSeed[] => {
    const minor = chance(0.4);
    const angle = pick(['front', 'back', 'left-sleeve']);
    const found: FindingSeed[] = [
      {
        angle,
        kind: 'new_damage',
        description: pick(['Make-up stain on the lapel', 'Red wine stain on the front panel', 'Grease mark near the pocket', 'Brown stain on the cuff']),
        clauseId: 'S1',
        severity: minor ? 'minor' : 'moderate',
        confidence: 0.8 + rand() * 0.18,
        outcome: 'charge',
        reason: 'S1 band £18–£30',
        proposedGBP: minor ? 18 : 24,
      },
    ];
    // A second stain is covered by the first: S1 is charged once per garment.
    if (chance(0.25))
      found.push({ ...found[0], angle: 'front', description: 'Small second stain', severity: 'minor', outcome: 'no_charge', reason: `Covered by the S1 charge on ${angle}`, proposedGBP: null });
    return found;
  };
  const button = (): FindingSeed => ({
    angle: pick(['front', 'left-sleeve', 'right-sleeve']),
    kind: 'missing_part',
    description: 'Button missing',
    clauseId: 'B1',
    severity: 'minor',
    confidence: 0.85 + rand() * 0.14,
    outcome: 'charge',
    reason: 'B1 fixed £6',
    proposedGBP: 6,
  });
  if (kind < 0.62) return chance(0.1) ? [...s1(), button()] : s1();
  if (kind < 0.92) return chance(0.15) ? [button(), button()] : [button()];
  return [
    {
      angle: 'front',
      kind: 'new_damage',
      description: 'Burn hole through the front panel',
      clauseId: 'R1',
      severity: 'moderate',
      confidence: 0.85 + rand() * 0.1,
      outcome: 'charge',
      reason: 'R1 fixed £140, capped at the remaining hold',
      proposedGBP: DEPOSIT,
    },
  ];
}

function ownerLookFinding(): FindingSeed {
  return chance(0.6)
    ? { angle: pick(['front', 'back']), kind: 'new_damage', description: 'Faint mark, possibly a stain', clauseId: 'S1', severity: 'minor', confidence: 0.55 + rand() * 0.15, outcome: 'owner_look', reason: 'Confidence below 0.75', proposedGBP: null }
    : { angle: 'front', kind: 'new_damage', description: 'Long tear across the back seam', clauseId: 'R1', severity: 'major', confidence: 0.9, outcome: 'owner_look', reason: 'Major damage always goes to a person', proposedGBP: null };
}

const cleanFinding = (): FindingSeed =>
  chance(0.3)
    ? { angle: 'front', kind: 'wear', description: 'Light creasing from wear', clauseId: 'W1', severity: 'minor', confidence: 0.9, outcome: 'no_charge', reason: 'Wear is never charged', proposedGBP: null }
    : { angle: 'front', kind: 'none', description: 'No change', clauseId: null, severity: null, confidence: 0.95, outcome: 'no_charge', reason: 'No change', proposedGBP: null };

// One rand() call, as the type-name pick it replaced, so every other draw (and the Risk page story) is unchanged.
// shortcut: garments are drawn at random, so one can be out on two overlapping hires; only the blazer's are curated.
const garment = () => {
  const i = Math.floor(rand() * GARMENT_TYPES.length * STOCK);
  return `${GARMENT_TYPES[i % GARMENT_TYPES.length]}-${String(Math.floor(i / GARMENT_TYPES.length) + 1).padStart(3, '0')}`;
};

const amountOf = (f: FindingSeed) => (f.outcome === 'no_charge' ? 0 : (f.setGBP ?? f.proposedGBP ?? 0));
const totalOf = (fs: FindingSeed[]) => Math.min(DEPOSIT, fs.reduce((sum, f) => sum + amountOf(f), 0));

function build(now: number) {
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const first = today.getTime() - WEEKS * 7 * DAY;
  const totalWeight = SHOPS.reduce((s, x) => s + x.weight, 0);
  const seq = new Map<string, number>();

  const hires: object[] = [];
  const holds: object[] = [];
  const findings: object[] = [];
  const approvals: object[] = [];
  const captures: object[] = [];
  const contests: object[] = [];
  const decisions: { staffCode: string; contested: boolean; total: number }[] = [];
  type Meta = { hire: { id: string; itemRef: string }; branch: string; status: string; category: string; startAt: number; returnedAt: number };
  const meta: Meta[] = [];

  let n = 0;
  for (let day = 0; day < WEEKS * 7; day++) {
    const weekday = new Date(first + day * DAY).getUTCDay();
    const busy = weekday === 5 || weekday === 6 ? 1.35 : weekday === 0 ? 0.6 : 0.95; // weddings: Friday and Saturday
    for (const shop of SHOPS) {
      const count = Math.round((HIRES_PER_DAY * shop.weight * busy) / totalWeight + (rand() - 0.5) * 3);
      for (let k = 0; k < count; k++) {
        n++;
        const id = `seed-hire-${String(n).padStart(6, '0')}`;
        const holdId = `SEED-H-${String(n).padStart(6, '0')}`;
        const number = (seq.get(shop.ref) ?? 10000) + 1;
        seq.set(shop.ref, number);
        const hireRef = `LH-${shop.ref}-${number}`;

        // Each shop's last staff member works about a quarter of the shifts.
        const weights = Array.from({ length: shop.staff }, (_, i) => (i === shop.staff - 1 ? 0.25 : 1));
        let r = rand() * weights.reduce((a, b) => a + b, 0);
        const staffIndex = weights.findIndex((w) => (r -= w) < 0);
        const staffCode = `${shop.letter}-${String(staffIndex + 1).padStart(2, '0')}`;
        // The staff code stays on the hire (Risk page); approvals just say "Staff", as live ones do.
        const approver = 'Staff';

        const startAt = first + day * DAY + 9 * HOUR + rand() * 8 * HOUR;
        const dueBackAt = startAt + (chance(0.7) ? 3 : 4) * DAY;
        const returnedAt = dueBackAt + (chance(0.03) ? (1 + rand()) * DAY : (rand() - 0.6) * 12 * HOUR);
        const settledAt = returnedAt + (2 + rand() * 28) * HOUR;
        const d = (t: number) => new Date(t);

        const draw = rand();
        const outcome: Outcome = draw < 0.78 ? 'clean' : draw < 0.96 ? 'charged' : 'owner_look';
        let fs = outcome === 'clean' ? [cleanFinding()] : outcome === 'charged' ? chargedFindings() : [ownerLookFinding()];

        // A person prices an owner-look finding, within its band and the hold, or lets it go.
        if (outcome === 'owner_look' && chance(0.55)) {
          const f = fs[0];
          f.setGBP = f.clauseId === 'R1' ? DEPOSIT : pick([18, 20, 24, 30]);
        }

        const contestRate = staffCode === HIGH_CONTEST_CODE ? 0.3 : 0.045;
        const contested = outcome === 'charged' && chance(contestRate);
        let contestStatus = 'resolved';
        if (contested) {
          const c = rand();
          // Kept as charged (most); lowered by setting an amount below the AI's; or removed (every charge set to 0).
          if (c >= 0.9) fs = fs.map((f) => (f.outcome === 'charge' ? { ...f, setGBP: 0 } : f));
          else if (c >= 0.65) fs = fs.map((f) => (f.outcome === 'charge' ? { ...f, setGBP: Math.max(1, Math.floor((f.proposedGBP ?? 0) / 2)) } : f));
        }

        // Where this hire is today: still out, returned and waiting, contested and waiting, or settled.
        const out = returnedAt > now;
        const waiting = !out && settledAt > now;
        if (contested && waiting) contestStatus = 'open';
        const status = out ? 'out' : waiting ? (contested ? 'contested' : 'returned') : 'settled';
        const total = totalOf(fs);
        const charges = status === 'settled' && total > 0;

        const hire = {
          id,
          hireRef,
          branch: shop.branch,
          itemRef: garment(),
          feeGBP: FEE,
          depositGBP: DEPOSIT,
          startAt: d(startAt),
          dueBackAt: d(dueBackAt),
          returnedAt: out ? null : d(returnedAt),
          status,
          seeded: true,
          staffCode: out ? null : staffCode,
          renterName: demoRenter(hireRef),
          createdAt: d(startAt),
        };
        hires.push(hire);
        meta.push({ hire, branch: shop.branch, status, category: contested ? 'contested' : outcome, startAt, returnedAt });
        holds.push({
          id: holdId,
          hireId: id,
          amountGBP: FEE + DEPOSIT,
          status: status === 'settled' ? (charges ? 'CAPTURED' : 'VOIDED') : 'PARTIALLY_CAPTURED',
          createdAt: d(startAt),
          honourEndsAt: d(startAt + HONOUR_DAYS * DAY),
          expiresAt: d(startAt + HOLD_DAYS * DAY),
        });
        const approval = (suffix: string, maxGBP: number, finalCapture: boolean, at: number) => ({
          id: `SEED-A-${String(n).padStart(6, '0')}-${suffix}`,
          authorizationId: holdId,
          maxGBP,
          finalCapture,
          approver,
          expiresAt: d(at + 49 * HOUR),
          token: 'seeded', // not a signed JWT, so it can never be claimed
          usedAt: d(at),
          createdAt: d(at),
        });
        // The fee, taken at hand-over.
        const fee = approval('F', FEE, false, startAt);
        approvals.push(fee);
        captures.push({ id: `SEED-C-${String(n).padStart(6, '0')}-F`, authorizationId: holdId, approvalId: fee.id, amountGBP: FEE, finalCapture: false, status: 'COMPLETED', createdAt: d(startAt) });
        if (out) continue;

        for (const f of fs)
          findings.push({
            hireId: id,
            angle: f.angle,
            kind: f.kind,
            description: f.description,
            clauseId: f.clauseId,
            severity: f.severity,
            box: f.kind === 'none' ? undefined : box(),
            confidence: +f.confidence.toFixed(2),
            outcome: f.outcome,
            reason: f.reason,
            proposedGBP: f.proposedGBP,
            setGBP: f.setGBP ?? null,
            setBy: f.setGBP == null ? null : approver,
            model: MODEL,
            promptVersion: PROMPT_VERSION,
            createdAt: d(returnedAt + 20 * 60_000),
          });
        if (contested)
          contests.push({
            hireId: id,
            findingId: null,
            note: pick(CONTEST_NOTES),
            status: contestStatus,
            resolvedBy: contestStatus === 'resolved' ? approver : null,
            createdAt: d(returnedAt + (1 + rand()) * HOUR),
          });
        if (charges) {
          const final = approval('S', total, true, settledAt);
          approvals.push(final);
          captures.push({ id: `SEED-C-${String(n).padStart(6, '0')}-S`, authorizationId: holdId, approvalId: final.id, amountGBP: total, finalCapture: true, status: 'COMPLETED', createdAt: d(settledAt) });
        }
        if (status === 'settled' && (total > 0 || contested)) decisions.push({ staffCode, contested, total });
      }
    }
  }

  // The demo blazer: the first matching Halifax hire in each slot. Findings are added here, not drawn, so no rand().
  const blazer: Meta[] = [];
  for (const [i, category] of BLAZER_STORY.entries()) {
    const from = Math.max(first + i * 10 * DAY, (blazer.at(-1)?.returnedAt ?? 0) + DAY);
    const m = meta.find((x) => x.branch === 'Halifax' && x.status === 'settled' && x.category === category && x.startAt >= from);
    assert.ok(m, `no settled Halifax ${category} hire for blazer slot ${i}`);
    m.hire.itemRef = BLAZER;
    blazer.push(m);
  }
  const cuff = (m: Meta, f: Partial<FindingSeed> & { knownMarkId?: string }) =>
    findings.push({
      hireId: m.hire.id,
      angle: 'left-sleeve',
      kind: 'known_mark',
      description: CUFF_MARK.description,
      clauseId: null,
      severity: null,
      box: { x: 0.42, y: 0.78, w: 0.08, h: 0.06 },
      confidence: 0.86,
      proposedGBP: null,
      setGBP: null,
      setBy: null,
      model: MODEL,
      promptVersion: PROMPT_VERSION,
      createdAt: new Date(m.returnedAt + 20 * 60_000),
      ...f,
    });
  cuff(blazer[LOGS_CUFF], { outcome: 'owner_look', reason: NEW_MARK });
  for (const m of blazer.slice(LOGS_CUFF + 1))
    cuff(m, { outcome: 'no_charge', reason: `Known mark ${CUFF_MARK.id}, on record before this hire`, knownMarkId: CUFF_MARK.id });

  return { hires, holds, findings, approvals, captures, contests, decisions, cuffHireId: blazer[LOGS_CUFF].hire.id };
}

// The story the Risk page tells has to be in the data, and every amount has to be one settle() could make.
function check(rows: ReturnType<typeof build>) {
  const { hires, findings, captures, decisions } = rows as unknown as {
    hires: { status: string; itemRef: string }[];
    findings: { clauseId: string | null; outcome: string; proposedGBP: number | null; setGBP: number | null }[];
    captures: { amountGBP: number; finalCapture: boolean }[];
    decisions: { staffCode: string; contested: boolean }[];
  };
  assert.ok(hires.length > 5000 && hires.length < 5800, `${hires.length} hires`);
  assert.equal(hires.filter((h) => h.itemRef === BLAZER).length, BLAZER_STORY.length);
  for (const c of captures) assert.ok(c.amountGBP > 0 && c.amountGBP <= (c.finalCapture ? DEPOSIT : FEE));
  for (const f of findings) {
    if (f.outcome !== 'charge') continue;
    const band = { S1: [18, 30], B1: [6, 6], R1: [DEPOSIT, DEPOSIT] }[f.clauseId as 'S1'];
    assert.ok(band && f.proposedGBP! >= band[0] && f.proposedGBP! <= band[1], `${f.clauseId} £${f.proposedGBP}`);
    if (f.setGBP != null) assert.ok(f.setGBP < f.proposedGBP!, 'a person can only lower an AI charge');
  }
  const rate = (code: string) => {
    const mine = decisions.filter((x) => x.staffCode === code);
    return { n: mine.length, rate: mine.filter((x) => x.contested).length / mine.length };
  };
  const high = rate(HIGH_CONTEST_CODE);
  assert.ok(high.n > 20, `${HIGH_CONTEST_CODE} has only ${high.n} decisions`);
  for (const code of new Set(decisions.map((x) => x.staffCode))) {
    const o = rate(code);
    if (code !== HIGH_CONTEST_CODE && o.n >= 20) assert.ok(o.rate < high.rate / 2, `${code} contests ${o.rate} vs ${high.rate}`);
  }
  return high;
}

async function main() {
  const rows = build(Date.now());
  const high = check(rows);

  const history = { seeded: true, NOT: { hireRef: { startsWith: 'LH-TST-' } } };
  const seededHold = { authorizationId: { startsWith: 'SEED-H-' } };
  const removed = await db.$transaction([
    // KM-38-CUFF predates the history (a migration made it), so it is unlinked and kept, not deleted with its hire.
    db.itemMark.updateMany({ where: { id: CUFF_MARK.id }, data: { hireId: null } }),
    db.capture.deleteMany({ where: seededHold }),
    db.approval.deleteMany({ where: seededHold }),
    db.contest.deleteMany({ where: { hire: history } }),
    db.finding.deleteMany({ where: { hire: history } }),
    db.photo.deleteMany({ where: { hire: history } }),
    db.itemMark.deleteMany({ where: { hire: history } }),
    db.authorization.deleteMany({ where: { id: { startsWith: 'SEED-H-' } } }),
    db.hire.deleteMany({ where: history }),
  ]);
  console.log(`Removed the previous history: ${removed.at(-1)!.count} hires`);

  const insert = async (name: string, data: object[], create: (chunk: object[]) => Promise<{ count: number }>) => {
    for (let i = 0; i < data.length; i += 2000) await create(data.slice(i, i + 2000));
    console.log(`  ${String(data.length).padStart(5)} ${name}`);
  };
  /* eslint-disable @typescript-eslint/no-explicit-any -- rows are built to the schema above */
  await insert('hires', rows.hires, (data) => db.hire.createMany({ data: data as any }));
  await insert('holds', rows.holds, (data) => db.authorization.createMany({ data: data as any }));
  await insert('findings', rows.findings, (data) => db.finding.createMany({ data: data as any }));
  await insert('approvals', rows.approvals, (data) => db.approval.createMany({ data: data as any }));
  await insert('captures', rows.captures, (data) => db.capture.createMany({ data: data as any }));
  await insert('contests', rows.contests, (data) => db.contest.createMany({ data: data as any }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
  await db.itemMark.upsert({ where: { id: CUFF_MARK.id }, create: { ...CUFF_MARK, hireId: rows.cuffHireId }, update: { hireId: rows.cuffHireId } });
  console.log(`  ${BLAZER}: ${BLAZER_STORY.length} hires, ${CUFF_MARK.id} logged on ${rows.cuffHireId}`);

  const decided = rows.decisions.length;
  const contested = rows.decisions.filter((x) => x.contested).length;
  const statuses = Object.entries(Object.groupBy(rows.hires as { status: string }[], (h) => h.status)).map(([s, xs]) => `${s} ${xs!.length}`);
  console.log(`${statuses.join(', ')}. ${decided} charge decisions, ${contested} contested (${((100 * contested) / decided).toFixed(1)}%); ${HIGH_CONTEST_CODE} ${(100 * high.rate).toFixed(0)}% of ${high.n}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
