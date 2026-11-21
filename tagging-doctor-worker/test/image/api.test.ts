/**
 * The worker as deployed, against the built image: health (AC-36), tokens,
 * origins and ownership (AC-28), the queue (AC-33), the files of a job
 * (AC-34) and the TeX user's processes (AC-64), on the math-notes fixture.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { docker, FIXTURES, folderZip, freshToken, TOKEN_A, TOKEN_B, Worker, type JobView } from './harness.ts';

const MATH_NOTES = folderZip(path.join(FIXTURES, 'math-notes'));
let w: Worker;
beforeAll(async () => {
  w = await Worker.start();
});
afterAll(async () => {
  await w?.stop();
});

/**
 * Every process of uid 10001 seen while `during` runs: its name, command line,
 * environment names and a few values. Read from the host through the
 * container's cgroup (cgroup v1), since root inside the container has no
 * CAP_SYS_PTRACE to read another user's environment.
 */
async function watchTexUser<T>(during: () => Promise<T>): Promise<{ value: T; seen: string[] }> {
  const id = docker(['inspect', '-f', '{{.Id}}', w.name]).trim();
  const procs = `/sys/fs/cgroup/pids/docker/${id}/cgroup.procs`;
  const seen = new Set<string>();
  const sample = () => {
    let pids: string[] = [];
    try {
      pids = readFileSync(procs, 'utf8').split('\n').filter(Boolean);
    } catch {
      return;
    }
    for (const pid of pids) {
      try {
        const uids = /^Uid:\s+(.*)$/m.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1].trim().split(/\s+/);
        if (!uids || uids.some((u) => u !== '10001')) continue;
        const comm = readFileSync(`/proc/${pid}/comm`, 'utf8').trim();
        const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').join(' ');
        const env = readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').filter(Boolean);
        if (!cmd.trim() || env.length === 0) continue; // caught while exiting
        const names = env.map((e) => e.split('=')[0]).sort().join(',');
        const values = env.filter((e) => /^(TMPDIR|HOME|openout_any|shell_escape|TEXMFVAR)=/.test(e)).join(',');
        seen.add(`PROC|${comm}|${cmd}|${names}|${values}`);
      } catch {
        /* ended meanwhile */
      }
    }
  };
  const timer = setInterval(sample, 50);
  try {
    const value = await during();
    return { value, seen: [...seen] };
  } finally {
    clearInterval(timer);
  }
}

describe('AC-36: the health route of the image', () => {
  it('answers with the pinned TeX Live and veraPDF, and a passing self-test', async () => {
    const r = await fetch(`${w.base}/api/health`);
    expect(r.status).toBe(200);
    const h = (await r.json()) as Record<string, unknown>;
    expect(Object.keys(h).sort()).toEqual(['compile', 'queue', 'selfTest', 'status', 'texlive', 'verapdf']);
    expect(h).toMatchObject({
      status: 'ok',
      compile: true,
      texlive: 'This is LuaHBTeX, Version 1.24.0 (TeX Live 2026)',
      verapdf: 'veraPDF 1.30.4',
      selfTest: { separateUser: true, serverUid: 0, texUid: 10001, texRuns: true, serverFileHidden: true },
      queue: { running: 0, waiting: 0, maxWaiting: 3 },
    });
  });
});

