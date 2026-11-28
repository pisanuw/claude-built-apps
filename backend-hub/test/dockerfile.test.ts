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
    // NODE_ENV=production, which Render gave the native hub and does not give a Docker service (R4b.1-1):
    // Express hides stack traces, and mult-streak refuses to start without COOKIE_SECRET, as before.
    expect(hub).toMatch(/^ENV NODE_ENV=production /m);
    expect(stage(HUB, 'build').join('\n')).not.toMatch(/NODE_ENV/); // npm ci still installs the build's dev tools
  });

  it('takes its files from backend-hub/, mult-streak/, tagging-doctor-worker/, heard-as-check-worker/ and the footer script, each let in by its .dockerignore', () => {
    const copies = [...HUB.matchAll(/^COPY (?!--from)(\S+)/gm)].map((m) => m[1]);
    const roots = new Set(copies.map((c) => c.split('/')[0]));
    expect([...roots].sort()).toEqual(['backend-hub', 'heard-as-check-worker', 'mult-streak', 'scripts', 'tagging-doctor-worker']);
    const allow = read('backend-hub/Dockerfile.dockerignore').split('\n').filter((l) => l.startsWith('!')).map((l) => l.slice(1));
    expect(read('backend-hub/Dockerfile.dockerignore')).toMatch(/^\*$/m);
    for (const c of copies) {
      expect(allow.some((a) => c === a || c.startsWith(a + '/')), c).toBe(true);
      expect(existsSync(path.join(REPO, c)), c).toBe(true);
    }
  });
});

/** The build filter's `paths` and `ignoredPaths` from deploy/target.yml (a plain list under each key). */
function filterList(key: 'paths' | 'ignoredPaths'): string[] {
  const text = read('backend-hub/deploy/target.yml');
  const m = new RegExp(`^ {4}${key}:\\n((?: {6}- .*\\n)+)`, 'm').exec(text);
  expect(m, key).not.toBeNull();
  return (m as RegExpExecArray)[1].split('\n').filter(Boolean).map((l) => l.replace(/^ {6}- /, '').replace(/^'(.*)'$/, '$1'));
}

/** True when a glob of the build filter (`**` any depth, `*` one name part) matches `p`. */
function globMatch(glob: string, p: string): boolean {
  const re = new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\0').replace(/\*/g, '[^/]*').replace(/\0/g, '.*')}$`);
  return re.test(p);
}

