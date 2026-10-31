// Day-1 money spike (plan P6): runs the eight sandbox checks in GBP and prints a pass/fail table.
//   npm run spike:money                         creates two £88 holds, waits for you to approve both as the sandbox buyer
//   npm run spike:money -- <orderA> <orderB>    resumes with orders already created
//   npm run spike:money -- aged-create          six aged holds (2 fee captured, 2 untouched, 2 spare); re-run to resume
//   npm run spike:money -- aged-reauth          from day 4: checks 9 and 10 reauthorise an untouched and a part-captured hold
// Hold A: fee capture, replay, final capture. Hold B: fee capture, early reauthorize, void.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  authorizeOrder,
  callListeners,
  capture,
  createHoldOrder,
  getAuthorization,
  getOrder,
  MoneyError,
  reauthorize,
  voidHold,
  type CallLog,
} from '../lib/money';
import { get } from '../lib/paypal';
import { ApprovalError, createApproval } from '../lib/approval';

const approve = async (authorizationId: string, maxGBP: string, finalCapture: boolean) =>
  (await createApproval({ authorizationId, maxGBP, finalCapture, approver: 'spike' })).token;

const FEE = '28.00';
const HOLD_TOTAL = '88.00'; // £28 fee + £60 deposit
const DAMAGES = '24.00';
const APPROVAL_TIMEOUT_MS = 20 * 60_000;
// The dev server's webhook receiver; PayPal reaches it through a tunnel to localhost:3000.
const RECEIVER_URL = process.env.WEBHOOK_RECEIVER_URL ?? 'http://localhost:3000/api/paypal/webhook';

const run = Date.now().toString(36);
const rid = (step: string) => `spike-${run}-${step}`;
const startedAt = new Date();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

type Row = { n: number; check: string; result: 'PASS' | 'FAIL' | 'PART'; detail: string; debugIds: string[] };
const rows: Row[] = [];

let calls: CallLog[] = [];
callListeners.push((e) => calls.push(e));

// Runs one check and records its debug ids; returns false on failure so blockers can stop the run.
async function check(n: number, name: string, fn: () => Promise<{ ok: boolean | 'part'; detail: string }>) {
  calls = [];
  let result: Row['result'];
  let detail: string;
  try {
    const out = await fn();
    result = out.ok === 'part' ? 'PART' : out.ok ? 'PASS' : 'FAIL';
    detail = out.detail;
  } catch (err) {
    result = 'FAIL';
    detail = message(err);
  }
  rows.push({ n, check: name, result, detail, debugIds: calls.map((c) => `${c.op}:${c.debugId ?? '-'}`) });
  console.log(`  #${n} ${result} ${detail}`);
  return result !== 'FAIL';
}

function printTable(checks: number[]) {
  console.log('\n#  Result  Check / detail / paypal-debug-ids');
  for (const r of rows.sort((a, b) => a.n - b.n)) {
    console.log(`${r.n}  ${r.result.padEnd(6)}  ${r.check}`);
    console.log(`           ${r.detail}`);
    if (r.debugIds.length) console.log(`           ${r.debugIds.join('  ')}`);
  }
  const failed = rows.filter((r) => r.result === 'FAIL').map((r) => r.n);
  const notRun = checks.filter((n) => !rows.some((r) => r.n === n));
  if (notRun.length) console.log(`\nNot run: ${notRun.join(', ')}`);
  const verdict = failed.some((n) => [3, 5, 6, 10].includes(n))
    ? 'switch to Plan B (check 3, 5, 6 or 10 failed)'
    : notRun.length || failed.length
      ? 'undecided, see failures'
      : 'Plan A confirmed';
  console.log(`Money model: ${verdict}`);
}

async function waitForApproval(orderIds: string[]) {
  const deadline = Date.now() + APPROVAL_TIMEOUT_MS;
  const pending = new Set(orderIds);
  while (pending.size) {
    if (Date.now() > deadline) throw new Error(`not approved within 20 min: ${[...pending].join(', ')}`);
    for (const id of pending) if ((await getOrder(id)).status === 'APPROVED') pending.delete(id);
    if (pending.size) await sleep(5_000);
  }
}

