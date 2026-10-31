/** The three assignment milestones, checked against fixed openings so grades reproduce. */
import type { EvalResult } from './train';
import type { Standing } from './ladder';

export const RANDOM_TARGET = 0.9;
export const SCRIPTED_TARGET = 0.5;

export interface Milestones {
  beatRandom: boolean;
  beatScripted: boolean;
  /** null until the brain has been on a ladder run. */
  ladder: null | { rank: number; brains: number; aboveScripted: boolean };
}

export function checkMilestones(e: EvalResult, standings: readonly Standing[] | null, id: string): Milestones {
  let ladder: Milestones['ladder'] = null;
  if (standings) {
    const brains = standings.filter((s) => s.kind === 'brain');
    const rank = brains.findIndex((s) => s.id === id);
    const scripted = standings.find((s) => s.id === 'house:scripted');
    const me = standings.find((s) => s.id === id);
    if (rank >= 0 && me) ladder = { rank: rank + 1, brains: brains.length, aboveScripted: scripted ? me.elo > scripted.elo : false };
  }
  return { beatRandom: e.vsRandom >= RANDOM_TARGET, beatScripted: e.vsScripted > SCRIPTED_TARGET, ladder };
}
