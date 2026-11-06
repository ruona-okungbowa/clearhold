import { ApprovalError } from './approval';
import { MoneyError } from './money';

// Production builds hide a thrown action's message from the browser, so client-facing actions return refusals as a
// value. Only our own errors: a database error's message can name the server.
export async function refusal(work: Promise<void>) {
  try {
    await work;
    return null;
  } catch (err) {
    if (err instanceof Error && (err.constructor === Error || err instanceof ApprovalError || err instanceof MoneyError)) return err.message;
    console.error('[action] failed', err);
    return 'Something went wrong; check the audit trail and the server log';
  }
}