describe('AC-28 on the image', () => {
  it('401 without a token; CORS for the app only', async () => {
    expect((await w.submit(MATH_NOTES, 'main.tex', 'not-a-valid-token-xxxxxxxx')).status).toBe(401);
    const pre = await fetch(`${w.base}/api/jobs`, { method: 'OPTIONS', headers: { origin: 'https://tagging-doctor.hintwise.org' } });
    expect(pre.headers.get('access-control-allow-origin')).toBe('https://tagging-doctor.hintwise.org');
    const no = await fetch(`${w.base}/api/jobs`, { method: 'OPTIONS', headers: { origin: 'http://localhost:5173' } });
    expect(no.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('AC-64 and AC-34: a real job on math-notes', () => {
  let job: JobView;
  let seen: string[] = [];

  it('compiles and validates math-notes, as the TeX user with the flags and a minimal environment', async () => {
    expect(w.exec(['stat', '-c', '%a %U', '/jobs']).trim()).toBe('711 root');
    const watched = await watchTexUser(() => w.run(MATH_NOTES));
    job = watched.value;
    seen = watched.seen;
    expect(job.status).toBe('done');
    expect(job.result).toMatchObject({ pages: 22, runs: 2, validation: { compliant: false, profile: 'PDF/UA-2 + Tagged PDF validation profile', verapdfVersion: 'veraPDF 1.30.4' } });

    const tex = seen.filter((l) => l.split('|')[1] === 'lualatex' || l.split('|')[1] === 'luahbtex');
    const java = seen.filter((l) => l.split('|')[1] === 'java');
    expect(tex.length).toBeGreaterThan(0);
    expect(java.length).toBeGreaterThan(0);
    const jobDir = `/jobs/${job.id}/`;
    for (const l of tex) {
      const [, , cmd, names, values] = l.split('|');
      expect(cmd).toContain('--nosocket');
      expect(cmd).toContain('--no-shell-escape');
      expect(cmd).not.toContain('--shell-escape ');
      expect(cmd).toMatch(/ \.\/main\.tex $/);
      expect(names.split(',')).toEqual(['HOME', 'LANG', 'PATH', 'TEXMFCACHE', 'TEXMFVAR', 'TMPDIR', 'openout_any', 'shell_escape']);
      expect(values).toContain(`HOME=${jobDir}home`);
      expect(values).toContain(`TMPDIR=${jobDir}tmp`);
      expect(values).toContain('openout_any=p');
    }
    for (const l of java) {
      const [, , cmd, names, values] = l.split('|');
      expect(cmd).toContain(`-Djava.io.tmpdir=${jobDir}tmp`);
      expect(cmd).toContain('-Xmx192m');
      expect(names.split(',')).toEqual(['HOME', 'LANG', 'PATH', 'TMPDIR']);
      expect(values).toContain(`TMPDIR=${jobDir}tmp`);
    }
    // No process of the server's ran TeX: every lualatex and java seen was the TeX user's (uid 10001 in all four ids).
    expect(seen.every((l) => !/SUPABASE|NODE_ENV|JOBS_ROOT|PORT/.test(l))).toBe(true);
  });

  it('deletes the sources at the end, keeps the PDF out of the TeX user\'s reach, and serves it to its owner only', async () => {
    expect(w.exec(['sh', '-c', `test -e /jobs/${job.id} && echo there || echo gone`]).trim()).toBe('gone');
    expect(w.exec(['sh', '-c', `test -e /jobs/${job.id}.zip && echo there || echo gone`]).trim()).toBe('gone');
    expect(w.exec(['stat', '-c', '%a %U', `/jobs/${job.id}.out`]).trim()).toBe('700 root');
    expect(w.exec(['stat', '-c', '%U', `/jobs/${job.id}.out/main.pdf`]).trim()).toBe('root');
    const asTex = docker(['exec', w.name, 'sh', '-c', `setpriv --reuid=10001 --regid=10001 --clear-groups cat /jobs/${job.id}.out/main.pdf >/dev/null 2>&1 && echo read || echo refused`]);
    expect(asTex.trim()).toBe('refused');
    const pdf = await fetch(`${w.base}/api/jobs/${job.id}/pdf`, { headers: { authorization: `Bearer ${TOKEN_A}` } });
    expect(pdf.status).toBe(200);
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
    expect((await fetch(`${w.base}/api/jobs/${job.id}/pdf`, { headers: { authorization: `Bearer ${TOKEN_B}` } })).status).toBe(404);
  });

  it('AC-33: one runs, 3 wait as zips of the server user that are not unpacked, and the next request gets 429 busy', async () => {
    const tokens = [1, 2, 3, 4, 5].map(() => freshToken());
    const ids: string[] = [];
    for (const t of tokens.slice(0, 4)) {
      const r = await w.submit(MATH_NOTES, 'main.tex', t);
      expect(r.status).toBe(202);
      ids.push(((await r.json()) as { id: string }).id);
    }
    const busy = await w.submit(MATH_NOTES, 'main.tex', tokens[4]);
    expect(busy.status).toBe(429);
    expect(((await busy.json()) as { error: string }).error).toBe('The checker is busy, try again in a minute.');
    const queued = ids[3];
    expect(w.exec(['stat', '-c', '%a %U', `/jobs/${queued}.zip`]).trim()).toBe('600 root');
    expect(w.exec(['sh', '-c', `test -e /jobs/${queued} && echo unpacked || echo zip`]).trim()).toBe('zip');
    for (let i = 0; i < 4; i++) expect((await w.waitFor(ids[i], ['done', 'failed'], tokens[i])).status).toBe('done');
  });

  it('AC-34: after a restart every job is gone (404)', async () => {
    docker(['restart', w.name]);
    const t0 = Date.now();
    while (Date.now() - t0 < 60_000) {
      try {
        if ((await fetch(`${w.base}/api/health`)).ok) break;
      } catch {
        /* restarting */
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    w.exec(['sh', '-c', 'install -d -m 0755 /srv/planted /srv/hint']);
    expect((await fetch(`${w.base}/api/jobs/${job.id}`, { headers: { authorization: `Bearer ${TOKEN_A}` } })).status).toBe(404);
    expect((await fetch(`${w.base}/api/jobs/${job.id}/pdf`, { headers: { authorization: `Bearer ${TOKEN_A}` } })).status).toBe(404);
    expect(w.exec(['ls', '-A', '/jobs']).trim()).toBe('');
  });
});
