/**
 * The capture mount in the hub's image, at 0.5 CPU and 512 MB (AC-12, AC-14,
 * AC-15, AC-17, AC-18, AC-20 to AC-24). Polls of health once a second during a
 * job are what AC-18, AC-21 and AC-24 ask for; nothing else waits on the
 * clock but the polling of a job's status (D-31).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixture, freshToken, Hub, MB, sampler, socketsOf, TOKEN_A, TOKEN_B } from './harness.ts';

let hub: Hub;
beforeAll(async () => {
  hub = await Hub.start();
});
afterAll(async () => {
  await hub?.stop();
});

/** Polls health once a second while `work` runs; returns every status seen. */
async function pollingHealth<T>(work: () => Promise<T>): Promise<{ value: T; statuses: number[]; hub: number[]; checker: number[] }> {
  const statuses: number[] = [];
  const hubStatuses: number[] = [];
  const checker: number[] = [];
  let done = false;
  const poll = (async () => {
    while (!done) {
      const [a, b, c] = await Promise.all([
        fetch(`${hub.base}/api/health`, { signal: AbortSignal.timeout(5_000) }).then((r) => r.status, () => 0),
        fetch(`${hub.root}/api/health`, { signal: AbortSignal.timeout(5_000) }).then((r) => r.status, () => 0),
        fetch(`${hub.root}/tagging-doctor/api/health`, { signal: AbortSignal.timeout(5_000) }).then((r) => r.status, () => 0),
      ]);
      statuses.push(a);
      hubStatuses.push(b);
      checker.push(c);
      await new Promise((r) => setTimeout(r, 1_000));
    }
  })();
  try {
    const value = await work();
    return { value, statuses, hub: hubStatuses, checker };
  } finally {
    done = true;
    await poll;
  }
}

const heard = (r: Record<string, any>) => r.heard as { r: string; n?: string; pr?: { level?: number }; c: string[]; i: string; g?: number }[];

describe('AC-23: the self-test and health', () => {
  it('passes in the image: health says capture true with the installed versions and payloadVersion 1', async () => {
    const h = await hub.health();
    expect(h).toMatchObject({ status: 'ok', capture: true, payloadVersion: 1, pdfjs: '6.5.438', chromium: '158.0.8127.36', verapdf: expect.stringContaining('1.30.4') });
    expect((h.selfTest as { sandbox: { namespaced: number } }).sandbox.namespaced).toBeGreaterThan(0);
  });
});

