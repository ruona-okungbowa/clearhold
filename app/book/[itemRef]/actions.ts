'use server';

import { randomUUID } from 'node:crypto';
import { auditScope } from '@/lib/audit';
import { db } from '@/lib/db';
import { authorizeOrder, createHoldOrder } from '@/lib/money';
import { ITEMS } from '@/lib/schedule';

const DAY = 86_400_000;
const HONOUR_DAYS = 3;

function itemOf(itemRef: string) {
  const item = ITEMS[itemRef];
  if (!item) throw new Error(`Unknown item ${itemRef}`);
  return { ...item, holdGBP: (item.feeGBP + item.depositGBP).toFixed(2) };
}

// The PayPal button's createOrder: one AUTHORIZE order for fee plus deposit, tagged with a new hire ref.
export async function startBooking(itemRef: string) {
  const item = itemOf(itemRef);
  const hireRef = `LH-${item.branch.slice(0, 3).toUpperCase()}-${randomUUID().slice(0, 5).toUpperCase()}`;
  const order = await auditScope.run(hireRef, () => createHoldOrder(`order-${hireRef}`, item.holdGBP, hireRef));
  return { orderId: order.id!, hireRef };
}

// The button's onApprove: places the hold, then records the hire and its authorization.
// hireRef and orderId come from the browser, so both are checked against what PayPal returns.
export async function confirmBooking(itemRef: string, hireRef: string, orderId: string) {
  const item = itemOf(itemRef);
  return auditScope.run(hireRef, async () => {
    const order = await authorizeOrder(`authorize-${orderId}`, orderId);
    const unit = order.purchaseUnits?.[0];
    const auth = unit?.payments?.authorizations?.[0];
    if (unit?.referenceId !== hireRef || !auth?.id) throw new Error(`Order ${orderId} does not belong to hire ${hireRef}`);
    if (auth.amount?.currencyCode !== 'GBP' || auth.amount.value !== item.holdGBP)
      throw new Error(`Hold is ${auth.amount?.value} ${auth.amount?.currencyCode}, expected ${item.holdGBP} GBP`);

    const now = new Date();
    const createdAt = new Date(auth.createTime!);
    const hire = await db.hire.upsert({
      where: { hireRef },
      update: {},
      create: {
        hireRef,
        branch: item.branch,
        itemRef,
        feeGBP: item.feeGBP,
        depositGBP: item.depositGBP,
        startAt: now,
        dueBackAt: new Date(now.getTime() + item.hireDays * DAY),
        status: 'booked',
      },
    });
    await db.authorization.upsert({
      where: { id: auth.id },
      update: { status: auth.status! },
      create: {
        id: auth.id,
        hireId: hire.id,
        amountGBP: auth.amount.value,
        status: auth.status!,
        createdAt,
        honourEndsAt: new Date(createdAt.getTime() + HONOUR_DAYS * DAY),
        expiresAt: new Date(auth.expirationTime!),
      },
    });
    return hireRef;
  });
}
