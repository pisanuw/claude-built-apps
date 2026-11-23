/**
 * The status line of a running check (AC-81, CR-12): the step ("Sending the
 * project…", "Waiting for its turn on the checker…", "Compiling and
 * checking…") with the seconds since the check was sent, redrawn every
 * second. The line is one polite live region. Screen readers hear each change
 * of step, and the count at most once every 15 seconds: the count a sighted
 * person sees is hidden from them, and a hidden-from-sight copy of it, inside
 * the region, changes only every 15 seconds.
 */

/** What the panel says while a check runs (AC-81, point 2; the 2-minute limit is AC-31's). */
export const CHECK_TAKES = 'A 20-page document takes about a minute, a tagged one longer. The checker stops a check at 2 minutes.';

/** How often the screen-reader copy of the count may change. */
export const ANNOUNCE_EVERY_MS = 15_000;
/** How often the visible count is redrawn (AC-81: at least every 5 seconds). */
export const TICK_MS = 1_000;

export interface Clock {
  now: () => number;
  /** Calls fn every ms until the returned function is called. */
  every: (ms: number, fn: () => void) => () => void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  every: (ms, fn) => {
    const t = setInterval(fn, ms);
    return () => clearInterval(t);
  },
};

export interface Progress {
  /** Shows a step; the first one after `sent()` starts the count. */
  step(text: string): void;
  /** The check was sent: the count starts now. */
  sent(): void;
  /** A line with no count (the wake line, a finished check). */
  plain(text: string): void;
  stop(): void;
}

/**
 * Draws into `line`, which must be the panel's live region (role=status,
 * aria-live=polite). `onRunning` shows or hides the panel's "how long" note.
 */
export function progress(line: HTMLElement, clock: Clock, onRunning: (running: boolean) => void = () => {}): Progress {
  let t0: number | null = null;
  let current = '';
  let lastSaid = -Infinity;
  let cancel: (() => void) | null = null;
  const stepEl = document.createElement('span');
  const seen = document.createElement('span');
  seen.setAttribute('aria-hidden', 'true');
  seen.className = 'count';
  const said = document.createElement('span');
  said.className = 'visually-hidden';

  const draw = () => {
    if (t0 === null) return;
    const s = Math.max(0, Math.floor((clock.now() - t0) / 1000));
    seen.textContent = ` (${s} s)`;
    if (clock.now() - lastSaid >= ANNOUNCE_EVERY_MS) {
      lastSaid = clock.now();
      said.textContent = s ? `, ${s} seconds` : '';
    }
  };

  const api: Progress = {
    sent() {
      t0 = clock.now();
      lastSaid = clock.now();
      cancel?.();
      cancel = clock.every(TICK_MS, draw);
      onRunning(true);
    },
    step(text) {
      if (line.firstChild !== stepEl) line.replaceChildren(stepEl, seen, said);
      if (text !== current) {
        current = text;
        stepEl.textContent = text;
        // A new step is said without the count; the count follows within 15 s.
        said.textContent = '';
      }
      draw();
    },
    plain(text) {
      api.stop();
      line.textContent = text;
    },
    stop() {
      cancel?.();
      cancel = null;
      t0 = null;
      current = '';
      onRunning(false);
    },
  };
  return api;
}

/** The text a screen reader gets from a live region: everything not hidden from it. */
export function spokenText(region: Element): string {
  let out = '';
  for (const n of region.childNodes) {
    if (n.nodeType === 3) out += n.textContent ?? '';
    else if (n instanceof Element && n.getAttribute('aria-hidden') !== 'true') out += spokenText(n);
  }
  return out;
}