function authorizationOf(order: Awaited<ReturnType<typeof authorizeOrder>>) {
  const a = order.purchaseUnits?.[0]?.payments?.authorizations?.[0];
  if (!a?.id) throw new Error(`order ${order.id} has no authorization`);
  return a;
}

async function main() {
  let [orderA, orderB] = process.argv.slice(2);
  let authA = '';
  let authB = '';
  let feeCaptureA = '';
  let feeTokenA = '';
  // Resources each webhook (check 8) should mention.
  const expected: [event: string, resourceId: string][] = [];

  const created = await check(1, `Create AUTHORIZE orders, £${HOLD_TOTAL} GBP (x2)`, async () => {
    if (orderA && orderB) {
      const [a, b] = await Promise.all([getOrder(orderA), getOrder(orderB)]);
      return { ok: a.intent === 'AUTHORIZE' && b.intent === 'AUTHORIZE', detail: `resumed ${a.id} (${a.status}), ${b.id} (${b.status})` };
    }
    const [a, b] = await Promise.all([
      createHoldOrder(rid('order-a'), HOLD_TOTAL, 'spike-hold-a'),
      createHoldOrder(rid('order-b'), HOLD_TOTAL, 'spike-hold-b'),
    ]);
    orderA = a.id!;
    orderB = b.id!;
    console.log('\n>>> Approve BOTH orders as the sandbox buyer (personal account). Leave this running:');
    for (const o of [a, b]) console.log(`    ${o.links?.find((l) => l.rel === 'approve' || l.rel === 'payer-action')?.href}`);
    console.log(`>>> Polling every 5 s for 20 min. To resume later: npm run spike:money -- ${a.id} ${b.id}\n`);
    return { ok: a.status === 'CREATED' && b.status === 'CREATED', detail: `${a.id}, ${b.id}` };
  });
  if (!created) return;

  const authorized = await check(2, 'Buyer approves, then authorize: CREATED, 29-day expiry', async () => {
    await waitForApproval([orderA, orderB]);
    const [a, b] = await Promise.all([authorizeOrder(rid('auth-a'), orderA), authorizeOrder(rid('auth-b'), orderB)]);
    const [ha, hb] = [authorizationOf(a), authorizationOf(b)];
    authA = ha.id!;
    authB = hb.id!;
    expected.push(['PAYMENT.AUTHORIZATION.CREATED', authA], ['PAYMENT.AUTHORIZATION.CREATED', authB]);
    const days = (Date.parse(ha.expirationTime!) - Date.parse(ha.createTime!)) / 86_400_000;
    return {
      ok: ha.status === 'CREATED' && hb.status === 'CREATED' && Math.round(days) === 29,
      detail: `A ${authA} ${ha.status}, B ${authB} ${hb.status}; expires ${ha.expirationTime} (${days.toFixed(1)} days)`,
    };
  });
  if (!authorized) return;

  await check(3, `Capture £${FEE}, final_capture false: auth PARTIALLY_CAPTURED`, async () => {
    feeTokenA = await approve(authA, FEE, false);
    const c = await capture(feeTokenA, FEE);
    feeCaptureA = c.id!;
    expected.push(['PAYMENT.CAPTURE.COMPLETED', c.id!]);
    const a = await getAuthorization(authA);
    return { ok: c.status === 'COMPLETED' && a.status === 'PARTIALLY_CAPTURED', detail: `capture ${c.id} ${c.status}; auth ${a.status}` };
  });

  // Since Day 3 every capture spends a single-use approval, so a replay is refused before it reaches PayPal.
  await check(4, 'Replay that capture with the same approval: refused, no duplicate', async () => {
    try {
      const c = await capture(feeTokenA, FEE);
      return { ok: false, detail: `replay went through as ${c.id} (first was ${feeCaptureA || 'none'})` };
    } catch (err) {
      return { ok: err instanceof ApprovalError, detail: message(err) };
    }
  });

  await check(5, `Second capture £${DAMAGES}, final_capture true: rest released`, async () => {
    const c = await capture(await approve(authA, DAMAGES, true), DAMAGES);
    expected.push(['PAYMENT.CAPTURE.COMPLETED', c.id!]);
    const a = await getAuthorization(authA);
    return { ok: c.status === 'COMPLETED' && a.status === 'CAPTURED', detail: `capture ${c.id} ${c.status}; auth ${a.status} (£36 left uncaptured)` };
  });

  // Hold B takes its fee first, so check 7 hits a part-captured hold and check 6 voids after a partial capture.
  let feeB: string;
  try {
    const c = await capture(await approve(authB, FEE, false), FEE);
    feeB = `${c.id} ${c.status}`;
    expected.push(['PAYMENT.CAPTURE.COMPLETED', c.id!]);
  } catch (err) {
    feeB = `failed: ${message(err)}`;
  }

  await check(7, 'Reauthorize on day 1: 422 REAUTHORIZATION_TOO_SOON', async () => {
    try {
      const r = await reauthorize(rid('b-reauth'), authB, '60.00');
      return { ok: false, detail: `unexpectedly succeeded: new auth ${r.id} ${r.status}` };
    } catch (err) {
      if (!(err instanceof MoneyError)) throw err;
      return { ok: err.status === 422 && err.issue === 'REAUTHORIZATION_TOO_SOON', detail: `${err.status} ${err.issue}` };
    }
  });

  await check(6, 'Void hold B after its fee capture: VOIDED', async () => {
    const v = await voidHold(rid('b-void'), authB);
    // The void may come back with no body; read the authorization then.
    const status = v?.status ?? (await getAuthorization(authB)).status;
    expected.push(['PAYMENT.AUTHORIZATION.VOIDED', authB]);
    return { ok: status === 'VOIDED', detail: `B fee capture ${feeB}; auth ${status}` };
  });

  await check(8, 'Webhooks for steps 2, 3, 5, 6 arrive and verify', async () => {
    const iso = (d: Date) => `${d.toISOString().slice(0, 19)}Z`;
    const key = ([event, id]: [string, string]) => `${event}|${id}`;
    let missing = expected;
    // The events list lagged delivery by a few minutes in sandbox, so poll for up to 5.
    for (let i = 0; i < 30 && missing.length; i++) {
      if (i) await sleep(10_000);
      const { events = [] } = await get<{ events?: { event_type: string; resource?: { id?: string } }[] }>(
        `/v1/notifications/webhooks-events?page_size=100&start_time=${iso(startedAt)}&end_time=${iso(new Date())}`,
      );
      const listed = new Set(events.map((e) => key([e.event_type, e.resource?.id ?? ''])));
      missing = expected.filter((x) => !listed.has(key(x)));
    }
    // Signatures: the receiver (app/api/paypal/webhook) verifies each delivery and lists what passed.
    let unverified = expected;
    let receiver = '';
    for (let i = 0; i < 30 && unverified.length; i++) {
      if (i) await sleep(10_000);
      try {
        const res = await fetch(RECEIVER_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const done = new Set(((await res.json()) as { eventType: string; resourceId?: string }[]).map((e) => key([e.eventType, e.resourceId ?? ''])));
        unverified = expected.filter((x) => !done.has(key(x)));
      } catch (err) {
        receiver = ` (receiver ${RECEIVER_URL} unreachable: ${message(err)})`;
        break;
      }
    }
    const [a, b] = await Promise.all([getAuthorization(authA), getAuthorization(authB)]);
    return {
      ok: missing.length ? false : unverified.length ? 'part' : true,
      detail:
        `${expected.length - missing.length}/${expected.length} events listed` +
        (missing.length ? `; missing ${missing.map(key).join(', ')}` : '') +
        `; ${expected.length - unverified.length}/${expected.length} signatures verified${receiver}` +
        `. Fallback poll: A ${a.status}, B ${b.status}`,
    };
  });
}

// Aged holds (plan P6) live across days, so their ids are kept in a file between runs.
const HOLDS_FILE = 'scripts/.aged-holds.json';
type AgedHold = { role: 'fee' | 'untouched' | 'spare'; orderId: string; authId?: string; feeCaptureId?: string };
const saveHolds = (holds: AgedHold[]) => writeFileSync(HOLDS_FILE, JSON.stringify(holds, null, 2));

async function agedCreate() {
  let holds: AgedHold[];
  if (existsSync(HOLDS_FILE)) {
    holds = JSON.parse(readFileSync(HOLDS_FILE, 'utf8'));
    console.log(`Resuming the batch in ${HOLDS_FILE}`);
  } else {
    const roles = ['fee', 'fee', 'untouched', 'untouched', 'spare', 'spare'] as const;
    const orders = await Promise.all(
      roles.map((role, i) => createHoldOrder(rid(`aged-${i}`), HOLD_TOTAL, `aged-${role}-${i}`)),
    );
    holds = orders.map((o, i) => ({ role: roles[i], orderId: o.id! }));
    saveHolds(holds);
  }
  const todo = holds.filter((h) => !h.authId || (h.role === 'fee' && !h.feeCaptureId));
  if (!todo.length) throw new Error(`${HOLDS_FILE} is a finished batch; move it aside to start another`);

  const unapproved = todo.filter((h) => !h.authId).map((h) => h.orderId);
  if (unapproved.length) {
    console.log(`\n>>> Approve these ${unapproved.length} orders as the sandbox buyer. Leave this running:`);
    for (const id of unapproved) console.log(`    https://www.sandbox.paypal.com/checkoutnow?token=${id}`);
    await waitForApproval(unapproved);
  }
  // Request ids are tied to the order or authorization, not this run, so a resumed run replays instead of repeating.
  for (const h of todo) {
    h.authId ??= authorizationOf(await authorizeOrder(`aged-auth-${h.orderId}`, h.orderId)).id!;
    saveHolds(holds);
    if (h.role === 'fee') {
      h.feeCaptureId = (await capture(await approve(h.authId, FEE, false), FEE)).id!;
      saveHolds(holds);
    }
  }
  for (const h of holds) console.log(`  ${h.role.padEnd(9)} order ${h.orderId}  auth ${h.authId}  fee ${h.feeCaptureId ?? '-'}`);
  console.log(`Saved to ${HOLDS_FILE}. Run aged-reauth from day 4.`);
}

async function agedReauth() {
  if (!existsSync(HOLDS_FILE)) throw new Error(`no ${HOLDS_FILE}; run aged-create first`);
  const holds: AgedHold[] = JSON.parse(readFileSync(HOLDS_FILE, 'utf8'));
  const untouched = holds.find((h) => h.role === 'untouched' && h.authId);
  const partCaptured = holds.find((h) => h.role === 'fee' && h.feeCaptureId);
  if (!untouched || !partCaptured) throw new Error(`${HOLDS_FILE} has no finished untouched and fee holds`);

  const cases = [
    [9, untouched, HOLD_TOTAL, 'an untouched hold'],
    [10, partCaptured, '60.00', 'a part-captured hold (£60 left)'],
  ] as const;
  for (const [n, hold, amount, label] of cases) {
    await check(n, `Reauthorize ${label} after day 3: new authorization`, async () => {
      const before = await getAuthorization(hold.authId!);
      const days = (Date.now() - Date.parse(before.createTime!)) / 86_400_000;
      const r = await reauthorize(rid(`aged-reauth-${n}`), hold.authId!, amount);
      hold.authId = r.id!; // later reauthorisations and captures use the new authorization
      saveHolds(holds);
      return { ok: r.status === 'CREATED', detail: `hold ${days.toFixed(1)} days old; new auth ${r.id} ${r.status}` };
    });
  }
}

const mode = process.argv[2];
const [job, checks] =
  mode === 'aged-create' ? [agedCreate, []] : mode === 'aged-reauth' ? [agedReauth, [9, 10]] : [main, [1, 2, 3, 4, 5, 6, 7, 8]];

job()
  .catch((err) => console.error('spike aborted:', message(err)))
  .finally(() => checks.length && printTable(checks));
