/// <reference lib="webworker" />
import { search } from '../core/engine';
import { Ruleset } from '../core/game';
import { replay, type Request, type Response } from '../core/protocol';
import { playOne } from '../core/selfplay';

const cache = new Map<string, Ruleset>();

function rulesetFor(variant: Request & { kind: 'search' }): Ruleset {
  const key = JSON.stringify(variant.variant);
  let rs = cache.get(key);
  if (!rs) {
    rs = new Ruleset(variant.variant);
    cache.clear();
    cache.set(key, rs);
  }
  return rs;
}

const post = (r: Response): void => self.postMessage(r);

self.onmessage = (ev: MessageEvent<Request>) => {
  const req = ev.data;
  try {
    if (req.kind === 'search') {
      const g = replay(rulesetFor(req), req.moves);
      const r = search(g, { timeMs: req.timeMs });
      post({ kind: 'search', id: req.id, move: r.move ? [r.move.from, r.move.to, r.move.promo] : null, score: r.score, depth: r.depth, nodes: r.nodes });
    } else {
      for (let i = 0; i < req.options.games; i++) {
        post({ kind: 'game', id: req.id, index: i, record: playOne(req.spec, i, req.options) });
      }
      post({ kind: 'done', id: req.id });
    }
  } catch (e) {
    post({ kind: 'error', id: req.id, message: e instanceof Error ? e.message : String(e) });
  }
};
