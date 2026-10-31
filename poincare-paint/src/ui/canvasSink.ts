import type { Sink } from '../core/scene';

export class CanvasSink implements Sink {
  constructor(private readonly ctx: CanvasRenderingContext2D) {}
  begin(): void {
    this.ctx.beginPath();
  }
  moveTo(x: number, y: number): void {
    this.ctx.moveTo(x, y);
  }
  lineTo(x: number, y: number): void {
    this.ctx.lineTo(x, y);
  }
  arc(cx: number, cy: number, r: number, start: number, end: number, ccw: boolean): void {
    this.ctx.arc(cx, cy, r, start, end, ccw);
  }
  close(): void {
    this.ctx.closePath();
  }
  fill(color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fill();
  }
  stroke(color: string, width: number): void {
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = width;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.stroke();
  }
}
