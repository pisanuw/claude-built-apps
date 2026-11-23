/**
 * CR-13, AC-36: the hub's image carries the checker's pinned TeX Live and
 * veraPDF exactly as the worker's image did, its build context holds the
 * three folders, and what it copies is not kept out by its .dockerignore.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = path.resolve(__dirname, '../..');
const read = (p: string) => readFileSync(path.join(REPO, p), 'utf8');
const HUB = read('backend-hub/Dockerfile');
const WORKER = read('tagging-doctor-worker/Dockerfile');

/** The instructions of one stage (FROM ... AS <name> up to the next FROM), without comments or blank lines. */
function stage(text: string, name: string): string[] {
  const lines = text.replace(/\\\n/g, ' ').split('\n').map((l) => l.trim());
  const start = lines.findIndex((l) => new RegExp(`^FROM .* AS ${name}$`).test(l));
  expect(start, name).toBeGreaterThanOrEqual(0);
  const out: string[] = [];
  for (const l of lines.slice(start)) {
    if (out.length && l.startsWith('FROM ')) break;
    if (l && !l.startsWith('#')) out.push(l.replace(/\s+/g, ' '));
  }
  return out;
}

describe('backend-hub/Dockerfile', () => {
  it('has the worker’s "tex" stage line for line (TeX Live and veraPDF pinned, the TeX user, the read-only caches), with only the COPY paths from the root', () => {
    const fromRoot = stage(WORKER, 'tex').map((l) => l.replace(/^COPY docker\//, 'COPY tagging-doctor-worker/docker/'));
    expect(stage(HUB, 'tex')).toEqual(fromRoot);
    expect(stage(HUB, 'tex').join('\n')).toMatch(/texlive\/texlive:latest-full@sha256:[0-9a-f]{64}/);
    expect(stage(HUB, 'tex').join('\n')).toContain('verapdf-greenfield-1.30.4');
  });

  it('runs Node from the same pinned image as the worker', () => {
    expect(stage(HUB, 'node')[0]).toBe(stage(WORKER, 'node')[0]);
  });

  it('builds mult-streak and the hub with npm ci, and runs the hub with the checker named and the jobs root 0711', () => {
    const build = stage(HUB, 'build').join('\n');
    expect(build).toContain('npm --prefix mult-streak ci');
    expect(build).toContain('npm --prefix backend-hub ci');
    expect(build).toContain('npm --prefix backend-hub run build');
    const hub = stage(HUB, 'hub').join('\n');
    expect(hub).toMatch(/^FROM tex AS hub$/m);
    expect(hub).toContain('TAGGING_DOCTOR_CHECKER=/app/tagging-doctor-worker/src/mount.ts');
    expect(hub).toContain('install -d -m 0711 -o root -g root /jobs');
    // mult-streak's players' file is the server's alone: a job's TeX cannot read it.
    expect(hub).toContain('install -d -m 0700 -o root -g root /app/backend-hub/data');
    expect(hub).toContain('CMD ["node", "--disable-warning=ExperimentalWarning", "dist/index.js"]');
    // mult-streak keeps its environment: the image does not set NODE_ENV.
    expect(HUB).not.toMatch(/NODE_ENV/);
  });

  it('takes its files from backend-hub/, mult-streak/, tagging-doctor-worker/ and the footer script, each let in by its .dockerignore', () => {
    const copies = [...HUB.matchAll(/^COPY (?!--from)(\S+)/gm)].map((m) => m[1]);
    const roots = new Set(copies.map((c) => c.split('/')[0]));
    expect([...roots].sort()).toEqual(['backend-hub', 'mult-streak', 'scripts', 'tagging-doctor-worker']);
    const allow = read('backend-hub/Dockerfile.dockerignore').split('\n').filter((l) => l.startsWith('!')).map((l) => l.slice(1));
    expect(read('backend-hub/Dockerfile.dockerignore')).toMatch(/^\*$/m);
    for (const c of copies) {
      expect(allow.some((a) => c === a || c.startsWith(a + '/')), c).toBe(true);
      expect(existsSync(path.join(REPO, c)), c).toBe(true);
    }
  });
});
