export const TICKS_PER_SECOND = 60;

export type GlobalMode = 'scatter' | 'chase';

export interface Phase {
  mode: GlobalMode;
  /** Length in seconds; Infinity for the final chase phase. */
  seconds: number;
}

/** Level 1 of the arcade: four scatter waves, the last chase phase never ends. */
export const LEVEL1_SCHEDULE: readonly Phase[] = [
  { mode: 'scatter', seconds: 7 },
  { mode: 'chase', seconds: 20 },
  { mode: 'scatter', seconds: 7 },
  { mode: 'chase', seconds: 20 },
  { mode: 'scatter', seconds: 5 },
  { mode: 'chase', seconds: 20 },
  { mode: 'scatter', seconds: 5 },
  { mode: 'chase', seconds: Infinity },
];

/** Level 1 frightened time. */
export const FRIGHT_SECONDS = 6;
export const FRIGHT_TICKS = FRIGHT_SECONDS * TICKS_PER_SECOND;

export interface ModeAt {
  mode: GlobalMode;
  index: number;
  /** Schedule tick at which this phase started. */
  start: number;
  /** Schedule tick at which it ends (Infinity for the last). */
  end: number;
}

/**
 * The phase in force after `modeTicks` ticks of schedule time. Schedule time
 * stops while ghosts are frightened, as in the arcade.
 */
export function modeAt(modeTicks: number, schedule: readonly Phase[] = LEVEL1_SCHEDULE): ModeAt {
  let start = 0;
  for (let i = 0; i < schedule.length; i++) {
    const end = start + schedule[i].seconds * TICKS_PER_SECOND;
    if (modeTicks < end || i === schedule.length - 1) return { mode: schedule[i].mode, index: i, start, end };
    start = end;
  }
  /* c8 ignore next */
  throw new Error('empty schedule');
}

/** Schedule ticks at which the mode flips (every phase boundary). */
export function phaseBoundaries(schedule: readonly Phase[] = LEVEL1_SCHEDULE): number[] {
  const out: number[] = [];
  let t = 0;
  for (const p of schedule.slice(0, -1)) {
    t += p.seconds * TICKS_PER_SECOND;
    out.push(t);
  }
  return out;
}
