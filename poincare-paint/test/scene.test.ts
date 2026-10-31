import { describe, expect, it } from 'vitest';
import { IDENTITY, apply } from '../src/core/iso';
import { distance } from '../src/core/geometry';
import { widthBucket, drawStrokeInTile, drawStrokes, drawTiles, makeStroke, strokeInfo, tileMatches, toScreen, validColor, type Frame, type Sink, type Stroke, type TileStyle } from '../src/core/scene';
import { fold, generateTiles, inFundamental, makeTiling } from '../src/core/tiling';
import { SvgSink, exportSvg } from '../src/core/svg';

class CountSink implements Sink {
  ops: string[] = [];
  strokes: { color: string; width: number }[] = [];
  fills = 0;
  begin() {
    this.ops.push('begin');
  }
  moveTo() {
    this.ops.push('M');
  }
  lineTo() {
    this.ops.push('L');
  }
  arc() {
    this.ops.push('A');
  }
  close() {
    this.ops.push('Z');
  }
  fill() {
    this.fills++;
  }
  stroke(color: string, width: number) {
    this.strokes.push({ color, width });
  }
}

const T = makeTiling(5, 4);
const F: Frame = { ox: 300, oy: 300, R: 280 };
const style: TileStyle = { shading: true, mirrors: true, edges: true, shade: '#eee', edge: '#333', mirror: '#999' };

describe('strokes', () => {
  it('fold into the fundamental triangle once, keeping shape', () => {
    const world: [number, number][] = [
      [-0.4, -0.3],
      [-0.35, -0.25],
      [-0.3, -0.28],
    ];
    const s = makeStroke(T, 'free', world, '#ff0000', 0.05);
    expect(inFundamental(T, ...s.points[0])).toBe(true);
    expect(distance(s.points[0], s.points[2])).toBeCloseTo(distance(world[0], world[2]), 9);
    expect(s.parity).toBe(fold(T, ...world[0]).parity);
    expect(() => makeStroke(T, 'free', [], '#000000', 1)).toThrow();
  });

  it('caches anchor and extent', () => {
    const s = makeStroke(T, 'geodesic', [
      [0.1, 0.05],
      [0.3, 0.1],
    ], '#00ff00', 0.02);
    const info = strokeInfo(s);
    expect(strokeInfo(s)).toBe(info);
    expect(info.extent).toBeCloseTo(distance(s.points[0], s.points[1]), 9);
  });

  it('reappears in the original spot under the matching tile', () => {
    const world: [number, number][] = [
      [-0.5, 0.2],
      [-0.45, 0.25],
    ];
    const s = makeStroke(T, 'free', world, '#123456', 0.05);
    const tiles = generateTiles(T, IDENTITY, { maxDepth: 10 });
    const hit = tiles.some((t) => {
      const p = apply(t.t, ...s.points[0]);
      return tileMatches(t, s, 'rotation') && Math.hypot(p[0] - world[0][0], p[1] - world[0][1]) < 1e-9;
    });
    expect(hit).toBe(true);
  });

  it('rotation mode draws half as many copies as the kaleidoscope', () => {
    const s = makeStroke(T, 'free', [
      [0.1, 0.02],
      [0.15, 0.03],
      [0.2, 0.01],
    ], '#000000', 0.03);
    const tiles = generateTiles(T, IDENTITY, { maxDepth: 8 });
    const k = drawStrokes(new CountSink(), [s], tiles, F, 'kaleidoscope');
    const r = drawStrokes(new CountSink(), [s], tiles, F, 'rotation');
    expect(k).toBeGreaterThan(50);
    expect(r).toBeLessThan(k * 0.65);
    expect(r).toBeGreaterThan(k * 0.35);
  });

  it('geodesic strokes draw arcs; free strokes draw lines; dots get a nub', () => {
    const tiles = generateTiles(T, IDENTITY, { maxDepth: 0 });
    const g = makeStroke(T, 'geodesic', [
      [0.1, 0.02],
      [0.3, 0.2],
    ], '#000000', 0.03);
    const sink = new CountSink();
    drawStrokeInTile(sink, g, tiles[0], F);
    expect(sink.ops).toContain('A');
    const dot: Stroke = { kind: 'free', color: '#000000', width: 0.05, parity: 0, points: [[0.1, 0.02]] };
    const s2 = new CountSink();
    expect(drawStrokeInTile(s2, dot, tiles[0], F)).toBe(true);
    expect(s2.ops).toEqual(['begin', 'M', 'L']);
  });

  it('culls copies too small to see and scales width with the disk metric', () => {
    const s: Stroke = { kind: 'free', color: '#000000', width: 0.02, parity: 0, points: [[0.1, 0.02], [0.11, 0.02]] };
    const tiles = generateTiles(T, IDENTITY, { maxDepth: 0 });
    const far = apply(IDENTITY, 0, 0);
    expect(far).toEqual([0, 0]);
    const sink = new CountSink();
    drawStrokeInTile(sink, s, tiles[0], F);
    expect(sink.strokes[0].width).toBeCloseTo(Math.max(0.35, (0.02 * 280 * (1 - 0.1 ** 2 - 0.02 ** 2)) / 2), 1);
    // Translate the stroke almost to the rim: it should be culled.
    const nearRim = { ...tiles[0], t: { ar: 1, ai: 0, br: 0.99999, bi: 0, conj: false } };
    const n = Math.sqrt(1 - 0.99999 ** 2);
    nearRim.t = { ar: 1 / n, ai: 0, br: 0.99999 / n, bi: 0, conj: false };
    expect(drawStrokeInTile(new CountSink(), s, nearRim, F)).toBe(false);
  });

  it('buckets widths so copies share stroke calls, and thins small copies', () => {
    expect(widthBucket(0.37)).toBe(0.375);
    expect(widthBucket(3.3)).toBe(3.5);
    expect(widthBucket(11.4)).toBe(11);
    const pts: [number, number][] = Array.from({ length: 200 }, (_, i) => [0.05 + i * 0.001, 0.02 + 0.01 * Math.sin(i / 10)]);
    const s: Stroke = { kind: 'free', color: '#000000', width: 0.02, parity: 0, points: pts };
    const tiles = generateTiles(T, IDENTITY, { maxDepth: 14 });
    const sink = new CountSink();
    const n = drawStrokes(sink, [s], tiles, F, 'kaleidoscope');
    expect(sink.strokes.length).toBeLessThan(n);
    const lines = sink.ops.filter((o) => o === 'L').length;
    expect(lines).toBeLessThan(n * 199);
  });

  it('validates colours', () => {
    expect(validColor('#a0b1c2')).toBe(true);
    expect(validColor('red')).toBe(false);
    expect(validColor('#abc')).toBe(false);
  });
});

