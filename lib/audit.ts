// The audit trail: every PayPal call, model call and human approval becomes an AuditEvent row.
// Server actions run their work inside auditScope.run(hireRef, ...) so deep callers (the money service)
// tag their rows with the hire without threading it through every signature.

import { AsyncLocalStorage } from 'node:async_hooks';
import { db } from './db';
import type { Prisma } from './generated/prisma/client';

export const auditScope = new AsyncLocalStorage<string>();

export async function audit(event: Omit<Prisma.AuditEventCreateInput, 'hireRef'> & { hireRef?: string }) {
  const data = { ...event, hireRef: event.hireRef ?? auditScope.getStore() };
  try {
    await db.auditEvent.create({ data });
  } catch (err) {
    // A failed audit write must not lose the result of a money call that already happened; shout instead.
    console.error('[audit] write failed', JSON.stringify(data), err);
  }
}
