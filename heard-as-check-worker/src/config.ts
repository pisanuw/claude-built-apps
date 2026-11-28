/**
 * The mount's settings, read once from the hub's HEARD_AS_CHECK_* variables
 * with the prefix taken off (backend-hub/src/capture.ts). Nothing here is a
 * secret: the Supabase URL and anon key are public, the same the page ships.
 * The fixed numbers are SPEC section 3's.
 */
export const PRODUCTION_ORIGIN = 'https://heard-as-check.hintwise.org';
export const LOCAL_ORIGIN = 'http://localhost:5173';

/** What the page expects in health's `payloadVersion` before it shows the upload (AC-13, M3). */
export const PAYLOAD_VERSION = 1;

export const MB = 1024 * 1024;

export const LIMITS = {
  /** AC-17: at most 10 MB (D-4: binary, as the schema's `file_bytes`). */
  uploadBytes: 10 * MB,
  /** AC-18: at most 60 pages read. */
  maxPages: 60,
  /** AC-18: the job's whole output (D-36 sets it from many-glyphs.pdf). */
  outputBytes: 20 * MB,
  /** AC-18, CR-3: the two trees together. */
  treeNodes: 24_700,
  /** AC-22: results held in the mount at once. */
  heldBytes: 40 * MB,
  /** AC-22: a result, and a job folder, are kept at most 10 minutes. */
  keepMs: 10 * 60_000,
  /** The whole job, capture and veraPDF (section 3). */
  jobMs: 90_000,
  /** AC-25. */
  perPersonPerDay: 20,
  allPerDay: 60,
  /** AC-20 (D-16, acceptance/m1.md): the kill threshold on the job's non-file memory, between 292 and 300 MB. */
  killJobBytes: 300 * MB,
  /** AC-20: the backstop on the container's non-reclaimable memory. */
  killContainerBytes: 470 * MB,
  /** AC-20: the monitor's period. */
  sampleMs: 100,
  /** Bodies received at once (each to a file, never into memory). */
  uploadsAtOnce: 2,
  /** A body must arrive within this (10 MB at about 1 Mbit/s and a half). */
  bodyMs: 120_000,
} as const;

export interface Config {
  supabaseUrl: string;
  supabaseAnonKey: string;
  allowedOrigins: string[];
  /** The job user: neither root nor 10001, the checker's TeX user (AC-14). */
  jobUid: number;
  jobGid: number;
  /** Mode 0711, the server user's; each job's folder inside it is the job user's, mode 0700. */
  jobsRoot: string;
  chrome: string;
  verapdfHome: string;
  versionsDir: string;
  /** pdf.js as installed (node_modules/pdfjs-dist). */
  pdfjsDir: string;
  /** Places the job user can write to besides its job; emptied of its files after each job (AC-14). */
  sweepDirs: string[];
  /** The cgroup memory folder to read (v1 `/sys/fs/cgroup/memory`, else v2 `/sys/fs/cgroup`). */
  cgroupDir: string;
  /** A shorter job limit for tests; never a longer one. */
  jobMs: number;
  /** Chromium's fontconfig file (D-43): a few fonts with a cache built into the image; '' for the system's. */
  fontconfigFile: string;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

function int(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new ConfigError(`${name} must be a whole number`);
  return n;
}

export function loadConfig(env: Record<string, string | undefined>, defaults: { pdfjsDir: string }): Config {
  const supabaseUrl = env.SUPABASE_URL?.replace(/\/+$/, '');
  const supabaseAnonKey = env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !/^https?:\/\//.test(supabaseUrl)) throw new ConfigError('SUPABASE_URL is required');
  if (!supabaseAnonKey) throw new ConfigError('SUPABASE_ANON_KEY is required');
  const origin = (env.ALLOWED_ORIGIN || PRODUCTION_ORIGIN).replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9.-]+$/.test(origin)) throw new ConfigError('ALLOWED_ORIGIN must be an https origin');
  const allowLocal = env.ALLOW_LOCAL === '1';
  const jobUid = int(env.JOB_UID, 10002, 'JOB_UID');
  if (jobUid === 0 || jobUid === 10001) throw new ConfigError('JOB_UID must be neither root nor the checker\'s TeX user (10001)');
  return {
    supabaseUrl,
    supabaseAnonKey,
    allowedOrigins: allowLocal ? [origin, LOCAL_ORIGIN] : [origin],
    jobUid,
    jobGid: int(env.JOB_GID, jobUid, 'JOB_GID'),
    jobsRoot: env.JOBS_ROOT || '/hac-jobs',
    chrome: env.CHROME || '/opt/chrome/chrome-headless-shell',
    verapdfHome: env.VERAPDF_HOME || '/opt/verapdf',
    versionsDir: env.VERSIONS_DIR || '/opt/versions',
    pdfjsDir: env.PDFJS_DIR || defaults.pdfjsDir,
    sweepDirs: (env.SWEEP_DIRS ?? '/tmp,/var/tmp,/dev/shm').split(',').filter(Boolean),
    cgroupDir: env.CGROUP_DIR || '',
    jobMs: Math.min(int(env.JOB_MS, LIMITS.jobMs, 'JOB_MS'), LIMITS.jobMs),
    fontconfigFile: env.FONTCONFIG_FILE ?? '/opt/hac-fontconfig/fonts.conf',
  };
}
