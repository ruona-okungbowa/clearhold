// The morning reauthorisation sweep, called daily by Vercel Cron (vercel.json), which sends CRON_SECRET as a bearer
// token. With no secret set the route stays shut. One hold failing doesn't stop the rest, and a failure is retried next morning.

import { auditScope } from '@/lib/audit';
import { holdsDueForReauth, reauthorizeHire } from '@/lib/hold';

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const reauthorized: string[] = [];
  const failed: { hireRef: string; error: string }[] = [];
  for (const { hire } of await holdsDueForReauth()) {
    try {
      await auditScope.run(hire.hireRef, () => reauthorizeHire(hire.hireRef));
      reauthorized.push(hire.hireRef);
    } catch (err) {
      failed.push({ hireRef: hire.hireRef, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return Response.json({ reauthorized, failed }, { status: failed.length ? 500 : 200 });
}
