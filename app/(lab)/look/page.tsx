import { permanentRedirect } from 'next/navigation';

// Old links and the demo video use /look?l=<slug>.
export default async function OldLookLink({ searchParams }: PageProps<'/look'>) {
  const { l } = await searchParams;
  permanentRedirect(typeof l === 'string' ? `/looks/${encodeURIComponent(l)}` : '/looks');
}
