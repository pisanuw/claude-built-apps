/**
 * Gets a figure's image ready to send with a draft request (AC-50), on the
 * pattern of lewis-alt-text's `src/core/image.ts` (SPEC §2, no shared code):
 * the gateway takes at most 1,000,000 bytes per request, and base64's 4/3
 * growth plus the prompt leave room for about 680 kB of image. The API gains
 * nothing from a long edge over 1568 px. A small image goes as it is; a
 * larger one is redrawn smaller, as PNG (best for line drawings) or, if that
 * is still too big, as JPEG.
 *
 * Decoding and encoding are injected, so tests run without a canvas.
 */
export const MAX_SEND_BYTES = 680_000;
export const MAX_EDGE = 1568;

export type MediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

export interface Decoded {
  width: number;
  height: number;
  source: unknown;
}

export interface ImageDeps {
  decode(bytes: Uint8Array, type: MediaType): Promise<Decoded>;
  encode(d: Decoded, width: number, height: number, type: 'image/png' | 'image/jpeg', quality?: number): Promise<Uint8Array>;
}

export interface PreparedImage {
  base64: string;
  mediaType: MediaType;
  bytes: number;
  resized: boolean;
}

/** Why an image is not sent; the draft then goes from the text only. */
export class ImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageError';
  }
}

/** The type from the file's first bytes, not its name. */
export function sniffType(b: Uint8Array): MediaType | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length > 11 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** Base64 without Buffer, so the same code runs in the browser. */
export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** At most MAX_SEND_BYTES, or an ImageError. */
export async function prepareImage(original: Uint8Array, deps: ImageDeps): Promise<PreparedImage> {
  if (!original.length) throw new ImageError('The image file is empty.');
  const type = sniffType(original);
  if (!type) throw new ImageError('The file is not a PNG, JPEG, GIF or WebP image.');
  let d: Decoded;
  try {
    d = await deps.decode(original, type);
  } catch {
    throw new ImageError('The image could not be opened. It may be damaged.');
  }
  const long = Math.max(d.width, d.height);
  if (original.length <= MAX_SEND_BYTES && long <= MAX_EDGE) return { base64: toBase64(original), mediaType: type, bytes: original.length, resized: false };
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
      if (out.length <= MAX_SEND_BYTES) return { base64: toBase64(out), mediaType: t, bytes: out.length, resized: true };
    }
  }
  throw new ImageError('The image is too detailed to send even after shrinking it.');
}

/* v8 ignore start -- needs a real canvas; the Playwright walkthrough runs it */
export function browserImageDeps(): ImageDeps {
  return {
    decode: async (bytes, type) => {
      const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type }));
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
        canvas.toBlob((b) => (b ? b.arrayBuffer().then((a) => resolve(new Uint8Array(a)), reject) : reject(new Error('Resizing failed.'))), type, quality);
      }),
  };
}
/* v8 ignore stop */
