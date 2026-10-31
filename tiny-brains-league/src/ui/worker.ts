/// <reference lib="webworker" />
import { HOUSE_BOTS, brainBot } from '../core/bots';
import { runLadder } from '../core/ladder';
import { compileBrain, type BrainFile } from '../core/net';
import { evalNet, runTraining, type TrainConfig } from '../core/session';

export type WorkerRequest =
  | { type: 'train'; config: TrainConfig }
  | { type: 'ladder'; house: string[]; brains: { id: string; file: BrainFile }[]; openings: number }
  | { type: 'eval'; id: string; file: BrainFile };

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  try {
    if (req.type === 'train') {
      runTraining(req.config, (e) => self.postMessage({ type: 'train', event: e }));
    } else if (req.type === 'eval') {
      self.postMessage({ type: 'eval', id: req.id, eval: evalNet(compileBrain(req.file)) });
    } else {
      const bots = [...HOUSE_BOTS.filter((b) => req.house.includes(b.id)), ...req.brains.map((b) => brainBot(b.id, b.file.name, compileBrain(b.file)))];
      const result = runLadder(bots, { openings: req.openings, onProgress: (done, total) => self.postMessage({ type: 'progress', done, total }) });
      self.postMessage({ type: 'ladder', result });
    }
  } catch (e) {
    self.postMessage({ type: 'error', message: (e as Error).message });
  }
};
