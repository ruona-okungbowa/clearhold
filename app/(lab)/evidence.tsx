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

const MAX_ZOOM = 5;
// The window is this much wider than the box, so the mark is seen against the cloth around it.
const ZOOM_MARGIN = 1.6;

// The boxed area enlarged: a window the same shape as the photo, centred on the box but never past the photo's edge.
function EvidenceZoom({ src, box, alt }: { src: string; box: NonNullable<Box>; alt: string }) {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, 1 / (Math.max(box.w, box.h) * ZOOM_MARGIN)));
  const half = 0.5 / zoom;
  const centre = (at: number, size: number) => Math.min(1 - half, Math.max(half, at + size / 2));
  const shift = (at: number, size: number) => `${(0.5 - centre(at, size)) * 100}%`;
  return (
    <div className={s.photoBox} style={{ overflow: 'hidden' }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a private photo of unknown size, not for the image optimiser */}
      <img src={src} alt={alt} loading="lazy" style={{ transform: `scale(${zoom}) translate(${shift(box.x, box.w)}, ${shift(box.y, box.h)})` }} />
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
  zoom = false,
}: {
  pickupId: string | null;
  returnId: string | null;
  box: Box;
  what: string;
  photo: (id: string) => string;
  captions?: [string, string];
  className?: string;
  zoom?: boolean; // adds a close-up of the boxed area beside the return photo
}) {
  const closeUp = zoom && returnId && box ? { src: photo(returnId), box } : null;
  return (
    <div className={className ?? s.evPair} style={closeUp ? { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' } : undefined}>
      <figure>
        <EvidencePhoto src={pickupId && photo(pickupId)} alt={`${what} at pick-up`} box={box} dashed />
        <figcaption>{captions[0]}</figcaption>
      </figure>
      <figure>
        <EvidencePhoto src={returnId && photo(returnId)} alt={`${what} at return${box ? ', the area circled' : ''}`} box={box} />
        <figcaption>{captions[1]}</figcaption>
      </figure>
      {closeUp && (
        <figure>
          <EvidenceZoom src={closeUp.src} box={closeUp.box} alt={`Close-up of the circled area, ${what} at return`} />
          <figcaption>Close-up</figcaption>
        </figure>
      )}
    </div>
  );
}
