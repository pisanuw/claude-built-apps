/**
 * Writes test/fixtures/parity.json: a sample brain plus positions with the
 * logits and move the TypeScript runtime produces. The vitest suite checks
 * the runtime still matches, and `python python/tiny_brains.py parity
 * test/fixtures/parity.json` checks the Python runtime against the same data.
 */
import { writeFileSync } from 'node:fs';
import samples from '../src/data/sample-brains.json';
import { randomBot } from '../src/core/bots';
import { newBoard, outcomeAfter, play } from '../src/core/connect4';
import { type BrainFile, compileBrain, logits, netMove } from '../src/core/net';
import { makeRng } from '../src/core/rng';

const brain = (samples as unknown as BrainFile[])[0];
const net = compileBrain(brain);
const rng = makeRng(99);
const cases: { moves: number[]; logits: number[]; move: number }[] = [];
for (let g = 0; g < 6; g++) {
  const b = newBoard();
  const moves: number[] = [];
  for (;;) {
    cases.push({ moves: moves.slice(), logits: Array.from(logits(net, b)), move: netMove(net, b) });
    const col = moves.length % 2 === g % 2 ? netMove(net, b) : randomBot.move(b, rng);
    const idx = play(b, col);
    moves.push(col);
    if (outcomeAfter(b, idx) !== null) break;
  }
}
writeFileSync(new URL('../test/fixtures/parity.json', import.meta.url), JSON.stringify({ brain, cases }) + '\n');
console.log(`${cases.length} positions`);
