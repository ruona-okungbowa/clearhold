import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { ANGLES, STAGES } from '@/lib/schedule';
import { CaptureForm } from './capture-form';

export const metadata: Metadata = { title: 'Condition photos' };

export default async function CapturePage({ params }: PageProps<'/c/[hireRef]/[stage]'>) {
  const { hireRef, stage } = await params;
  if (!STAGES.some((s) => s === stage)) notFound();
  const hire = await db.hire.findUnique({ where: { hireRef }, include: { photos: { where: { stage } } } });
  if (!hire) notFound();
  const stored = Object.fromEntries(hire.photos.map((p) => [p.angle, { sha256: p.sha256, serverAt: p.serverAt.toISOString() }]));

  return (
    <main>
      <p>
        <Link href={`/hire/${hireRef}`}>← Hire {hireRef}</Link>
      </p>
      <h1>{stage === 'pickup' ? 'Pick-up' : 'Return'} photos</h1>
      <p>
        Six photos, one per angle, on a hanger against a plain background in good light. Take them in any order and as
        often as you like: the last one taken for an angle is the one kept. These photos{' '}
        {stage === 'pickup' ? 'are your proof of how it left the shop' : 'are compared with the pick-up photos'}.
      </p>
      <CaptureForm hireRef={hireRef} stage={stage} angles={ANGLES} stored={stored} />
    </main>
  );
}
