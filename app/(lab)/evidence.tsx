// A pick-up and return photo side by side, with the inspector's box ringed on the return photo. The wrapper takes
// the image's own shape, so the box's fractions of the image land in the right place.

import s from './screens.module.css';

export type Box = { x: number; y: number; w: number; h: number } | null;

export function EvidencePhoto({ src, alt, box, dashed }: { src: string | null; alt: string; box?: Box; dashed?: boolean }) {
  if (!src) return <div className={s.noPhoto}>No photo</div>;
  return (
    <div className={s.photoBox}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a private photo of unknown size, not for the image optimiser */}
      <img src={src} alt={alt} loading="lazy" />
      {box && (
        <span
          className={dashed ? s.boxRingEmpty : s.boxRing}
          style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }}
        />
      )}
    </div>
  );
}

// photo(id) builds the URL: staff pages use /api/photos/id, the renter's page adds their link as ?t=.
export function EvidencePair({
  pickupId,
  returnId,
  box,
  what,
  photo,
  captions = ['Pick-up', 'Return'],
  className,
}: {
  pickupId: string | null;
  returnId: string | null;
  box: Box;
  what: string;
  photo: (id: string) => string;
  captions?: [string, string];
  className?: string;
}) {
  return (
    <div className={className ?? s.evPair}>
      <figure>
        <EvidencePhoto src={pickupId && photo(pickupId)} alt={`${what} at pick-up`} box={box} dashed />
        <figcaption>{captions[0]}</figcaption>
      </figure>
      <figure>
        <EvidencePhoto src={returnId && photo(returnId)} alt={`${what} at return${box ? ', the area circled' : ''}`} box={box} />
        <figcaption>{captions[1]}</figcaption>
      </figure>
    </div>
  );
}