describe('AC-12: what a job returns', () => {
  it('basic.pdf: the heard tree has the heading, a table of 3 rows with its header cells, and "Chart of sales"; the versions and veraPDF\'s result', async () => {
    const { job, result } = await hub.run(fixture('basic'));
    expect(job.status).toBe('done');
    const r = result as Record<string, any>;
    expect(r.payloadVersion).toBe(1);
    expect(r.viewer).toEqual({ pdfjs: '6.5.438', chromium: '158.0.8127.36' });
    const nodes = heard(r).filter((n) => !n.g);
    const heading = nodes.find((n) => n.r === 'heading');
    expect(heading?.pr?.level).toBe(1);
    // The heading's text is heard, as text after the structure: pdf.js's aria-owns into a `display: contents` span is not followed (D-39).
    expect(nodes.some((n) => n.r === 'StaticText' && n.n === 'Quarterly sales')).toBe(true);
    const table = nodes.find((n) => n.r === 'table');
    expect(table?.c).toHaveLength(3);
    expect(nodes.filter((n) => n.r === 'row')).toHaveLength(3);
    expect(nodes.filter((n) => n.r === 'columnheader')).toHaveLength(2);
    expect(nodes.some((n) => n.r === 'figure' && n.n === 'Chart of sales')).toBe(true);
    expect(r.verapdf).toMatchObject({ compliant: true, version: 'veraPDF 1.30.4', declared: true, failedRules: 0 });
    expect(r.verapdf.profile).toMatch(/PDF\/UA-1/);
    expect(r.file).toMatchObject({ pages: 1, pagesRead: 1, bytes: fixture('basic').length });
    expect(r.markedContent).toBeNull();
  });

  it('roles.pdf: part 1 holds roles, alt (Alt, else ActualText), the table attributes and content ids; the figure without alt has none', async () => {
    const { result } = await hub.run(fixture('roles'));
    const roles: string[] = [];
    const figures: { alt?: string }[] = [];
    let scope = 0;
    let contentIds = 0;
    const walk = (n: any) => {
      if (!n) return;
      if (n.t) {
        if (n.t === 'content' && /_mc\d+$/.test(n.id)) contentIds++;
        return;
      }
      roles.push(n.r);
      if (n.r === 'Figure') figures.push({ alt: n.alt });
      if (n.scope) scope++;
      (n.k ?? []).forEach(walk);
    };
    for (const p of (result as Record<string, any>).structTrees) walk(p.tree);
    for (const r of ['H1', 'H2', 'H3', 'P', 'L', 'LI', 'Lbl', 'LBody', 'Link', 'Table', 'TR', 'TH', 'TD', 'Figure']) expect(roles, r).toContain(r);
    expect(figures).toEqual([{ alt: 'A bar chart of the two values' }, { alt: undefined }]);
    expect(scope).toBe(2);
    expect(contentIds).toBeGreaterThan(10);
    expect((result as Record<string, any>).verapdf.compliant).toBe(false);
  });

  it('good-rtl.pdf and rtl-reversed.pdf: the Hebrew paragraph\'s lang and ActualText, and the show-text strings in storage order (part 2)', async () => {
    const good = (await hub.run(fixture('good-rtl'))).result as Record<string, any>;
    const rev = (await hub.run(fixture('rtl-reversed'))).result as Record<string, any>;
    const he = (r: Record<string, any>) => {
      let found: any = null;
      const walk = (n: any) => {
        if (!n || n.t) return;
        if (n.lang === 'he') found = n;
        (n.k ?? []).forEach(walk);
      };
      for (const p of r.structTrees) walk(p.tree);
      return found;
    };
    expect(he(good)).toMatchObject({ r: 'P', lang: 'he', alt: 'שלום עולם' });
    expect(he(rev).alt).toBeUndefined();
    for (const r of [good, rev]) {
      const run = r.runs.find((x: any) => /[א-ת]/.test(x.text));
      expect(run).toMatchObject({ p: 1, tag: 'P', tags: [], text: 'םלוע םולש' });
      expect(Number.isInteger(run.mcid)).toBe(true);
    }
  });

  it('control-rowspan.pdf: the structure tree carries RowSpan 2', async () => {
    const r = (await hub.run(fixture('control-rowspan'))).result as Record<string, any>;
    expect(JSON.stringify(r.structTrees)).toContain('"rowSpan":2');
  });
});

describe('AC-17: the upload', () => {
  it('refuses more than 10 MB with 413 and a file that is not a PDF with 400', async () => {
    const big = Buffer.alloc(10 * MB + 1, 0x20);
    big.write('%PDF-');
    const r = await hub.submit(big, freshToken());
    expect(r.status).toBe(413);
    expect(((await r.json()) as { error: string }).error).toContain('10 MB');
    const z = await hub.submit(Buffer.from('PK\u0003\u0004 not a pdf'), freshToken());
    expect(z.status).toBe(400);
    expect(((await z.json()) as { error: string }).error).toBe('This does not look like a PDF.');
  });

  it('says a password-protected PDF needs its password removed, and reads a PDF with no tags with the sentence', async () => {
    const pw = await hub.run(fixture('password'));
    expect(pw.job).toMatchObject({ status: 'failed', failure: { reason: 'password', message: 'This PDF is password protected. Remove the password and try again.' } });
    const nt = await hub.run(fixture('no-tags'));
    expect(nt.job.status).toBe('done');
    expect((nt.result as Record<string, any>).tagged).toBe(false);
    expect((nt.result as Record<string, any>).notes).toContain('This PDF has no tags: a screen reader has only the plain text to go on.');
  });
});

describe('AC-18: the limits', () => {
  it('a 75-page PDF: pages 1 to 60 are read, and the result says so', async () => {
    const r = (await hub.run(fixture('seventy-five-pages'))).result as Record<string, any>;
    expect(r.file).toMatchObject({ pages: 75, pagesRead: 60 });
    expect(r.notes).toContain('Read the first 60 of 75 pages.');
    expect(Math.max(...heard(r).map((n: any) => n.p))).toBe(60);
  });

  it('many-glyphs.pdf passes the output cap: "This file is too large to read.", and health answers 200 at every poll', async () => {
    const { value, statuses, hub: hubS, checker } = await pollingHealth(() => hub.run(fixture('many-glyphs')));
    expect(value.job).toMatchObject({ status: 'failed', failure: { reason: 'output-cap', message: 'This file is too large to read.' } });
    expect(statuses.length).toBeGreaterThan(0);
    expect(statuses.every((s) => s === 200)).toBe(true);
    expect(hubS.every((s) => s === 200)).toBe(true);
    expect(checker.every((s) => s === 200)).toBe(true);
  });
});

