// One-off sandbox test harness (not part of the app): moves PP-R-MBY-10198331 to "PayPal asks the seller for evidence".
import { auditScope } from '../lib/audit';
import { db } from '../lib/db';
import { canDo, getDispute, post } from '../lib/paypal';
const id = 'PP-R-MBY-10198331';
const show = (d: Awaited<ReturnType<typeof getDispute>>) => `${d.status} ${d.dispute_life_cycle_stage} [${(d.links ?? []).map((l) => l.rel).join(',')}]`;
(async () => {
  await auditScope.run('LH-HAL-14622', async () => {
    let d = await getDispute(id);
    console.log('before', show(d));
    if (canDo(d, 'escalate')) {
      const r = await post('sandbox.escalate', `/v1/customer/disputes/${id}/escalate`, `sandbox-escalate-${id}`, { note: 'Sandbox test: escalating to a claim so PayPal can request seller evidence.' });
      console.log('escalate', r.status, r.debugId);
    }
    for (let i = 0; i < 40 && !canDo(d, 'require_evidence'); i++) {
      await new Promise((r) => setTimeout(r, 15000));
      d = await getDispute(id);
      console.log('poll', show(d));
    }
    if (canDo(d, 'require_evidence')) {
      const r = await post('sandbox.requireEvidence', `/v1/customer/disputes/${id}/require-evidence`, `sandbox-require-evidence-${id}`, { action: 'SELLER_EVIDENCE' });
      console.log('require-evidence', r.status, r.debugId);
      d = await getDispute(id);
      console.log('after', show(d), d.seller_response_due_date);
    } else console.log('no require_evidence link yet');
  });
})().catch((e) => console.log('ERR', e.message)).finally(() => db.$disconnect());
