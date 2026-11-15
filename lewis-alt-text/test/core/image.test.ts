import { describe, expect, it, vi } from 'vitest';
import { MAX_EDGE, MAX_SEND_BYTES, prepareImage, type ImageDeps } from '../../src/core/image';

const PNG = [0x89, 0x50, 0x4e, 0x47];
const JPG = [0xff, 0xd8, 0xff];
const bytes = (head: number[], size: number) => {
  const b = new Uint8Array(size);
  b.set(head);
  return b;
};
const blob = (size: number) => ({ size }) as Blob;

function deps(original: Uint8Array, width: number, height: number, encodeSizes: Record<string, number> = {}): ImageDeps & { encode: ReturnType<typeof vi.fn> } {
  return {
    read: async () => original,
    decode: async () => ({ width, height, source: null }),
    encode: vi.fn(async (_d, _w, _h, type: string, q?: number) => {
      const size = encodeSizes[`${type}${q ?? ''}`] ?? encodeSizes[type] ?? 100;
      return bytes(type === 'image/png' ? PNG : JPG, size);
    }),
  };
}

describe('prepareImage', () => {
  it('sends a small image as it is', async () => {
    const d = deps(bytes(PNG, 5000), 400, 300);
    const r = await prepareImage(blob(5000), d);
    expect(r).toMatchObject({ mediaType: 'image/png', width: 400, height: 300, bytes: 5000, resized: false });
    expect(d.encode).not.toHaveBeenCalled();
  });
  it('shrinks a large picture to the longest useful edge, as PNG', async () => {
    const d = deps(bytes(PNG, 5000), 3136, 1000);
    const r = await prepareImage(blob(5000), d);
    expect(r).toMatchObject({ mediaType: 'image/png', width: MAX_EDGE, height: 500, resized: true });
  });
  it('falls back to JPEG when PNG is still too big', async () => {
    const d = deps(bytes(PNG, MAX_SEND_BYTES + 1), 1000, 800, { 'image/png': MAX_SEND_BYTES + 1, 'image/jpeg0.9': MAX_SEND_BYTES + 1, 'image/jpeg0.8': 1000 });
    const r = await prepareImage(blob(MAX_SEND_BYTES + 1), d);
    expect(r).toMatchObject({ mediaType: 'image/jpeg', width: 1000, resized: true, bytes: 1000 });
  });
  it('gives up with advice when nothing fits', async () => {
    const d = deps(bytes(JPG, MAX_SEND_BYTES + 1), 1000, 800, { 'image/png': 9e6, 'image/jpeg': 9e6 });
    await expect(prepareImage(blob(MAX_SEND_BYTES + 1), d)).rejects.toThrow(/Crop it/);
    expect(d.encode).toHaveBeenCalledTimes(12);
  });
  it('refuses empty, huge, non-image and broken files', async () => {
    await expect(prepareImage(blob(0), deps(bytes(PNG, 10), 1, 1))).rejects.toThrow(/empty/);
    await expect(prepareImage(blob(21 * 1024 * 1024), deps(bytes(PNG, 10), 1, 1))).rejects.toThrow(/20 MB/);
    await expect(prepareImage(blob(10), deps(new TextEncoder().encode('hello world!'), 1, 1))).rejects.toThrow(/not a PNG/);
    const broken = { ...deps(bytes(PNG, 10), 1, 1), decode: async () => Promise.reject(new Error('bad')) };
    await expect(prepareImage(blob(10), broken)).rejects.toThrow(/could not be opened/);
  });
});
