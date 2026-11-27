// The capture spike (heard-as-check SPEC AC-1). Runs inside the spike image
// as root (the hub's server user), next to the idle hub, and plays the
// mount's part: it serves pdf.js and the file to a sandboxed headless Chromium
// started as the mount's own user (uid 10002), reads the tagged layer's
// accessibility tree over the DevTools pipe in parts, takes the page's own
// output, ends Chromium, then runs veraPDF as the same user with the
// checker's Java flags. A sampler sums the job's memory every 100 ms.
//
//   node spike.mjs [--no-sandbox] [--plan default|canvas|single] [--out results.json]
//
// It is a measurement, not the mount: milestone 2 writes the mount.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const NO_SANDBOX = flag('--no-sandbox');
const PLAN = opt('--plan', 'default');
const OUT = opt('--out', '/results/results.json');
const FIXTURES = process.env.FIXTURES ?? '/fixtures';
const STATIC = path.join(path.dirname(new URL(import.meta.url).pathname), 'static');
const CHROME = process.env.CHROME ?? '/opt/chrome/chrome-headless-shell';
const VERAPDF_HOME = process.env.VERAPDF_HOME ?? '/opt/verapdf';
const JOB_UID = 10002;
const JOBS = '/jobs-hac';
const OUTPUT_CAP = 20 * 1024 * 1024;
const JOB_LIMIT_MS = 90_000;

// ---- memory -------------------------------------------------------------------
const CG = '/sys/fs/cgroup/memory';
const readNum = (f) => {
  try {
    return Number(fs.readFileSync(f, 'utf8').trim());
  } catch {
    return null;
  }
};
const cgroup = {
  usage: () => readNum(`${CG}/memory.usage_in_bytes`) ?? readNum('/sys/fs/cgroup/memory.current'),
  maxUsage: () => readNum(`${CG}/memory.max_usage_in_bytes`) ?? readNum('/sys/fs/cgroup/memory.peak'),
  totalRss: () => {
    try {
      const m = /^total_rss (\d+)$/m.exec(fs.readFileSync(`${CG}/memory.stat`, 'utf8'));
      return m ? Number(m[1]) : null;
    } catch {
      return null;
    }
  },
  version: () => (fs.existsSync(`${CG}/memory.usage_in_bytes`) ? 'v1' : fs.existsSync('/sys/fs/cgroup/memory.current') ? 'v2' : 'none'),
};

function children() {
  const byParent = new Map();
  for (const d of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const stat = fs.readFileSync(`/proc/${d}/stat`, 'utf8');
      const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      if (!byParent.has(ppid)) byParent.set(ppid, []);
      byParent.get(ppid).push(Number(d));
    } catch {
      /* gone */
    }
  }
  const out = [];
  const stack = [...(byParent.get(process.pid) ?? [])];
  while (stack.length) {
    const p = stack.pop();
    out.push(p);
    stack.push(...(byParent.get(p) ?? []));
  }
  return out;
}