describe('AC-21: a hostile structure tree', () => {
  it('deep-tree.pdf ends within 90 seconds with a plain message, health answering 200 at every poll; the cut is said', async () => {
    const t0 = Date.now();
    const { value, statuses } = await pollingHealth(() => hub.run(fixture('deep-tree')));
    expect(Date.now() - t0).toBeLessThan(95_000);
    expect(statuses.every((s) => s === 200)).toBe(true);
    if (value.job.status === 'done') {
      const r = value.result as Record<string, any>;
      expect(r.structCut).toBe(true);
      expect(r.notes).toContain('The structure tree is deeper than 40 levels; pdf.js reads only the first 40.');
    } else {
      expect(value.job.failure?.message).toMatch(/^[A-Z][^{}<>]+\.$/);
    }
  });
});

describe('AC-15: a hostile PDF', () => {
  it('pdf.js runs with font faces, eval and scripting off; no request leaves the page; no connection while veraPDF runs', async () => {
    const token = freshToken();
    const sub = await hub.submit(fixture('hostile'), token);
    const { id } = (await sub.json()) as { id: string };
    const seenDuringVerapdf: string[] = [];
    let validating = false;
    const job = await hub.waitFor(id, token, 120_000, async () => {
      const j = await hub.job(id, token);
      if (j.stage === 'validating') validating = true;
      if (validating) seenDuringVerapdf.push(...socketsOf(10002));
    });
    expect(job.status).toBe('done');
    const r = await hub.result(id, token);
    expect(r.pdfjsOptions).toEqual({ disableFontFace: true, isEvalSupported: false, enableScripting: false });
    expect(r.requests).toEqual({ outside: 0 });
    expect(seenDuringVerapdf).toEqual([]);
    expect(r.verapdf).not.toBeNull();
  });
});

describe('AC-26: ownership', () => {
  it('another person\'s token gets 404 and nothing of the job; no token 401', async () => {
    const sub = await hub.submit(fixture('basic'), TOKEN_A);
    expect(sub.status).toBe(202);
    const { id } = (await sub.json()) as { id: string };
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    await hub.waitFor(id, TOKEN_A);
    const b = await fetch(`${hub.base}/api/jobs/${id}/result`, { headers: { authorization: `Bearer ${TOKEN_B}` } });
    expect(b.status).toBe(404);
    expect(await b.text()).not.toContain('heard');
    expect((await fetch(`${hub.base}/api/jobs/${id}`)).status).toBe(401);
    expect((await fetch(`${hub.base}/api/jobs/${id}/result`, { headers: { authorization: `Bearer ${TOKEN_A}` } })).status).toBe(200);
  });
});

