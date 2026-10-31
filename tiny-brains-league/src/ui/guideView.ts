import pyRuntime from '../../python/tiny_brains.py?raw';
import { DEFAULT_BUDGET, FORMAT, INPUTS, OUTPUTS } from '../core/net';
import { RANDOM_TARGET, SCRIPTED_TARGET } from '../core/milestones';
import { h } from './dom';
import { download } from './state';

const EXAMPLE = `{
  "format": "${FORMAT}",
  "name": "pocket-brain",
  "author": "you@school.edu",
  "activation": "relu",
  "layers": [
    { "weights": [[/* 84 numbers */], /* … 12 rows */], "bias": [/* 12 */] },
    { "weights": [[/* 12 numbers */], /* … 7 rows */], "bias": [/* 7 */] }
  ]
}`;

export function guideView(): HTMLElement {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return h(
    'section',
    { class: 'view prose' },
    h(
      'div',
      { class: 'panel' },
      h('h2', {}, 'The assignment'),
      h('p', {}, `Train the smallest Connect Four policy network you can. There is no search at play time: your network sees the board and picks a column, nothing else. A submission is a JSON weight file of at most ${DEFAULT_BUDGET.toLocaleString()} weights and biases.`),
      h('ol', {},
        h('li', {}, h('strong', {}, 'Milestone 1: beat Random. '), `Score at least ${pct(RANDOM_TARGET)} over 32 games (16 fixed openings, both colours) against a uniform random mover.`),
        h('li', {}, h('strong', {}, 'Milestone 2: beat Scripted. '), `Score more than ${pct(SCRIPTED_TARGET)} over the same 32 games against the scripted bot: it wins when it can, blocks when it must, avoids playing under an opponent win, and otherwise takes the best one-ply evaluation of open windows and centre control.`),
        h('li', {}, h('strong', {}, 'Milestone 3: climb the ladder. '), 'Enter the class round robin. The main board ranks by Elo; the efficiency board ranks by Elo above Random per 1,000 parameters, so a small net that is nearly as good can win it.'),
        h('li', {}, h('strong', {}, 'Write-up and ablation. '), 'Explain your training choices and compare at least two budgets or two methods. The Train tab logs every run and exports the table as Markdown or CSV to start the report.'),
      ),
      h('h2', {}, 'The interface'),
      h('p', {}, `Input: ${INPUTS} numbers from the point of view of the side to move. Entries 0–41 are 1 where you have a piece, entries 42–83 are 1 where your opponent has one. Cell i is row ⌊i/7⌋ (0 is the bottom row), column i mod 7. Output: ${OUTPUTS} logits, one per column. Hidden layers use the file's activation (relu or tanh); the last layer is linear. The runtime plays the legal column with the highest logit, the lowest column on ties, so play is deterministic.`),
      h('p', {}, 'Rules the ladder enforces: 1 to 4 layers, every weight finite and within ±1000, the first layer takes 84 inputs, the last gives 7, file under 1 MB. Illegal moves cannot happen (illegal columns are masked) and a malformed file is rejected with every problem listed.'),
      h('pre', {}, h('code', {}, EXAMPLE)),
      h('h2', {}, 'Training on your own machine'),
      h('p', {}, 'The Python runtime below has the same board, encoding and move rule as the ladder, a validator, a save helper and a quick check against a random mover. A parity fixture in the repository confirms it gives the same logits as the browser runtime.'),
      h('pre', {}, h('code', {}, 'python tiny_brains.py check my-brain.json')),
      h('div', { class: 'actions' }, h('button', { type: 'button', onclick: () => download('tiny_brains.py', pyRuntime, 'text/x-python') }, 'Download tiny_brains.py')),
      h('h2', {}, 'How the ladder is scored'),
      h('p', {}, 'Every pair plays each fixed two-ply opening twice, swapping colours, so first-move advantage cancels out. House bots break ties between equal moves with a seeded random number generator, so a rerun gives the same games. Ratings are a Bradley-Terry maximum-likelihood fit converted to the Elo scale (draws count half), with one virtual win and one virtual loss against a 1500 phantom to keep perfect records finite, then shifted so Random is 1000.'),
      h('h2', {}, 'Limits of this build'),
      h('ul', {},
        h('li', {}, 'Everything runs in your browser. Brains and the experiment log live in this browser only; an instructor runs the official ladder by loading every student file into one browser. There is no shared server or accounts.'),
        h('li', {}, 'Training uses plain JavaScript on the CPU. Large datasets or long evolution runs take minutes; heavier training belongs in Python.'),
        h('li', {}, 'The only game is Connect Four 7×6 and the strongest house bot is a depth-4 alpha-beta search, which a policy net this small rarely beats.'),
      ),
    ),
  );
}
