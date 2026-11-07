'use server';

// The PayPal button's two calls: createOrder places nothing, onApprove authorizes the hold and records the hire.
// Everything the browser sends is checked again here, and the hold amount against what PayPal returns.

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { auditScope } from '@/lib/audit';
import { clashes, collectAt, isoOf, londonToday, returnBy, startAllowed } from '@/lib/booking';
import { itemOf, SHOP_CODES } from '@/lib/catalogue';
import { db } from '@/lib/db';
import { authorizeOrder, createHoldOrder } from '@/lib/money';

const DAY = 86_400_000;
const HONOUR_DAYS = 3;

const Booking = z.object({
  itemRef: z.string().max(40),
  branch: z.string().refine((b) => b in SHOP_CODES, 'Unknown shop'),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type BookingInput = z.infer<typeof Booking>;

async function checked(input: BookingInput, exceptHireRef?: string) {
  const { itemRef, branch, start } = Booking.parse(input); // reachable by direct POST
  const item = itemOf(itemRef);
  if (!item?.look) throw new Error('That look is not in the catalogue');
  if (!startAllowed(start, londonToday())) throw new Error('Pick a collection day from tomorrow, within the next three weeks');
  const hires = await db.hire.findMany({
    where: { itemRef, status: { not: 'settled' }, ...(exceptHireRef && { hireRef: { not: exceptHireRef } }) },
    select: { itemRef: true, startAt: true, dueBackAt: true },
  });
  if (clashes(start, hires.map((h) => ({ itemRef: h.itemRef, start: isoOf(h.startAt), end: isoOf(h.dueBackAt) }))))
    throw new Error(`${item.name} is already out on those dates; pick another day or size`);
  return { itemRef, branch, start, item, holdGBP: (item.feeGBP + item.depositGBP).toFixed(2) };
}

export async function startBooking(input: BookingInput) {
  const { branch, holdGBP } = await checked(input);
  const hireRef = `LH-${SHOP_CODES[branch]}-${randomUUID().slice(0, 5).toUpperCase()}`;
  const order = await auditScope.run(hireRef, () => createHoldOrder(`order-${hireRef}`, holdGBP, hireRef));
  return { orderId: order.id!, hireRef };
}

// hireRef and orderId come from the browser, so both are checked against what PayPal returns.
export async function confirmBooking(input: BookingInput, hireRef: string, orderId: string) {
  const { itemRef, branch, start, item, holdGBP } = await checked(input, hireRef);
  if (!hireRef.startsWith(`LH-${SHOP_CODES[branch]}-`)) throw new Error('That booking is for another shop');
  return auditScope.run(hireRef, async () => {
    const order = await authorizeOrder(`authorize-${orderId}`, orderId);
    const unit = order.purchaseUnits?.[0];
    const auth = unit?.payments?.authorizations?.[0];
    if (unit?.referenceId !== hireRef || !auth?.id) throw new Error(`Order ${orderId} does not belong to hire ${hireRef}`);
    if (auth.amount?.currencyCode !== 'GBP' || auth.amount.value !== holdGBP)
      throw new Error(`Hold is ${auth.amount?.value} ${auth.amount?.currencyCode}, expected ${holdGBP} GBP`);

    const createdAt = new Date(auth.createTime!);
    const hire = await db.hire.upsert({
      where: { hireRef },
      update: {},
      create: {
        hireRef,
        branch,
        itemRef,
        feeGBP: item.feeGBP,
        depositGBP: item.depositGBP,
        startAt: collectAt(start),
        dueBackAt: returnBy(start),
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
