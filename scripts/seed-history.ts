// 6 weeks of seeded history for Ledgerton Hire's three shops, about 750 hires (the control room's Risk page).
//   npm run db:seed-history              writes it
//   npm run db:seed-history -- --dry-run builds and checks it, prints the counts, writes nothing
// No PayPal and no model: every outcome comes from a fixed-seed PRNG, so a run on the same day writes the same
// rows. Dates run back from today so the timeline and the weekly charts are current.
// Every row is seeded: hires have seeded: true, holds are SEED-H-*, approvals SEED-A-*, captures SEED-C-*.
// A re-run deletes the previous history first. seed-holds' LH-TST-* test holds and live sandbox hires are left alone.
// Each hire is of one garment from a stock of STOCK per type, plus the demo blazer (BLZ-NAVY-40R), whose 8 hires in
// Halifax tell the condition-history story: one of them logs KM-38-CUFF and the later ones see it and don't charge.

import assert from 'node:assert/strict';
import { SHOP_CODES } from '../lib/catalogue';
import { db } from '../lib/db';
import { NEW_MARK, PROMPT_VERSION } from '../lib/inspector';
import { demoRenter } from './demo-renter';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const WEEKS = 6;
const HIRES_PER_DAY = 18; // 42 days x 18 = about 750
const FEE = 28;
const DEPOSIT = 60; // the cap on any charge: what is left of the hold once the fee is taken
const HONOUR_DAYS = 3;
const HOLD_DAYS = 29;
const HIGH_CONTEST_CODE = 'H-02'; // the Halifax demo story
const DECISION_FLOOR = 20; // the Risk page only charts codes with this many decisions
const MODEL = 'seed-history'; // not a model call: marks findings this script made up

// Name, staff code letter, share of hires, and each staff member's share of the shop's shifts. Two staff a shop
// keeps every code over the Risk page's floor; H-02 works a few more Halifax shifts so the story has 25+.
const SHOPS = [
  { branch: 'Halifax', letter: 'H', weight: 1.1, shifts: [5, 6] },
  { branch: 'Leeds', letter: 'L', weight: 1.0, shifts: [1, 1] },
  { branch: 'Bradford', letter: 'B', weight: 1.0, shifts: [1, 1] },
];
// Garment types by ref prefix; each hire is of one garment, e.g. MS-40R-011.
const GARMENT_TYPES = ['MS-40R', 'KLT-38', 'TUX-42L', 'LS-36S', 'TC-44R', 'HD-40', 'DS-38R'];
const STOCK = 16; // per type: about 7 hires per garment over the 6 weeks
const BLAZER = 'BLZ-NAVY-40R';
const CUFF_MARK = { id: 'KM-38-CUFF', itemRef: BLAZER, description: 'Faint mark on the left cuff', firstSeen: 'hire #38' };
// The blazer's hires, oldest first, each in Halifax and started at least BLAZER_GAP after the last came back; the
// fourth logs the cuff mark.
const BLAZER_STORY = ['clean', 'charged', 'clean', 'clean', 'clean', 'contested', 'clean', 'charged'] as const;
const LOGS_CUFF = 3;
const BLAZER_EVERY = 4.5 * DAY;
const BLAZER_GAP = 12 * HOUR;
// Every 100 hires a staff code settles: 78 clean, 18 charged, 3 owner looks a person priced, 1 they let go.
const MIX = [...Array(78).fill('clean'), ...Array(18).fill('charged'), ...Array(3).fill('owner_priced'), 'owner_free'] as const;
// Which of a code's charges the renter contests: every 5th of H-02's, the 8th, 33rd, ... of everyone else's.
const contests = (code: string, nth: number) => (code === HIGH_CONTEST_CODE ? nth % 5 === 1 : nth % 25 === 8);
// What renters wrote, by the clause they contested; used in order, so none repeats.
const CONTEST_NOTES: Record<string, string[]> = {
  S1: [
    'That mark was there when I collected it. I saw it in the fitting room but didn’t think to mention it.',
    'Nobody near me was drinking red wine or wearing make-up. Could it be left over from an earlier hire?',
    'I had it spot-cleaned before bringing it back and it looked fine to me. Could someone look again in daylight?',
    'I’m happy to pay something, but a specialist clean seems a lot for a mark this small.',
    'It rained on the walk to the venue. I think it’s a water mark that will dry out, not a stain.',
    'The pick-up photo on that side is quite dark, so I don’t think it shows the mark wasn’t already there.',
    'It’s a faint shadow you can only see up close. Nobody noticed it on the day.',
    'The assistant said it had just come back from the cleaners. Could the mark be from the cleaning?',
    'I wore it for three hours at a registry office and sat down for most of it. I can’t see how it was stained.',
    'Could you send me a closer photo? I can’t make out a stain in the one on my return page.',
  ],
  B1: [
    'The button was loose when I collected it. I mentioned it at the counter and was told it would be fine.',
    'The button is in the inside pocket. It came off on the night and I put it there to keep it safe.',
    'I checked every button before handing it back. Could it have come off in the garment bag?',
    'There was already a gap in the row of buttons when I collected it.',
    'I’ve still got the button at home. Can I drop it in rather than pay for it?',
    'The thread looked worn at pick-up. I don’t think I should pay for a button that was about to fall off.',
    'I didn’t fasten the jacket all evening, so I’m not sure how a button went missing.',
    'Could you check the bottom of the bag? I’m fairly sure everything was there when I dropped it off.',
  ],
  R1: [
    'That hole was there at pick-up. It’s small and low on the front, so I didn’t spot it until I got home.',
    'Nobody in our party smokes and there were no candles at the venue. I don’t see how it could have been burnt.',
    'I accept there’s damage, but the whole deposit for one small hole seems unfair. Could it be repaired instead?',
    'I emailed the shop about the hole the morning after the wedding, before I returned it.',
    'Could someone compare it with the pick-up photo again? I think it’s a snag in the weave, not a burn.',
  ],
};

