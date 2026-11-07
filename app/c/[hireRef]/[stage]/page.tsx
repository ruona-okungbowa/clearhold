import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { RenterPage } from '@/app/(lab)/chrome';
import { itemName } from '@/lib/catalogue';
import { db } from '@/lib/db';
import { Capture } from './capture';

export const metadata: Metadata = { title: 'Condition photos' };

// Why Send can't run on this hire right now; the photos can still be (re)taken unless it is settled.
function lockedReason(status: string, stage: string) {
  if (status === 'settled') return 'This hire is settled, so its photos are final.';
  if (stage === 'pickup' && status !== 'booked') return 'Already handed over. Retaking a photo replaces it on the record.';
  if (stage === 'return' && status === 'booked') return 'Not handed over yet: take the pick-up photos first.';
  if (stage === 'return' && status === 'contested') return 'The renter contested this hire: resolve it on the findings page.';
  return null;
}

// The counter phone's pick-up and return photos. Staff only (proxy.ts, and /api/photos checks the cookie).
export default async function CapturePage({ params }: PageProps<'/c/[hireRef]/[stage]'>) {
  const { hireRef, stage } = await params;
  if (stage !== 'pickup' && stage !== 'return') notFound();
  const hire = await db.hire.findUnique({ where: { hireRef }, include: { photos: { where: { stage } } } });
  if (!hire) notFound();

  return (
    <RenterPage>
      <Capture
        hireRef={hireRef}
        stage={stage}
        itemName={itemName(hire.itemRef)}
        stored={Object.fromEntries(hire.photos.map((p) => [p.angle, { id: p.id, at: p.serverAt.toISOString() }]))}
        locked={lockedReason(hire.status, stage)}
      />
    </RenterPage>
  );
}