describe('tile drawing', () => {
  it('shades (in batches), outlines and draws mirrors per the style', () => {
    const tiles = generateTiles(T, IDENTITY, { maxDepth: 12 });
    const sink = new CountSink();
    drawTiles(sink, T, tiles, F, style);
    expect(sink.fills).toBeGreaterThan(1);
    expect(sink.strokes.map((s) => s.color)).toEqual(['#999', '#333']);
    const bare = new CountSink();
    drawTiles(bare, T, tiles, F, { ...style, shading: false, mirrors: false, edges: false });
    expect(bare.fills + bare.strokes.length).toBe(0);
  });

  it('maps the disk to the screen with y up', () => {
    expect(toScreen(F, [1, 0])).toEqual([580, 300]);
    expect(toScreen(F, [0, 1])).toEqual([300, 20]);
  });
});

describe('SVG export', () => {
  it('writes a self-contained SVG with arcs, fills and strokes', () => {
    const tiles = generateTiles(T, IDENTITY, { maxDepth: 6 });
    const s = makeStroke(T, 'geodesic', [
      [0.1, 0.02],
      [0.3, 0.2],
    ], '#ff8800', 0.03);
    const svg = exportSvg({ p: 5, q: 4, symmetry: 'kaleidoscope', strokes: [s] }, T, tiles, { size: 400, background: '#fff', disk: '#fafafa', rim: '#000', style });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('{5,4}');
    expect(svg).toContain('stroke="#ff8800"');
    expect(svg).toMatch(/A[\d.]+ [\d.]+ 0 0 [01] /);
    expect(svg).toContain('clip-path="url(#disk)"');
    expect(svg.trim().endsWith('</svg>')).toBe(true);
  });

  it('sink ignores empty paths and writes -0 as 0', () => {
    const sink = new SvgSink();
    sink.begin();
    sink.stroke('#000', 1);
    sink.fill('#000');
    expect(sink.parts).toHaveLength(0);
    sink.begin();
    sink.moveTo(-0.001, 0);
    sink.lineTo(1, 1);
    sink.close();
    sink.fill('#111');
    expect(sink.parts[0]).toContain('M0 0L1 1Z');
  });
});
