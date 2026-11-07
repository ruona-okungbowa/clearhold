// Browser only. Shrinks a photo before upload: keeps requests under Vercel's 4.5 MB limit, and Claude reads no more
// than about 1,568 px on the long edge anyway. A file the browser can't decode (e.g. HEIC on desktop) goes as it is.

const LONG_EDGE = 1568;

export async function shrink(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, LONG_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the photo'))), 'image/jpeg', 0.85),
    );
  } catch {
    return file;
  }
}

// Stores one photo through /api/photos; returns the stored row's id and server time, or throws the route's message.
export async function uploadPhoto(fields: Record<string, string>, file: File, name: string) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  body.set('photo', await shrink(file), name);
  const res = await fetch('/api/photos', { method: 'POST', body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? res.statusText);
  return json as { id: string; sha256: string; serverAt: string };
}
