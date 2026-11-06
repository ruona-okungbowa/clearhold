'use client';

// Six numbered camera inputs. Each photo is shrunk in the browser (keeps uploads under the 4.5 MB request
// limit; Claude reads no more than about 1,568 px on the long edge) and stored as soon as it is taken.

import { useState } from 'react';

type Stored = { sha256: string; serverAt: string };
const LONG_EDGE = 1568;

const describe = (p: Stored) => `Stored at ${new Date(p.serverAt).toLocaleString('en-GB')} (server time), SHA-256 ${p.sha256.slice(0, 16)}…`;

export async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, LONG_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the photo'))), 'image/jpeg', 0.85),
  );
}

export function CaptureForm({
  hireRef,
  stage,
  angles,
  stored,
}: {
  hireRef: string;
  stage: string;
  angles: readonly { id: string; label: string }[];
  stored: Record<string, Stored>;
}) {
  const [status, setStatus] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(stored).map(([angle, p]) => [angle, describe(p)])),
  );
  const set = (angle: string, text: string) => setStatus((s) => ({ ...s, [angle]: text }));

  async function upload(angle: string, file: File) {
    set(angle, 'Uploading…');
    try {
      // A browser that can't decode the file (e.g. HEIC on desktop) sends it as it is.
      const photo = await shrink(file).catch(() => file);
      const body = new FormData();
      body.set('hireRef', hireRef);
      body.set('stage', stage);
      body.set('angle', angle);
      body.set('photo', photo, `${angle}.jpg`);
      const res = await fetch('/api/photos', { method: 'POST', body });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      set(angle, describe(json));
    } catch (err) {
      set(angle, `Not stored: ${err instanceof Error ? err.message : err}. Take it again.`);
    }
  }

  return (
    <ol>
      {angles.map((a) => (
        <li key={a.id}>
          <label>
            {a.label}
            <br />
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload(a.id, file);
              }}
            />
          </label>
          <p aria-live="polite">{status[a.id] ?? 'Not taken yet'}</p>
        </li>
      ))}
    </ol>
  );
}
