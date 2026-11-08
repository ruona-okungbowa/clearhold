// Fills the holds database (P7 control room).
//   npm run db:seed    upserts the six aged holds from scripts/.aged-holds.json, then four seeded test holds
// The aged holds are live sandbox hires: amount, status, authorisation and expiry times come from PayPal.
// Their hire details (branch, garment, dates) are made up. The test holds are seeded history with fake ids,
// one per status, dated relative to today so the timeline always has something inside and past its honour period.
// Safe to re-run: every row is upserted on its PayPal id or hire ref.

import { readFileSync } from 'node:fs';
import { db } from '../lib/db';
import { demoRenter } from './demo-renter';
import { get, type Money } from '../lib/paypal';

const HOLDS_FILE = 'scripts/.aged-holds.json';
const FEE = 28;
const DEPOSIT = 60;
const HONOUR_DAYS = 3;
const DAY = 86_400_000;

type AgedHold = { role: 'fee' | 'untouched' | 'spare'; orderId: string; authId?: string; feeCaptureId?: string };
type PayPalAuthorization = { id: string; status: string; amount: Money; create_time: string; expiration_time: string };

const BRANCHES = ['Halifax', 'Leeds', 'York'];
const ITEMS = ['Morning suit 40R', 'Kilt outfit 38', 'Tuxedo 42L', 'Lounge suit 36S', 'Tailcoat 44R', 'Highland dress 40'];
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * DAY);

type HoldSeed = {
  hireRef: string;
  branch: string;
  itemRef: string;
  startAt: Date;
  dueBackAt: Date;
  returnedAt?: Date;
  hireStatus: string;
  seeded: boolean;
  authId: string;
  amountGBP: number;
  authStatus: string;
  createdAt: Date;
  expiresAt: Date;
};

async function upsertHold(h: HoldSeed) {
  const hire = {
    branch: h.branch,
    itemRef: h.itemRef,
    feeGBP: FEE,
    depositGBP: DEPOSIT,
    startAt: h.startAt,
    dueBackAt: h.dueBackAt,
    returnedAt: h.returnedAt ?? null,
    status: h.hireStatus,
    seeded: h.seeded,
    renterName: demoRenter(h.hireRef),
  };
  const { id: hireId } = await db.hire.upsert({
    where: { hireRef: h.hireRef },
    create: { hireRef: h.hireRef, ...hire },
    // A live hire keeps its progress on a re-run; seeded history is reset.
    update: h.seeded ? hire : { ...hire, status: undefined, returnedAt: undefined },
  });
  const auth = {
    hireId,
    amountGBP: h.amountGBP,
    status: h.authStatus,
    createdAt: h.createdAt,
    honourEndsAt: addDays(h.createdAt, HONOUR_DAYS),
    expiresAt: h.expiresAt,
  };
  await db.authorization.upsert({ where: { id: h.authId }, create: { id: h.authId, ...auth }, update: auth });
  console.log(`  ${h.authId.padEnd(18)} ${h.authStatus.padEnd(18)} £${h.amountGBP}  ${h.hireRef}`);
}

async function main() {
  const aged: AgedHold[] = JSON.parse(readFileSync(HOLDS_FILE, 'utf8'));
  console.log(`Aged holds from ${HOLDS_FILE} (live sandbox):`);
  for (const [i, h] of aged.entries()) {
    if (!h.authId) throw new Error(`${HOLDS_FILE}: order ${h.orderId} has no authId yet`);
    const a = await get<PayPalAuthorization>(`/v2/payments/authorizations/${encodeURIComponent(h.authId)}`);
    if (a.amount.currency_code !== 'GBP') throw new Error(`${a.id} is in ${a.amount.currency_code}, not GBP`);
    const createdAt = new Date(a.create_time);
    await upsertHold({
      hireRef: `LH-${BRANCHES[i % 3].slice(0, 3).toUpperCase()}-${String(101 + i).padStart(4, '0')}`,
      branch: BRANCHES[i % 3],
      itemRef: ITEMS[i],
      startAt: createdAt,
      dueBackAt: addDays(createdAt, 4),
      hireStatus: h.role === 'fee' ? 'out' : 'booked',
      seeded: false,
      authId: a.id,
      amountGBP: Number(a.amount.value),
      authStatus: a.status,
      createdAt,
      expiresAt: new Date(a.expiration_time),
    });
    // The spike took these fees outside the app, so holdOf can't count them without a row here.
    if (h.feeCaptureId) {
      const capture = { authorizationId: a.id, approvalId: `spike-${h.feeCaptureId}`, amountGBP: FEE, finalCapture: false, status: 'COMPLETED' };
      await db.capture.upsert({ where: { id: h.feeCaptureId }, create: { id: h.feeCaptureId, ...capture }, update: capture });
    }
  }

  const now = new Date();
  // Test holds: [status, days ago it was authorised, hire status, returned days ago]
  const tests: [string, number, string, number | undefined][] = [
    ['CREATED', 1, 'out', undefined],
    ['VOIDED', 9, 'returned', 5],
    ['CAPTURED', 18, 'settled', 14],
    ['EXPIRED', 34, 'settled', 30],
  ];
  console.log('Seeded test holds:');
  for (const [i, [status, ago, hireStatus, returnedAgo]] of tests.entries()) {
    const createdAt = addDays(now, -ago);
    await upsertHold({
      hireRef: `LH-TST-${String(901 + i).padStart(4, '0')}`,
      branch: BRANCHES[i % 3],
      itemRef: ITEMS[(i + 2) % ITEMS.length],
      startAt: createdAt,
      dueBackAt: addDays(createdAt, 4),
      returnedAt: returnedAgo === undefined ? undefined : addDays(now, -returnedAgo),
      hireStatus,
      seeded: true,
      authId: `SEED-TEST-${i + 1}`,
      amountGBP: FEE + DEPOSIT,
      authStatus: status,
      createdAt,
      expiresAt: addDays(createdAt, 29),
    });
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
