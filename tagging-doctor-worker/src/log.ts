/**
 * The worker's only logger (AC-64: no source text, no TeX log text and no
 * token in the logs). It writes one JSON line per event, and only fields from
 * a fixed list: numbers, booleans, and strings that are a job id or a word
 * from a fixed vocabulary. Any other string is written as "[redacted]", so a
 * message, a path, a log line or a token cannot reach the log by mistake.
 */
export const EVENTS = [
  'start',
  'self-test',
  'request',
  'job-queued',
  'job-started',
  'job-step',
  'job-finished',
  'job-deleted',
  'job-expired',
  'cleanup',
  'error',
] as const;
export type LogEvent = (typeof EVENTS)[number];

const WORDS = new Set([
  // job statuses and steps
  'queued', 'running', 'done', 'failed', 'lualatex', 'biber', 'bibtex', 'verapdf', 'prepare', 'collect',
  // routes and methods
  'health', 'jobs', 'job', 'pdf', 'other', 'GET', 'POST', 'DELETE', 'OPTIONS', 'HEAD', 'PUT', 'PATCH',
  // reasons
  'unauthorized', 'auth-unavailable', 'origin', 'too-large', 'busy', 'hourly-limit', 'too-slow', 'bad-upload', 'bad-main-file',
  'not-found', 'timeout', 'compile-error', 'cancelled', 'bibliography', 'no-pdf', 'verapdf-error', 'internal', 'restart', 'expired', 'deleted',
  'ok', 'no-switch', 'switch', 'unknown',
]);

const NUMBER_FIELDS = new Set(['code', 'ms', 'pages', 'runs', 'waiting', 'running', 'bytes', 'uid', 'texUid', 'removed', 'killed', 'port', 'exit']);
const WORD_FIELDS = new Set(['status', 'step', 'route', 'method', 'reason', 'mode']);
const BOOLEAN_FIELDS = new Set(['separateUser', 'compliant', 'ok']);
const JOB_ID = /^[0-9a-f]{32}$/;

export type LogFields = Record<string, string | number | boolean | null | undefined>;

export function clean(fields: LogFields): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (NUMBER_FIELDS.has(key)) {
      out[key] = typeof value === 'number' && Number.isFinite(value) ? value : '[redacted]';
    } else if (BOOLEAN_FIELDS.has(key)) {
      out[key] = typeof value === 'boolean' ? value : '[redacted]';
    } else if (WORD_FIELDS.has(key)) {
      out[key] = typeof value === 'string' && WORDS.has(value) ? value : '[redacted]';
    } else if (key === 'job') {
      out[key] = typeof value === 'string' && JOB_ID.test(value) ? value : '[redacted]';
    }
    // Any other field is dropped.
  }
  return out;
}

export interface Logger {
  log(event: LogEvent, fields?: LogFields): void;
}

export function createLogger(write: (line: string) => void, now: () => number = Date.now): Logger {
  return {
    log(event, fields = {}) {
      write(JSON.stringify({ t: new Date(now()).toISOString(), event, ...clean(fields) }));
    },
  };
}