// mulberry32: small, fast and the same on every machine.
function prng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
const rand = prng(20261110);
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
const chance = (p: number) => rand() < p;
const box = () => {
  const [x, y] = [0.15 + rand() * 0.5, 0.15 + rand() * 0.5];
  return { x: +x.toFixed(2), y: +y.toFixed(2), w: +(0.05 + rand() * 0.1).toFixed(2), h: +(0.05 + rand() * 0.1).toFixed(2) };
};
// Draws without replacement, refilled when empty: exact proportions over every full bag, so a small shop's mix
// can't drift far by luck.
function bag<T>(items: readonly T[]) {
  let left: T[] = [];
  return () => {
    if (!left.length) {
      left = [...items];
      for (let i = left.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [left[i], left[j]] = [left[j], left[i]];
      }
    }
    return left.pop()!;
  };
}

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

// A random type, then that type's garments in turn, so each one goes out about as often as the others.
const issued = new Map<string, number>();
const garment = () => {
  const type = pick(GARMENT_TYPES);
  const k = issued.get(type) ?? 0;
  issued.set(type, k + 1);
  return `${type}-${String((k % STOCK) + 1).padStart(3, '0')}`;
};

const amountOf = (f: FindingSeed) => (f.outcome === 'no_charge' ? 0 : (f.setGBP ?? f.proposedGBP ?? 0));
const totalOf = (fs: FindingSeed[]) => Math.min(DEPOSIT, fs.reduce((sum, f) => sum + amountOf(f), 0));

