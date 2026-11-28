/**
 * The mount's only logger. It writes one JSON line per event, and only fields
 * from a fixed list: numbers, booleans, and strings that are a job id or a
 * word from a fixed vocabulary. Any other string is written as "[redacted]",
 * so a file name, a token, a transcript or a path cannot reach the log by
 * mistake (the same rule as Tagging Doctor's checker; AC-65 in M6 greps it).
 */
export const EVENTS = ['self-test', 'request', 'job-started', 'job-stage', 'job-finished', 'job-killed', 'cleanup', 'sweep', 'job-user-alive', 'error'] as const;
export type LogEvent = (typeof EVENTS)[number];

const WORDS = new Set([
  // statuses and stages
  'running', 'done', 'failed', 'reading', 'validating',
  // routes and methods
  'health', 'jobs', 'job', 'result', 'other', 'GET', 'POST', 'DELETE', 'OPTIONS', 'HEAD', 'PUT', 'PATCH',
  // reasons
  'unauthorized', 'auth-unavailable', 'origin', 'too-large', 'not-pdf', 'busy', 'daily-limit', 'all-limit', 'held-full', 'too-slow',
  'cut-short', 'not-found', 'not-ready', 'timeout', 'memory', 'container-memory', 'password', 'unreadable', 'output-cap', 'tree-cap',
  'cancelled', 'internal', 'unavailable', 'no-sandbox', 'no-heading', 'chrome-failed', 'verapdf-failed', 'verapdf-timeout',
  'job-user-alive', 'ok', 'lock', 'checker', 'capture', 'expired', 'fetched', 'deleted', 'restart', 'unknown',
]);

const NUMBER_FIELDS = new Set(['code', 'ms', 'pages', 'pagesRead', 'bytes', 'nodes', 'uid', 'removed', 'killed', 'jobMB', 'containerMB', 'held', 'gapMs']);
const WORD_FIELDS = new Set(['status', 'stage', 'route', 'method', 'reason']);
const BOOLEAN_FIELDS = new Set(['ok', 'capped', 'sandbox']);
const JOB_ID = /^[0-9a-f]{32}$/;

export type LogFields = Record<string, string | number | boolean | null | undefined>;

export function clean(fields: LogFields): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (NUMBER_FIELDS.has(key)) out[key] = typeof value === 'number' && Number.isFinite(value) ? value : '[redacted]';
    else if (BOOLEAN_FIELDS.has(key)) out[key] = typeof value === 'boolean' ? value : '[redacted]';
    else if (WORD_FIELDS.has(key)) out[key] = typeof value === 'string' && WORDS.has(value) ? value : '[redacted]';
    else if (key === 'job') out[key] = typeof value === 'string' && JOB_ID.test(value) ? value : '[redacted]';
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
      write(JSON.stringify({ t: new Date(now()).toISOString(), app: 'heard-as-check', event, ...clean(fields) }));
    },
  };
}
