/**
 * AC-2: the viewer pair in the hub's image is the pinned one, read from what
 * is installed, and Chromium's system libraries are the TeX image's own, at
 * the versions listed in chromium-libs.txt (DECISIONS.md D-41): a change of
 * the base image that moves one of them fails here and shows in review.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { docker, IMAGE } from './harness.ts';

const run = (script: string) => docker(['run', '--rm', '--network', 'none', '--entrypoint', 'sh', IMAGE, '-c', script]);

describe('AC-2: the pins in the image', () => {
  it('has Chrome for Testing 158.0.8127.36 and pdf.js 6.5.438 installed, and nothing else of pdf.js but its browser files', () => {
    expect(run('/opt/chrome/chrome-headless-shell --version').trim()).toBe('Google Chrome for Testing 158.0.8127.36');
    expect(JSON.parse(run('cat /app/heard-as-check-worker/node_modules/pdfjs-dist/package.json')).version).toBe('6.5.438');
    const files = run('cd /app/heard-as-check-worker/node_modules/pdfjs-dist && ls').split('\n').filter(Boolean).sort();
    expect(files).not.toContain('legacy');
    expect(files).toEqual(expect.arrayContaining(['build', 'cmaps', 'standard_fonts', 'wasm', 'web']));
    expect(run('ls /app/heard-as-check-worker/node_modules').trim()).toBe('pdfjs-dist');
  });

  it('links Chromium only against libraries present in the image, at the listed versions', () => {
    const missing = run('ldd /opt/chrome/chrome-headless-shell | grep "not found" || true').trim();
    expect(missing).toBe('');
    const now = run(
      'ldd /opt/chrome/chrome-headless-shell | awk \'{print $3}\' | grep / | xargs -n1 readlink -f | xargs dpkg -S 2>/dev/null | cut -d: -f1 | sort -u | xargs dpkg-query -W -f \'${Package} ${Version}\\n\'',
    ).trim();
    const listed = readFileSync(path.join(__dirname, 'chromium-libs.txt'), 'utf8')
      .split('\n')
      .filter((l) => l && !l.startsWith('#'))
      .join('\n');
    expect(now).toBe(listed);
  });

  it('runs the capture as hacjob, uid 10002, and keeps /hac-jobs the server\'s with mode 0711', () => {
    expect(run('id -u hacjob; id -g hacjob').trim()).toBe('10002\n10002');
    expect(run('stat -c "%a %U" /hac-jobs').trim()).toBe('711 root');
    expect(run('echo $HEARD_AS_CHECK_MOUNT').trim()).toBe('/app/heard-as-check-worker/src/mount.ts');
  });
});
