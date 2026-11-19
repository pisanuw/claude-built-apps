/** Fixture folders as zips, for the unit tests and the Playwright walkthrough. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, type Zippable } from 'fflate';

export const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** Every file of a fixture folder, keyed by its path inside the fixture. */
export function fixtureFiles(name: string): Record<string, Uint8Array> {
  const root = path.join(FIXTURES, name);
  const out: Record<string, Uint8Array> = {};
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else out[path.relative(root, full).split(path.sep).join('/')] = new Uint8Array(fs.readFileSync(full));
    }
  };
  walk(root);
  return out;
}

/** A fixture folder as a zip, optionally inside a top folder (as "Compress folder" makes it). */
export function zipFixture(name: string, prefix = ''): Uint8Array {
  const files: Zippable = {};
  for (const [p, bytes] of Object.entries(fixtureFiles(name)).sort(([a], [b]) => a.localeCompare(b))) {
    files[prefix + p] = [bytes, { mtime: new Date(1980, 0, 1) }];
  }
  return zipSync(files);
}


/**
 * AC-1's size: the `blockers` project grown to 50 files and about 5 MB, with
 * chapters of text that the main file inputs and incompressible "images".
 */
export function fiftyFileZip(): Uint8Array {
  const files: Zippable = {};
  const enc = new TextEncoder();
  const chapters: string[] = [];
  for (let i = 1; i <= 40; i++) {
    const name = `chapters/ch${i}.tex`;
    chapters.push(`\\input{chapters/ch${i}}`);
    files[name] = [enc.encode(`\\section{Chapter ${i}}\n${'Some text about matrices and $x^2$. '.repeat(800)}\n`), { mtime: new Date(1980, 0, 1) }];
  }
  let seed = 1;
  for (let i = 1; i <= 9; i++) {
    const img = new Uint8Array(540 * 1024);
    for (let j = 0; j < img.length; j++) img[j] = (seed = (seed * 1103515245 + 12345) & 0x7fffffff) & 0xff;
    files[`img/figure${i}.png`] = [img, { mtime: new Date(1980, 0, 1), level: 0 }];
  }
  const main = new TextDecoder().decode(fixtureFiles('blockers')['main.tex']).replace('Solve the following.', chapters.join('\n'));
  files['main.tex'] = [enc.encode(main), { mtime: new Date(1980, 0, 1) }];
  return zipSync(files);
}
