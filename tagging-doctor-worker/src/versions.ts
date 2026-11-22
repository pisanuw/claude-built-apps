import { readFileSync } from 'node:fs';
import path from 'node:path';

/** The TeX Live and veraPDF versions, written into the image when it is built (AC-36). */
export function readVersions(dir: string): { texlive: string; verapdf: string } {
  const read = (name: string) => {
    try {
      return readFileSync(path.join(dir, name), 'utf8').trim().split('\n')[0].slice(0, 120) || 'unknown';
    } catch {
      return 'unknown';
    }
  };
  return { texlive: read('texlive'), verapdf: read('verapdf') };
}
