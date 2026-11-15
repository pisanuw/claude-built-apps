/**
 * Gets an uploaded image ready to send. The gateway takes at most 1,000,000
 * bytes per request, and the skill plus base64's 4/3 growth leave room for
 * about 700 kB of image. The API also gains nothing from a long edge over
 * 1568 px. Small images go as they are; larger ones are redrawn smaller, as
 * PNG (best for line drawings) or, if that is still too big, as JPEG.
 *
 * Decoding and encoding are injected so tests run without a canvas.
 */
import { InputError, sniffType, toBase64, type MediaType } from './request.ts';

export const MAX_SEND_BYTES = 680_000;
export const MAX_EDGE = 1568;
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export interface Decoded {
  width: number;
  height: number;
  source: unknown;
}

export interface ImageDeps {
  read(file: Blob): Promise<Uint8Array>;
  decode(file: Blob): Promise<Decoded>;
  encode(d: Decoded, width: number, height: number, type: 'image/png' | 'image/jpeg', quality?: number): Promise<Uint8Array>;
}

export interface PreparedImage {
  base64: string;
  mediaType: MediaType;
  width: number;
  height: number;
  bytes: number;
  resized: boolean;
}

export async function prepareImage(file: Blob, deps: ImageDeps = browserImageDeps()): Promise<PreparedImage> {
  if (file.size === 0) throw new InputError('The file is empty.');
  if (file.size > MAX_UPLOAD_BYTES) throw new InputError('The file is larger than 20 MB.');
  const original = await deps.read(file);
  const type = sniffType(original);
  if (!type) throw new InputError('This is not a PNG, JPEG, GIF or WebP image.');
  let d: Decoded;
  try {
    d = await deps.decode(file);
  } catch {
    throw new InputError('The image could not be opened. It may be damaged.');
  }
  const long = Math.max(d.width, d.height);
  if (original.length <= MAX_SEND_BYTES && long <= MAX_EDGE) {
    return { base64: toBase64(original), mediaType: type, width: d.width, height: d.height, bytes: original.length, resized: false };
  }
  let scale = Math.min(1, MAX_EDGE / long);
  for (let attempt = 0; attempt < 4; attempt++, scale *= 0.75) {
    const w = Math.max(1, Math.round(d.width * scale));
    const h = Math.max(1, Math.round(d.height * scale));
    const tries: Array<['image/png' | 'image/jpeg', number | undefined]> = [
      ['image/png', undefined],
      ['image/jpeg', 0.9],
      ['image/jpeg', 0.8],
    ];
    for (const [t, q] of tries) {
      const out = await deps.encode(d, w, h, t, q);
      if (out.length <= MAX_SEND_BYTES) return { base64: toBase64(out), mediaType: t, width: w, height: h, bytes: out.length, resized: true };
    }
  }
  throw new InputError('The image is too detailed to send even after shrinking it. Crop it to the figure and try again.');
}

/* v8 ignore start -- needs a real canvas; covered by the Playwright walkthrough */
export function browserImageDeps(): ImageDeps {
  return {
    read: async (f) => new Uint8Array(await f.arrayBuffer()),
    decode: async (f) => {
      const bmp = await createImageBitmap(f);
      return { width: bmp.width, height: bmp.height, source: bmp };
    },
    encode: (d, width, height, type, quality) =>
      new Promise((resolve, reject) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('This browser cannot resize images.'));
        // A white page behind transparent drawings, which JPEG cannot keep.
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(d.source as CanvasImageSource, 0, 0, width, height);
        canvas.toBlob(
          (b) => (b ? b.arrayBuffer().then((a) => resolve(new Uint8Array(a)), reject) : reject(new Error('Resizing failed.'))),
          type,
          quality,
        );
      }),
  };
}
/* v8 ignore stop */