function build(now: number) {
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const first = today.getTime() - WEEKS * 7 * DAY;
  const totalWeight = SHOPS.reduce((s, x) => s + x.weight, 0);
  const seq = new Map<string, number>();
  const staffOf = new Map(SHOPS.map((s) => [s.branch, bag(s.shifts.flatMap((n, i) => Array<number>(n).fill(i)))]));
  const mixOf = new Map<string, () => (typeof MIX)[number]>();
  const chargesBy = new Map<string, number>();
  const notesUsed = new Map<string, number>();
  const past = (t: number) => new Date(Math.min(t, now)); // an event can't be later than the run

  const hires: object[] = [];
  const holds: object[] = [];
  const findings: object[] = [];
  const approvals: object[] = [];
  const captures: object[] = [];
  const contestRows: object[] = [];
  const decisions: { staffCode: string; contested: boolean; total: number }[] = [];
  type Meta = { hire: { id: string; itemRef: string; branch: string }; status: string; category: string; returnedAt: number };
  const blazer: Meta[] = [];

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
        const code = SHOP_CODES[shop.branch];
        const number = (seq.get(code) ?? 10000) + 1;
        seq.set(code, number);
        const hireRef = `LH-${code}-${number}`;

        let staffCode = `${shop.letter}-${String(staffOf.get(shop.branch)!() + 1).padStart(2, '0')}`;
        // The staff code stays on the hire (Risk page); approvals just say "Staff", as live ones do.
        const approver = 'Staff';

        const startAt = first + day * DAY + 9 * HOUR + rand() * 8 * HOUR;
        const dueBackAt = startAt + (chance(0.7) ? 3 : 4) * DAY;
        const returnedAt = dueBackAt + (chance(0.03) ? (1 + rand()) * DAY : (rand() - 0.6) * 12 * HOUR);
        // An early return is settled once its hire period is over, so a settled hire is never due back later.
        const settledAt = Math.max(returnedAt + (2 + rand() * 28) * HOUR, dueBackAt + HOUR);
        const d = (t: number) => new Date(t);

        // The blazer takes the first Halifax hire once it is back on the rail, and plays its slot in the story.
        const slot = blazer.length;
        const isBlazer =
          shop.branch === 'Halifax' &&
          slot < BLAZER_STORY.length &&
          startAt >= Math.max(first + slot * BLAZER_EVERY, (blazer.at(-1)?.returnedAt ?? 0) + BLAZER_GAP);
        let outcome: Outcome;
        let priced = false;
        let contested = false;
        if (isBlazer) {
          const story = BLAZER_STORY[slot];
          outcome = story === 'contested' ? 'charged' : story;
          contested = story === 'contested';
          if (contested) staffCode = HIGH_CONTEST_CODE; // the blazer's contest is part of H-02's story, not a stray on H-01
        } else {
          if (!mixOf.has(staffCode)) mixOf.set(staffCode, bag(MIX));
          const drawn = mixOf.get(staffCode)!();
          outcome = drawn === 'owner_priced' || drawn === 'owner_free' ? 'owner_look' : drawn;
          priced = drawn === 'owner_priced';
          if (outcome === 'charged') {
            const nth = (chargesBy.get(staffCode) ?? 0) + 1;
            chargesBy.set(staffCode, nth);
            contested = contests(staffCode, nth);
          }
        }
        let fs = outcome === 'clean' ? [cleanFinding()] : outcome === 'charged' ? chargedFindings() : [ownerLookFinding()];

        // A person prices an owner-look finding, within its band and the hold, or lets it go.
        if (priced) {
          const f = fs[0];
          f.setGBP = f.clauseId === 'R1' ? DEPOSIT : pick([18, 20, 24, 30]);
        }

        let contestStatus = 'resolved';
        const contestedGBP = totalOf(fs); // before the contest lowers anything below
        const contestedClause = fs.find((f) => f.outcome === 'charge')?.clauseId ?? 'S1';
        if (contested) {
          const c = rand();
          // Kept as charged (most); lowered to the bottom of a stain's band; or removed (every charge set to 0).
          if (c >= 0.9) fs = fs.map((f) => (f.outcome === 'charge' ? { ...f, setGBP: 0 } : f));
          else if (c >= 0.65) fs = fs.map((f) => (f.outcome === 'charge' && f.clauseId === 'S1' && f.proposedGBP! > 18 ? { ...f, setGBP: 18 } : f));
        }

        // Where this hire is today: still out, returned and waiting, contested and waiting, or settled.
        const out = returnedAt > now;
        const waiting = !out && settledAt > now;
        if (contested && waiting) contestStatus = 'open';
        const status = out ? 'out' : waiting ? (contested ? 'contested' : 'returned') : 'settled';
        const total = totalOf(fs);
        const charges = status === 'settled' && total > 0;
        const closed = status === 'settled';

        const hire = {
          id,
          hireRef,
          branch: shop.branch,
          itemRef: isBlazer ? BLAZER : garment(),
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
        if (isBlazer) blazer.push({ hire, status, category: BLAZER_STORY[slot], returnedAt });
        // A settled hold's dates stop when it was settled; only an open hold has deadlines still to come.
        holds.push({
          id: holdId,
          hireId: id,
          amountGBP: FEE + DEPOSIT,
          status: closed ? (charges ? 'CAPTURED' : 'VOIDED') : 'PARTIALLY_CAPTURED',
          createdAt: d(startAt),
          honourEndsAt: d(closed ? Math.min(startAt + HONOUR_DAYS * DAY, settledAt) : startAt + HONOUR_DAYS * DAY),
          expiresAt: d(closed ? settledAt : startAt + HOLD_DAYS * DAY),
        });
        const approval = (suffix: string, maxGBP: number, finalCapture: boolean, at: number) => ({
          id: `SEED-A-${String(n).padStart(6, '0')}-${suffix}`,
          authorizationId: holdId,
          maxGBP,
          finalCapture,
          approver,
          expiresAt: past(at + 49 * HOUR), // used at once, so it never had to last
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
            createdAt: past(returnedAt + 20 * 60_000),
          });
        if (contested) {
          const notes = CONTEST_NOTES[contestedClause];
          const used = notesUsed.get(contestedClause) ?? 0;
          notesUsed.set(contestedClause, used + 1);
          contestRows.push({
            hireId: id,
            findingId: null,
            note: notes[used % notes.length],
            status: contestStatus,
            resolvedBy: contestStatus === 'resolved' ? approver : null,
            contestedGBP,
            createdAt: past(returnedAt + (1 + rand()) * HOUR),
          });
        }
        if (charges) {
          const final = approval('S', total, true, settledAt);
          approvals.push(final);
          captures.push({ id: `SEED-C-${String(n).padStart(6, '0')}-S`, authorizationId: holdId, approvalId: final.id, amountGBP: total, finalCapture: true, status: 'COMPLETED', createdAt: d(settledAt) });
        }
        if (status === 'settled' && (total > 0 || contested)) decisions.push({ staffCode, contested, total });
      }
    }
  }

  assert.equal(blazer.length, BLAZER_STORY.length, `only ${blazer.length} of the blazer's ${BLAZER_STORY.length} hires fit in ${WEEKS} weeks`);
  for (const [i, m] of blazer.entries()) assert.equal(m.status, 'settled', `blazer hire ${i + 1} (${m.category}) is not settled yet`);

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

  return { first, hires, holds, findings, approvals, captures, contests: contestRows, decisions, cuffHireId: blazer[LOGS_CUFF].hire.id };
}

