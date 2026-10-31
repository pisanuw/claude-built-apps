import { type Cost, type OpKind, totalCost } from './types';

export interface MeterReading {
  ops: number;
  last: number;
  lastCost: Cost | null;
  amortized: number;
  worst: number;
  worstOp: string;
}

/** Running cost meter: last op, mean over all ops (the amortized cost), and the worst single op. */
export class CostMeter {
  private ops = 0;
  private sum = 0;
  private last = 0;
  private lastCost: Cost | null = null;
  private worst = 0;
  private worstOp = '';

  record(op: OpKind, cost: Cost, label: string = op): void {
    const t = totalCost(cost);
    this.ops++;
    this.sum += t;
    this.last = t;
    this.lastCost = cost;
    if (t > this.worst) {
      this.worst = t;
      this.worstOp = label;
    }
  }

  reading(): MeterReading {
    return {
      ops: this.ops,
      last: this.last,
      lastCost: this.lastCost,
      amortized: this.ops === 0 ? 0 : this.sum / this.ops,
      worst: this.worst,
      worstOp: this.worstOp,
    };
  }

  reset(): void {
    this.ops = this.sum = this.last = this.worst = 0;
    this.lastCost = null;
    this.worstOp = '';
  }
}
