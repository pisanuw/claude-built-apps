/**
 * Regenerates src/data/sample-brains.json: two reference brains shipped with
 * the app so the ladder and replay viewer have something to show on first
 * load. Run with `npm run samples` (deterministic: same seeds, same weights).
 */
import { writeFileSync } from 'node:fs';
import { runTraining, type TrainConfig } from '../src/core/session';

const base = { activation: 'relu', budget: 5000, evolution: null } as const;
const configs: TrainConfig[] = [
  { ...base, name: 'Pocket-12', hidden: [12], seed: 11, imitation: { teacher: 'scripted', games: 1200, explore: 0.15, epochs: 20, lr: 0.003, mirror: true } },
  { ...base, name: 'Starter-48', hidden: [48], seed: 21, imitation: { teacher: 'scripted', games: 1500, explore: 0.15, epochs: 25, lr: 0.003, mirror: true } },
];

const brains = configs.map((c) => {
  const evals: { vsRandom: number; vsScripted: number }[] = [];
  const brain = runTraining(c, (e) => {
    if (e.kind !== 'done') return;
    evals.push(e.eval);
    console.log(`${c.name}: ${e.params} params, vs Random ${e.eval.vsRandom}, vs Scripted ${e.eval.vsScripted}, ${e.seconds.toFixed(0)} s`);
  });
  brain.author = 'Tiny Brains League (sample)';
  // Recorded so the Brains tab can show milestones without re-running them.
  brain.meta = { ...brain.meta, vsRandom: evals[0].vsRandom, vsScripted: evals[0].vsScripted };
  return brain;
});
writeFileSync(new URL('../src/data/sample-brains.json', import.meta.url), JSON.stringify(brains) + '\n');