const readStats = { pss: 0, fallback: 0, failed: 0 };
/** The job's memory: PSS from smaps_rollup, else RssAnon + RssShmem from status (S3-7). */
function jobMemory() {
  let pss = 0;
  let rss = 0;
  for (const pid of children()) {
    let got = false;
    try {
      const m = /^Pss:\s+(\d+) kB$/m.exec(fs.readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8'));
      if (m) {
        pss += Number(m[1]) * 1024;
        readStats.pss += 1;
        got = true;
      }
    } catch {
      /* EACCES on a non-dumpable process of another user, or gone */
    }
    try {
      const s = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
      const anon = Number(/^RssAnon:\s+(\d+)/m.exec(s)?.[1] ?? 0);
      const shm = Number(/^RssShmem:\s+(\d+)/m.exec(s)?.[1] ?? 0);
      rss += (anon + shm) * 1024;
      if (!got) {
        pss += (anon + shm) * 1024;
        readStats.fallback += 1;
      }
    } catch {
      readStats.failed += 1;
    }
  }
  return { pss, rss };
}

class Sampler {
  constructor() {
    this.reset();
    this.timer = setInterval(() => this.tick(), 100);
  }
  reset() {
    this.phase = 'capture';
    this.phasePeak = { capture: 0, verapdf: 0 };
    this.jobPeak = 0;
    this.jobRssPeak = 0;
    this.cgPeak = 0;
    this.rssPeak = 0;
    this.last = Date.now();
    this.maxGap = 0;
    this.samples = 0;
  }
  tick() {
    const now = Date.now();
    this.maxGap = Math.max(this.maxGap, now - this.last);
    this.last = now;
    this.samples += 1;
    const m = jobMemory();
    this.jobPeak = Math.max(this.jobPeak, m.pss);
    this.phasePeak[this.phase] = Math.max(this.phasePeak[this.phase], m.pss);
    this.jobRssPeak = Math.max(this.jobRssPeak, m.rss);
    this.cgPeak = Math.max(this.cgPeak, cgroup.usage() ?? 0);
    this.rssPeak = Math.max(this.rssPeak, cgroup.totalRss() ?? 0);
  }
  stop() {
    clearInterval(this.timer);
  }
}

// ---- static server --------------------------------------------------------------
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.pdf': 'application/pdf', '.map': 'application/json' };
let servedFile = null;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const file = url.pathname === '/job.pdf' ? servedFile : path.join(STATIC, path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
  if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

// ---- CDP over the pipe ------------------------------------------------------------
class Cdp {
  constructor(proc) {
    this.proc = proc;
    this.id = 0;
    this.waiting = new Map();
    this.events = [];
    // Bytes are split on the NUL that ends each message, then decoded: a character split across
    // two chunks is never decoded half (R1.1-6).
    let buf = Buffer.alloc(0);
    this.proc.on('exit', (code, sig) => {
      for (const { reject } of this.waiting.values()) reject(new Error(`chrome exited (${code ?? sig})`));
      this.waiting.clear();
    });
    proc.stdio[3].on('error', () => {});
    proc.stdio[4].on('error', () => {});
    proc.stdio[4].on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      let i;
      while ((i = buf.indexOf(0)) >= 0) {
        const msg = JSON.parse(buf.subarray(0, i).toString('utf8'));
        this.answerBytes = Math.max(this.answerBytes ?? 0, i);
        buf = buf.subarray(i + 1);
        if (msg.id && this.waiting.has(msg.id)) {
          const { resolve, reject } = this.waiting.get(msg.id);
          this.waiting.delete(msg.id);
          if (msg.error) reject(new Error(`${msg.error.message}`));
          else resolve(msg.result);
        } else this.events.push(msg);
      }
    });
  }
  send(method, params = {}, sessionId) {
    if (this.proc.exitCode !== null || this.proc.signalCode !== null) return Promise.reject(new Error('chrome exited'));
    const id = ++this.id;
    this.proc.stdio[3].write(`${JSON.stringify({ id, method, params, sessionId })}\0`);
    return new Promise((resolve, reject) => this.waiting.set(id, { resolve, reject }));
  }
}

function chromeArgs(profile) {
  return [
    '--remote-debugging-pipe',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-default-apps',
    '--disable-component-update',
    '--mute-audio',
    '--hide-scrollbars',
    '--renderer-process-limit=1',
    '--disable-features=Translate,MediaRouter,OptimizationHints,BackForwardCache',
    // No network but loopback, where the job's own server is (AC-15's full test is milestone 2's).
    '--proxy-server=http://127.0.0.1:9',
    ...(NO_SANDBOX ? ['--no-sandbox'] : []),
    'about:blank',
  ];
}