// The story the Risk page tells has to be in the data, and every amount and date has to be one the app could make.
function check(rows: ReturnType<typeof build>, now: number) {
  const { hires, holds, findings, approvals, captures, contests, decisions } = rows as unknown as {
    hires: { status: string; itemRef: string; startAt: Date; returnedAt: Date | null; dueBackAt: Date }[];
    holds: { status: string; createdAt: Date; honourEndsAt: Date; expiresAt: Date }[];
    findings: { clauseId: string | null; outcome: string; proposedGBP: number | null; setGBP: number | null; createdAt: Date }[];
    approvals: { createdAt: Date; usedAt: Date; expiresAt: Date }[];
    captures: { amountGBP: number; finalCapture: boolean; createdAt: Date }[];
    contests: { note: string; createdAt: Date }[];
    decisions: { staffCode: string; contested: boolean }[];
  };
  assert.ok(hires.length >= 600 && hires.length <= 800, `${hires.length} hires`);
  assert.equal(hires.filter((h) => h.itemRef === BLAZER).length, BLAZER_STORY.length);
  const perGarment = (hires.length - BLAZER_STORY.length) / (GARMENT_TYPES.length * STOCK);
  assert.ok(perGarment >= 6 && perGarment <= 8, `${perGarment.toFixed(1)} hires per garment`);

  for (const c of captures) assert.ok(c.amountGBP > 0 && c.amountGBP <= (c.finalCapture ? DEPOSIT : FEE));
  const band = (clauseId: string | null) => ({ S1: [18, 30], B1: [6, 6], R1: [DEPOSIT, DEPOSIT] })[clauseId as 'S1'];
  for (const f of findings) {
    if (f.outcome === 'charge') {
      const [low, high] = band(f.clauseId) ?? [];
      assert.ok(f.proposedGBP! >= low && f.proposedGBP! <= high, `${f.clauseId} £${f.proposedGBP}`);
      if (f.setGBP != null) assert.ok(f.setGBP === 0 || (f.setGBP >= low && f.setGBP < f.proposedGBP!), `${f.clauseId} set to £${f.setGBP}`);
    }
    if (f.outcome === 'owner_look' && f.setGBP != null) {
      const [low, high] = band(f.clauseId) ?? [];
      assert.ok(f.setGBP >= low && f.setGBP <= high, `owner look ${f.clauseId} set to £${f.setGBP}`);
    }
  }

  // Nothing before the 6 weeks, and nothing after now but an open hold's deadlines and an out hire's due date.
  const inRange = (what: string, t: Date | null) => t && assert.ok(t.getTime() >= rows.first && t.getTime() <= now, `${what} ${t.toISOString()}`);
  for (const h of hires) {
    inRange('hire start', h.startAt);
    inRange('hire return', h.returnedAt);
    if (h.status === 'settled') inRange('due back', h.dueBackAt);
  }
  for (const h of holds) {
    inRange('hold', h.createdAt);
    if (h.status !== 'PARTIALLY_CAPTURED') for (const t of [h.honourEndsAt, h.expiresAt]) inRange('closed hold', t);
  }
  for (const x of [...findings, ...captures, ...contests]) inRange('event', x.createdAt);
  for (const a of approvals) for (const t of [a.createdAt, a.usedAt, a.expiresAt]) inRange('approval', t);
  assert.equal(new Set(contests.map((c) => c.note)).size, contests.length, 'a contest note repeats');

  const rate = (code: string) => {
    const mine = decisions.filter((x) => x.staffCode === code);
    return { n: mine.length, rate: mine.filter((x) => x.contested).length / mine.length };
  };
  const high = rate(HIGH_CONTEST_CODE);
  assert.ok(high.n >= 25, `${HIGH_CONTEST_CODE} has only ${high.n} decisions`);
  const codes = SHOPS.flatMap((s) => s.shifts.map((_, i) => `${s.letter}-${String(i + 1).padStart(2, '0')}`));
  for (const code of codes) {
    const o = rate(code);
    assert.ok(o.n >= DECISION_FLOOR, `${code} has only ${o.n} decisions, under the Risk page's floor`);
    if (code !== HIGH_CONTEST_CODE) assert.ok(o.rate < high.rate / 2, `${code} contests ${o.rate} vs ${high.rate}`);
  }
  return { high, byCode: codes.map((c) => `${c} ${rate(c).n} (${(100 * rate(c).rate).toFixed(0)}%)`) };
}

async function main() {
  const now = Date.now();
  const rows = build(now);
  const { high, byCode } = check(rows, now);

  const decided = rows.decisions.length;
  const contested = rows.decisions.filter((x) => x.contested).length;
  const charged = rows.decisions.filter((x) => x.total > 0).length;
  const statuses = Object.entries(Object.groupBy(rows.hires as { status: string }[], (h) => h.status)).map(([s, xs]) => `${s} ${xs!.length}`);
  const byShop = Object.entries(Object.groupBy(rows.hires as { branch: string }[], (h) => h.branch)).map(([s, xs]) => `${s} ${xs!.length}`);
  console.log(`${rows.hires.length} hires: ${byShop.join(', ')}. ${statuses.join(', ')}.`);
  console.log(`${decided} charge decisions, ${contested} contested (${((100 * contested) / charged).toFixed(1)}% of charges); ${HIGH_CONTEST_CODE} ${(100 * high.rate).toFixed(0)}% of ${high.n}`);
  console.log(`Decisions (contested) by staff code: ${byCode.join(', ')}`);
  if (process.argv.includes('--dry-run')) return console.log('Dry run: nothing written.');

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
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