describe('Heard-As Check\'s capture in the image (AC-2, AC-24, S3-4)', () => {
  const copies = [...HUB.matchAll(/^COPY (?:heard-as-check-worker\/\S+ )+/gm)].flatMap((m) => m[0].replace(/^COPY /, '').trim().split(' '));

  it('fetches Chromium by an exact version and checks it by sha256; no other download in the capture\'s stage', () => {
    const chrome = stage(HUB, 'chrome').join('\n');
    expect(stage(HUB, 'chrome')[0]).toBe('FROM tex AS chrome');
    expect(chrome).toContain('ARG CHROME_URL=https://storage.googleapis.com/chrome-for-testing-public/158.0.8127.36/linux64/chrome-headless-shell-linux64.zip');
    expect(chrome).toMatch(/ARG CHROME_SHA256=[0-9a-f]{64}/);
    expect(chrome).toContain('echo "$CHROME_SHA256 /tmp/chs.zip" | sha256sum -c -');
    // One download in the stage, and it is the checked one; no apt-get anywhere in the capture's lines.
    expect(chrome.match(/curl /g)).toHaveLength(1);
    expect(chrome).not.toMatch(/apt-get|wget|npm i(nstall)? /);
    expect(stage(HUB, 'hub').join('\n')).not.toMatch(/curl |wget |apt-get/);
  });

  it('pins pdf.js by an exact version, installs it with npm ci from the lock, and reads nothing else from npm for the capture', () => {
    const pkg = JSON.parse(read('heard-as-check-worker/package.json')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies).toEqual({ 'pdfjs-dist': '6.5.438' });
    const lock = JSON.parse(read('heard-as-check-worker/package-lock.json')) as { packages: Record<string, { version?: string; integrity?: string }> };
    expect(lock.packages['node_modules/pdfjs-dist']).toMatchObject({ version: '6.5.438', integrity: expect.stringMatching(/^sha512-/) });
    const build = stage(HUB, 'build').join('\n');
    expect(build).toContain('npm --prefix heard-as-check-worker ci --omit=dev --omit=optional --ignore-scripts');
    expect(stage(HUB, 'hub').join('\n')).toContain('COPY --from=build /src/heard-as-check-worker/node_modules/pdfjs-dist /app/heard-as-check-worker/node_modules/pdfjs-dist');
  });

  it('runs the capture as hacjob (uid 10002, neither root nor texjob) with its jobs root 0711, and names the mount', () => {
    const hub = stage(HUB, 'hub').join('\n');
    expect(hub).toContain('COPY --from=chrome /opt/chrome /opt/chrome');
    expect(hub).toContain('useradd --uid 10002 --gid 10002 --no-create-home');
    expect(hub).toContain('install -d -m 0711 -o root -g root /hac-jobs');
    expect(hub).toContain('HEARD_AS_CHECK_MOUNT=/app/heard-as-check-worker/src/mount.ts');
  });

  it('copies heard-as-check-worker/ parts that the .dockerignore lets in and the build filter watches; its tests and spike are in neither (AC-24, S3-4)', () => {
    expect(copies.sort()).toEqual(['heard-as-check-worker/package-lock.json', 'heard-as-check-worker/package.json', 'heard-as-check-worker/package.json', 'heard-as-check-worker/src', 'heard-as-check-worker/static']);
    const ignore = read('backend-hub/Dockerfile.dockerignore');
    const paths = filterList('paths');
    const ignored = filterList('ignoredPaths');
    for (const c of new Set(copies)) {
      expect(ignore, c).toContain(`!${c}`);
      // A file inside each copied part makes Render rebuild the hub.
      const inside = c.endsWith('.json') ? c : `${c}/x.ts`;
      expect(paths.some((g) => globMatch(g, inside)), inside).toBe(true);
      expect(ignored.some((g) => globMatch(g, inside)), inside).toBe(false);
    }
    expect(paths.filter((p) => p.startsWith('heard-as-check-worker/')).length).toBeGreaterThan(0);
    // A change to the worker's tests, its image tests or the spike does not deploy the hub.
    for (const p of ['heard-as-check-worker/test/server.test.ts', 'heard-as-check-worker/test/image/capture.test.ts', 'heard-as-check-worker/spike/spike.mjs', 'heard-as-check-worker/vitest.config.ts', 'heard-as-check-worker/README.md']) {
      expect(paths.some((g) => globMatch(g, p)) && !ignored.some((g) => globMatch(g, p)), p).toBe(false);
      expect(ignore, p).not.toMatch(new RegExp(`^!${p.split('/').slice(0, 2).join('/')}$`, 'm'));
    }
    // Nor does a page-only change (the app's folder stays out of the filter until M6).
    for (const p of ['heard-as-check/src/core/engine.ts', 'heard-as-check/deploy/target.yml', 'heard-as-check/test/fixtures/generate.ts']) {
      expect(paths.some((g) => globMatch(g, p)), p).toBe(false);
    }
  });

  it('globMatch reads the filter\'s globs as Render does', () => {
    expect(globMatch('heard-as-check-worker/src/**', 'heard-as-check-worker/src/a/b.ts')).toBe(true);
    expect(globMatch('heard-as-check-worker/src/**', 'heard-as-check-worker/srcx/a.ts')).toBe(false);
    expect(globMatch('**/*.md', 'heard-as-check-worker/README.md')).toBe(true);
    expect(globMatch('backend-hub/**', 'backend-hub/test/x.ts')).toBe(true);
  });
});
