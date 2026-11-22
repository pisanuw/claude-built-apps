/**
 * The worker's settings, read once from the environment. Nothing here is a
 * secret: the Supabase URL and anon key are public, the same the app ships.
 */
export const PRODUCTION_ORIGIN = 'https://tagging-doctor.hintwise.org';
export const LOCAL_ORIGIN = 'http://localhost:5173';

/** AC-31: every job, all its steps together, is stopped after 120 seconds. */
export const JOB_LIMIT_MS = 120_000;

export interface Config {
  port: number;
  /** Mode 0711, the server user's (AC-64). */
  jobsRoot: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  allowedOrigins: string[];
  /** The TeX user. Null runs TeX as the server user (tests outside the image). */
  texUid: number | null;
  texGid: number | null;
  /** The font caches built into the image, copied into each job (AC-65). */
  texCacheSource: string | null;
  texBin: string;
  verapdfHome: string;
  versionsDir: string;
  /** Places a TeX user can write to besides its job; emptied of its files after each job. */
  sweepDirs: string[];
  jobLimitMs: number;
  /** AC-34: everything of a job is deleted 30 minutes after it ends. */
  retentionMs: number;
  /** AC-32: 25 MB. */
  maxBodyBytes: number;
  /** AC-33: at most 3 jobs wait. With no TeX user of its own the worker takes no job at all (D-68, AC-64), and health shows 0. */
  maxWaiting: number;
  /** AC-33: one user gets at most 5 jobs an hour. */
  perUserPerHour: number;
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

export function loadConfig(env: Record<string, string | undefined>): Config {
  const supabaseUrl = env.SUPABASE_URL?.replace(/\/+$/, '');
  const supabaseAnonKey = env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !/^https?:\/\//.test(supabaseUrl)) throw new ConfigError('SUPABASE_URL is required');
  if (!supabaseAnonKey) throw new ConfigError('SUPABASE_ANON_KEY is required');
  const texUser = env.TEX_UID === 'none' ? null : int(env.TEX_UID, 10001, 'TEX_UID');
  const allowLocal = env.ALLOW_LOCAL === '1' || env.ALLOW_LOCAL === 'true';
  return {
    port: int(env.PORT, 10000, 'PORT'),
    jobsRoot: env.JOBS_ROOT || '/jobs',
    supabaseUrl,
    supabaseAnonKey,
    allowedOrigins: allowLocal ? [PRODUCTION_ORIGIN, LOCAL_ORIGIN] : [PRODUCTION_ORIGIN],
    texUid: texUser,
    texGid: texUser === null ? null : int(env.TEX_GID, texUser, 'TEX_GID'),
    texCacheSource: env.TEX_CACHE === 'none' ? null : env.TEX_CACHE || '/opt/texmf-var',
    texBin: env.TEX_BIN || '/usr/local/texlive/2026/bin/x86_64-linux',
    verapdfHome: env.VERAPDF_HOME || '/opt/verapdf',
    versionsDir: env.VERSIONS_DIR || '/opt/versions',
    sweepDirs: (env.SWEEP_DIRS ?? '/tmp,/var/tmp,/dev/shm').split(',').filter(Boolean),
    // A shorter limit may be set for tests; never a longer one.
    jobLimitMs: Math.min(int(env.JOB_LIMIT_MS, JOB_LIMIT_MS, 'JOB_LIMIT_MS'), JOB_LIMIT_MS),
    retentionMs: 30 * 60_000,
    maxBodyBytes: 25 * 1024 * 1024,
    maxWaiting: 3,
    perUserPerHour: 5,
  };
}