describe('AC-14 and AC-22: the job user, its folder and the clean-ups', () => {
  it('runs Chromium and veraPDF as uid 10002 with the sandbox on; its folder is unreadable to texjob and to nobody; the checker\'s clean-up leaves the capture alone', async () => {
    const token = freshToken();
    const sub = await hub.submit(fixture('stress'), token);
    const { id } = (await sub.json()) as { id: string };
    // While the capture runs.
    let sawChrome = '';
    let folder = '';
    for (let i = 0; i < 200 && (!sawChrome || !folder); i++) {
      sawChrome = hub.exec(['sh', '-c', 'ps -eo uid,args | grep -E "^ *10002 .*chrome-headless-shell" | grep -v grep | head -3 || true']).trim();
      folder = hub.exec(['sh', '-c', `ls -ld /hac-jobs/${id} 2>/dev/null || true`]).trim();
      if (!sawChrome || !folder) await new Promise((r) => setTimeout(r, 200));
    }
    expect(sawChrome).toContain('chrome-headless-shell');
    expect(sawChrome).not.toContain('--no-sandbox');
    expect(folder).toMatch(/^drwx------ \d+ hacjob hacjob /);
    for (const user of ['10001', '65534']) {
      const r = hub.execStatus(['ls', `/hac-jobs/${id}`], user);
      expect(r.status, user).not.toBe(0);
      expect(hub.execStatus(['cat', `/hac-jobs/${id}/in.pdf`], user).status, user).not.toBe(0);
    }
    // The checker's own clean-up after a TeX step, run now: it kills uid 10001 only and sweeps its files only.
    const swept = hub.exec(['node', '--disable-warning=ExperimentalWarning', '--input-type=module', '-e', "const m = await import('/app/tagging-doctor-worker/src/sandbox.ts'); console.log(m.killUserProcesses(10001), m.sweepOwned(['/tmp','/var/tmp','/dev/shm'], 10001));"]).trim();
    expect(swept).toBe('0 0');
    const job = await hub.waitFor(id, token);
    expect(job.status).toBe('done');
    // AC-22: the job's folder, its file and its profile are gone; no file of the job user is left anywhere.
    expect(hub.exec(['sh', '-c', `ls /hac-jobs`]).trim()).toBe('');
    expect(hub.exec(['sh', '-c', 'find / /dev/shm -xdev -user 10002 -not -path "/proc/*" 2>/dev/null || true']).trim()).toBe('');
    expect(hub.exec(['sh', '-c', 'ps -eo uid | grep -c "^ *10002$" || true']).trim()).toBe('0');
    // The result waits for its owner, as bytes, and is dropped once fetched.
    expect((await fetch(`${hub.base}/api/jobs/${id}/result`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
    expect((await fetch(`${hub.base}/api/jobs/${id}/result`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(404);
  });

  it('the mount\'s clean-up leaves the checker\'s files and processes alone', async () => {
    hub.exec(['sh', '-c', 'install -d -m 0777 /dev/shm && su -s /bin/sh -c "echo tex > /dev/shm/hac-tex-file" texjob || setpriv --reuid=10001 --regid=10001 --clear-groups sh -c "echo tex > /dev/shm/hac-tex-file"']);
    await hub.run(fixture('basic'));
    expect(hub.exec(['cat', '/dev/shm/hac-tex-file']).trim()).toBe('tex');
    hub.exec(['rm', '-f', '/dev/shm/hac-tex-file']);
  });
});

describe('AC-20: the memory kill', () => {
  it('memory-bomb.pdf is killed: "needs more memory", the container\'s non-reclaimable memory stays under 480 MB, health and the other mounts answer', async () => {
    const container = sampler(() => hub.containerMemory(), 100);
    const { value, statuses, hub: hubS, checker } = await pollingHealth(() => hub.run(fixture('memory-bomb')));
    const c = container.stop();
    expect(value.job).toMatchObject({ status: 'failed', failure: { message: 'This file needs more memory than the checker has.' } });
    expect(['memory', 'container-memory']).toContain(value.job.failure?.reason);
    expect(c.peak).toBeLessThan(480 * MB);
    expect(hub.oomKills()).toBe(0);
    expect(statuses.every((s) => s === 200)).toBe(true);
    expect(hubS.every((s) => s === 200)).toBe(true);
    expect(checker.every((s) => s === 200)).toBe(true);
    expect((await fetch(`${hub.root}/mult-streak/api/health`)).status).toBe(200);
    const killed = hub.events('job-killed').at(-1);
    console.log(JSON.stringify({ memoryBomb: { containerPeakMB: +(c.peak / MB).toFixed(1), samplerMaxGapMs: c.maxGap, killed } }));
  });
});

describe('AC-22: a restart', () => {
  it('drops held results: the page is told the check was interrupted', async () => {
    const token = freshToken();
    const sub = await hub.submit(fixture('basic'), token);
    const { id } = (await sub.json()) as { id: string };
    await hub.waitFor(id, token);
    await hub.stop();
    hub = await Hub.start();
    const r = await fetch(`${hub.base}/api/jobs/${id}`, { headers: { authorization: `Bearer ${token}` } });
    expect(r.status).toBe(404);
    expect(((await r.json()) as { error: string }).error).toBe('The check was interrupted. Try again.');
  });
});

describe('AC-23: a failing self-test', () => {
  it('a Chromium that cannot start: health says capture false with the versions, jobs are refused, and the other mounts serve', async () => {
    const bad = await Hub.start({ env: { HEARD_AS_CHECK_CHROME: '/bin/false' } });
    try {
      const h = await bad.health();
      expect(h).toMatchObject({ capture: false, payloadVersion: 1, pdfjs: '6.5.438' });
      expect((h.selfTest as { ok: boolean }).ok).toBe(false);
      const j = await bad.submit(fixture('basic'), freshToken());
      expect(j.status).toBe(503);
      expect(((await j.json()) as { error: string }).error).toBe('The checker is not available.');
      expect((await fetch(`${bad.root}/api/health`)).status).toBe(200);
      expect((await fetch(`${bad.root}/mult-streak/api/health`)).status).toBe(200);
      expect((await fetch(`${bad.root}/tagging-doctor/api/health`)).status).toBe(200);
    } finally {
      await bad.stop();
    }
  });
});