function sandboxFacts(browserPid) {
  const facts = { processes: 0, seccompFilter: 0, ownUserNs: 0, uids: new Set() };
  let browserNs = null;
  try {
    browserNs = fs.readlinkSync(`/proc/${browserPid}/ns/user`);
  } catch {
    /* */
  }
  for (const pid of children()) {
    try {
      const s = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
      const name = /^Name:\s+(.*)$/m.exec(s)?.[1] ?? '';
      if (!/chrome/.test(name)) continue;
      facts.processes += 1;
      if (/^Seccomp:\s+2$/m.test(s)) facts.seccompFilter += 1;
      facts.uids.add(/^Uid:\s+(\d+)/m.exec(s)?.[1]);
      try {
        if (fs.readlinkSync(`/proc/${pid}/ns/user`) !== browserNs) facts.ownUserNs += 1;
      } catch {
        facts.ownUserNs += 0;
      }
    } catch {
      /* gone */
    }
  }
  return { ...facts, uids: [...facts.uids] };
}

/** One capture of `file`: Chromium, the tree in parts, the page's output. */
async function capture(file, { canvas = false } = {}) {
  const job = fs.mkdtempSync(path.join(JOBS, 'job-'));
  const profile = path.join(job, 'profile');
  fs.mkdirSync(profile);
  fs.copyFileSync(file, path.join(job, 'in.pdf'));
  spawnSync('chown', ['-R', `${JOB_UID}:${JOB_UID}`, job]);
  fs.chmodSync(job, 0o700);
  servedFile = file;
  const t0 = Date.now();
  const proc = spawn('setpriv', ['--reuid', String(JOB_UID), '--regid', String(JOB_UID), '--clear-groups', '--', CHROME, ...chromeArgs(profile)], {
    stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'],
    env: { HOME: job, TMPDIR: job, PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' },
  });
  let stderr = '';
  proc.stdio[2].on('data', (d) => {
    if (stderr.length < 20000) stderr += d.toString();
  });
  const exited = new Promise((r) => proc.on('exit', (code, sig) => r({ code, sig })));
  const cdp = new Cdp(proc);
  const result = { file: path.basename(file), canvas };
  const deadline = setTimeout(() => proc.kill('SIGKILL'), JOB_LIMIT_MS);
  try {
    const started = await Promise.race([cdp.send('Browser.getVersion'), exited.then((e) => Promise.reject(new Error(`chrome exited ${JSON.stringify(e)}: ${stderr.slice(-2000)}`)))]);
    result.chromium = started.product;
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const s = (m, p) => cdp.send(m, p, sessionId);
    await s('Runtime.enable');
    await s('Page.enable');
    await s('Page.navigate', { url: `http://127.0.0.1:${PORT}/capture.html?file=/job.pdf&canvas=${canvas ? 1 : 0}&outputCap=${OUTPUT_CAP}` });
    result.sandbox = sandboxFacts(proc.pid);
    const call = async (expr) => {
      const r = await s('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      const v = r.result.value;
      if (!v || v.error) throw new Error(`capture failed: ${v?.error ?? JSON.stringify(r.exceptionDetails ?? r.result).slice(0, 500)}`);
      return v;
    };
    for (let i = 0; i < 400; i++) {
      const r = await s('Runtime.evaluate', { expression: 'window.__ready === true', returnByValue: true }).catch(() => null);
      if (r?.result?.value === true) break;
      await new Promise((res) => setTimeout(res, 50));
    }
    const opened = await call('window.__open()');
    await s('Accessibility.enable');
    const chunks = [];
    let axBytes = 0;
    let axNodes = 0;
    let capped = false;
    let maxElements = 0;
    const failedReads = [];
    let axMs = 0;
    const tA = Date.now();
    for (let n = 1; n <= opened.pagesRead && !capped; n++) {
      const pg = await call(`window.__page(${n})`);
      maxElements = Math.max(maxElements, pg.elements ?? 0);
      if (pg.capped) {
        capped = true;
        break;
      }
      // This page's accessibility tree, in parts: the children of one node per call, 64 calls at a time.
      const tP = Date.now();
      const { nodes: rootNodes } = await s('Accessibility.getFullAXTree', { depth: 1 });
      const seen = new Set();
      const queue = [];
      const add = (node) => {
        if (seen.has(node.nodeId)) return;
        seen.add(node.nodeId);
        axNodes += 1;
        const c = JSON.stringify({ p: n, i: node.nodeId, r: node.role?.value, n: node.name?.value, g: node.ignored || undefined, c: node.childIds });
        axBytes += Buffer.byteLength(c, 'utf8');
        if (axBytes > OUTPUT_CAP) capped = true;
        else chunks.push(c);
        if (node.childIds?.length) queue.push(node.nodeId);
      };
      rootNodes.forEach(add);
      while (queue.length && !capped) {
        const batch = queue.splice(0, 64);
        // A failed read is counted, never dropped silently (R1.1-6).
        const answers = await Promise.all(batch.map((id) => s('Accessibility.getChildAXNodes', { id }).catch((e) => ({ nodes: [], failed: String(e.message ?? e) }))));
        for (const ans of answers) if (ans.failed) failedReads.push(ans.failed);
        for (const ans of answers) for (const node of ans.nodes) add(node);
        if (Date.now() - t0 > JOB_LIMIT_MS) throw new Error('job time limit');
      }
      axMs += Date.now() - tP;
      if (Date.now() - t0 > JOB_LIMIT_MS) throw new Error('job time limit');
    }
    const summary = await call('window.__finish()');
    Object.assign(result, { page: { ...opened, ...summary, maxElements } });
    result.captureMs = Date.now() - t0;
    capped = capped || summary.capped;
    const outStr = capped ? '' : (await s('Runtime.evaluate', { expression: 'window.__output', returnByValue: true })).result.value;
    axBytes += Buffer.byteLength(outStr, 'utf8');
    if (axBytes > OUTPUT_CAP) capped = true;
    result.pagesLoopMs = Date.now() - tA;
    result.axMs = axMs;
    result.failedReads = failedReads.length;
    result.failedReadSamples = failedReads.slice(0, 3);
    result.axNodes = axNodes;
    result.outputBytes = axBytes;
    result.capped = capped;
    result.largestAnswer = cdp.answerBytes;
    const output = capped ? null : Buffer.from(`{"heard":[${chunks.join(',')}],"own":${outStr}}`, 'utf8');
    result.tree = chunks;
    result.own = outStr;
    await cdp.send('Browser.close').catch(() => {});
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
    result.captureTotalMs = Date.now() - t0;
    return { result, output, job };
  } catch (e) {
    result.error = String(e.message ?? e);
    result.stderr = stderr.slice(-3000);
    proc.kill('SIGKILL');
    return { result, output: null, job };
  } finally {
    clearTimeout(deadline);
  }
}

/** veraPDF after Chromium, as the job's user, with the checker's Java flags. */
function verapdf(job) {
  const t0 = Date.now();
  const argv = [
    'java', '-Xmx192m', '-Xss512k', '-XX:MaxMetaspaceSize=96m', '-XX:ReservedCodeCacheSize=32m', '-XX:+UseSerialGC', '-XX:TieredStopAtLevel=1', '-XX:-UsePerfData',
    '-Djava.net.useSystemProxies=false', '-Dhttp.nonProxyHosts=', '-DsocksNonProxyHosts=', '-Dftp.nonProxyHosts=', '-Dhttp.proxyHost=127.0.0.1', '-Dhttp.proxyPort=9', '-Dhttps.proxyHost=127.0.0.1', '-Dhttps.proxyPort=9', '-DsocksProxyHost=127.0.0.1', '-DsocksProxyPort=9',
    `-Djava.io.tmpdir=${job}`, `-Duser.home=${job}`, '-Dfile.encoding=UTF8', '-classpath', `${VERAPDF_HOME}/bin/*`, '--add-exports=java.base/sun.security.pkcs=ALL-UNNAMED',
    'org.verapdf.apps.GreenfieldCliWrapper', '--flavour', 'ua1', '--format', 'json', '--maxfailuresdisplayed', '1', path.join(job, 'in.pdf'),
  ];
  return new Promise((resolve) => {
    const p = spawn('setpriv', ['--reuid', String(JOB_UID), '--regid', String(JOB_UID), '--clear-groups', '--', ...argv], { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin', HOME: job, LANG: 'C.UTF-8' } });
    let out = '';
    let err = '';
    p.stdout.setEncoding('utf8');
    p.stderr.setEncoding('utf8');
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    const kill = setTimeout(() => p.kill('SIGKILL'), JOB_LIMIT_MS);
    p.on('exit', (code) => {
      clearTimeout(kill);
      let compliant = null;
      try {
        const vr = [JSON.parse(out).report.jobs[0].validationResult].flat()[0];
        compliant = vr.compliant;
      } catch {
        /* no report */
      }
      resolve({ verapdfMs: Date.now() - t0, verapdfCode: code, compliant, verapdfErr: compliant === null ? err.slice(-1500) : undefined });
    });
  });
}

const sampler = new Sampler();
fs.mkdirSync(JOBS, { recursive: true, mode: 0o711 });
const results = { cgroup: cgroup.version(), limit: readNum(`${CG}/memory.limit_in_bytes`), plan: PLAN, sandbox: !NO_SANDBOX, runs: [] };
let held = null;

async function job(name, { canvas = false, hold = false, keepTree = false } = {}) {
  sampler.reset();
  const before = { cg: cgroup.usage(), rss: cgroup.totalRss() };
  const t0 = Date.now();
  const { result, output, job: dir } = await capture(path.join(FIXTURES, `${name}.pdf`), { canvas });
  sampler.tick();
  sampler.phase = 'verapdf';
  const v = result.error ? {} : await verapdf(dir);
  sampler.tick();
  fs.rmSync(dir, { recursive: true, force: true });
  if (hold && output) held = output;
  const run = {
    ...result,
    ...v,
    tree: keepTree ? result.tree : undefined,
    own: keepTree ? result.own : undefined,
    wallMs: Date.now() - t0,
    jobPssPeakMB: +(sampler.jobPeak / 2 ** 20).toFixed(1),
    capturePhasePeakMB: +(sampler.phasePeak.capture / 2 ** 20).toFixed(1),
    verapdfPhasePeakMB: +(sampler.phasePeak.verapdf / 2 ** 20).toFixed(1),
    jobRssAnonShmemPeakMB: +(sampler.jobRssPeak / 2 ** 20).toFixed(1),
    containerPeakMB: +(sampler.cgPeak / 2 ** 20).toFixed(1),
    containerTotalRssPeakMB: +(sampler.rssPeak / 2 ** 20).toFixed(1),
    containerMaxUsageSoFarMB: +((cgroup.maxUsage() ?? 0) / 2 ** 20).toFixed(1),
    containerBeforeMB: +((before.cg ?? 0) / 2 ** 20).toFixed(1),
    heldMB: held ? +(held.length / 2 ** 20).toFixed(1) : 0,
    samplerMaxGapMs: sampler.maxGap,
    samples: sampler.samples,
  };
  results.runs.push(run);
  const brief = { ...run, tree: undefined, own: undefined, stderr: run.stderr ? '(kept in file)' : undefined };
  console.log(JSON.stringify(brief));
  return run;
}

if (PLAN === 'default') {
  // AC-1's order: five-pages, stress, big-tree with one earlier result of its size held, then five-pages.
  await job('five-pages');
  await job('stress');
  await job('big-tree', { hold: true });
  await job('big-tree');
  held = null;
  await job('five-pages');
} else if (PLAN === 'canvas') {
  for (const name of ['basic', 'roles']) {
    const a = await job(name, { canvas: false, keepTree: true });
    const b = await job(name, { canvas: true, keepTree: true });
    const strip = (t) => (t ?? []).map((c) => { const o = JSON.parse(c); delete o.i; delete o.c; return JSON.stringify(o); });
    results[`${name}SameWithAndWithoutCanvas`] = JSON.stringify(strip(a.tree)) === JSON.stringify(strip(b.tree));
  }
} else if (PLAN === 'single') {
  for (const name of opt('--files', 'basic').split(',')) await job(name, { keepTree: true });
}
results.readStats = readStats;
sampler.stop();
server.close();
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
console.log(JSON.stringify({ done: true, readStats, extra: Object.fromEntries(Object.entries(results).filter(([k]) => k.endsWith('Canvas'))) }));
process.exit(0);
