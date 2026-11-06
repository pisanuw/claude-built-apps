import { describe, expect, it } from 'vitest';
import { RASTER_FORMATS, RASTER_PAD, RASTER_SIZE, exportFileName, formatBytes } from '../src/core/raster';

describe('raster export settings', () => {
  it('maps each format to its MIME type and extension', () => {
    expect(RASTER_FORMATS.png).toMatchObject({ mime: 'image/png', ext: 'png', quality: undefined });
    expect(RASTER_FORMATS.jpg.mime).toBe('image/jpeg');
    expect(RASTER_FORMATS.jpg.ext).toBe('jpg');
    expect(RASTER_FORMATS.jpg.quality).toBeGreaterThan(0.8);
    expect(RASTER_FORMATS.jpg.quality).toBeLessThanOrEqual(1);
  });

  it('exports a large square with room for the rim', () => {
    expect(RASTER_SIZE).toBeGreaterThanOrEqual(2000);
    expect(RASTER_SIZE).toBeLessThanOrEqual(4096);
    expect(RASTER_PAD).toBeGreaterThan(0);
  });

  it('names files after the tiling', () => {
    expect(exportFileName(7, 3, 'png')).toBe('poincare-paint-7-3.png');
    expect(exportFileName(4, 5, 'jpg')).toBe('poincare-paint-4-5.jpg');
    expect(exportFileName(5, 4, 'svg')).toBe('poincare-paint-5-4.svg');
  });

  it('formats byte counts', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});
