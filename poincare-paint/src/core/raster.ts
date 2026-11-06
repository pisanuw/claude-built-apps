/**
 * PNG and JPG export settings. The drawing itself goes through the same
 * scene code as the screen canvas; this file holds the pure parts.
 */

export type RasterFormat = 'png' | 'jpg';

export interface RasterSpec {
  mime: 'image/png' | 'image/jpeg';
  ext: RasterFormat;
  /** Encoder quality for lossy formats; undefined for PNG. */
  quality: number | undefined;
  label: string;
}

export const RASTER_FORMATS: Record<RasterFormat, RasterSpec> = {
  png: { mime: 'image/png', ext: 'png', quality: undefined, label: 'PNG' },
  jpg: { mime: 'image/jpeg', ext: 'jpg', quality: 0.92, label: 'JPG' },
};

/** Side of the exported square image, in pixels. */
export const RASTER_SIZE = 2400;

/** Margin between the image edge and the disk rim, in pixels. */
export const RASTER_PAD = 8;

export function exportFileName(p: number, q: number, ext: RasterFormat | 'svg'): string {
  return `poincare-paint-${p}-${q}.${ext}`;
}

/** Human-readable file size, as shown in the status line after an export. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
