import { describe, expect, it } from 'vitest';
import { angleAt, distance, distanceFromOrigin, geodesicLerp, geodesicPath, hyperbolicWidth, measureTriangle, pixelWidth, radiusForDistance } from '../src/core/geometry';

describe('distance', () => {
  it('matches 2 artanh r from the origin and is symmetric', () => {
    expect(distanceFromOrigin([0.5, 0])).toBeCloseTo(2 * Math.atanh(0.5), 12);
    expect(distance([0.1, 0.2], [-0.4, 0.3])).toBeCloseTo(distance([-0.4, 0.3], [0.1, 0.2]), 12);
    expect(distance([0.3, 0.3], [0.3, 0.3])).toBe(0);
    expect(radiusForDistance(distanceFromOrigin([0.7, 0]))).toBeCloseTo(0.7, 12);
  });

  it('grows without bound towards the rim', () => {
    expect(distanceFromOrigin([0.999999, 0])).toBeGreaterThan(14);
    expect(Number.isFinite(distanceFromOrigin([1, 0]))).toBe(true);
  });

  it('obeys the triangle inequality', () => {
    const a: [number, number] = [0.2, -0.6];
    const b: [number, number] = [0.5, 0.5];
    const c: [number, number] = [-0.7, 0.1];
    expect(distance(a, c)).toBeLessThanOrEqual(distance(a, b) + distance(b, c));
  });
});

describe('triangles', () => {
  it('angle sum is below π and the defect is the area', () => {
    const m = measureTriangle([0.6, 0], [-0.3, 0.3 * Math.sqrt(3)], [-0.3, -0.3 * Math.sqrt(3)]);
    expect(m.angleSum).toBeLessThan(Math.PI);
    expect(m.area).toBeCloseTo(Math.PI - m.angleSum, 12);
    expect(m.sides[0]).toBeCloseTo(m.sides[1], 6);
  });

  it('tiny triangles are nearly Euclidean', () => {
    const m = measureTriangle([0, 0], [0.001, 0], [0, 0.001]);
    expect(m.angleSum).toBeCloseTo(Math.PI, 5);
    expect(m.angles[0]).toBeCloseTo(Math.PI / 2, 9);
  });

  it('angles through the origin are Euclidean', () => {
    expect(angleAt([0, 0], [0.5, 0], [0, 0.5])).toBeCloseTo(Math.PI / 2, 12);
  });
});

describe('geodesic interpolation', () => {
  it('splits the distance proportionally', () => {
    const a: [number, number] = [0.3, -0.4];
    const b: [number, number] = [-0.5, 0.6];
    const m = geodesicLerp(a, b, 0.25);
    expect(distance(a, m)).toBeCloseTo(0.25 * distance(a, b), 9);
    expect(distance(m, b)).toBeCloseTo(0.75 * distance(a, b), 9);
    expect(geodesicLerp(a, a, 0.5)).toEqual(a);
  });
});

describe('widths', () => {
  it('round-trips between pixels and hyperbolic units', () => {
    const z: [number, number] = [0.4, 0.3];
    expect(pixelWidth(hyperbolicWidth(5, z, 300), z, 300)).toBeCloseTo(5, 9);
    expect(pixelWidth(1, [0, 0], 200)).toBe(100);
    expect(pixelWidth(1, [0.99, 0], 200)).toBeLessThan(2.1);
  });
});

describe('geodesic paths', () => {
  it('diameters are straight lines', () => {
    expect(geodesicPath(-0.5, 0, 0.5, 0).kind).toBe('line');
    expect(geodesicPath(0.1, 0.1, 0.4, 0.4).kind).toBe('line');
    expect(geodesicPath(0.2, 0.2, 0.2, 0.2).kind).toBe('line');
  });

  it('other geodesics are arcs orthogonal to the rim', () => {
    const g = geodesicPath(0.5, 0, 0, 0.5);
    if (g.kind !== 'arc') throw new Error('expected arc');
    // Orthogonal: |centre|² = 1 + r².
    expect(g.cx * g.cx + g.cy * g.cy).toBeCloseTo(1 + g.r * g.r, 9);
    expect(Math.hypot(0.5 - g.cx, 0 - g.cy)).toBeCloseTo(g.r, 9);
    // Minor arc
    let sweep = g.end - g.start;
    if (g.ccw) sweep = -sweep;
    while (sweep < 0) sweep += 2 * Math.PI;
    expect(sweep).toBeLessThan(Math.PI);
  });

  it('works in screen coordinates and in either direction', () => {
    const R = 200;
    const a = [300 + 0.5 * R, 300] as const;
    const b = [300, 300 - 0.5 * R] as const;
    const g1 = geodesicPath(a[0], a[1], b[0], b[1], 300, 300, R);
    const g2 = geodesicPath(b[0], b[1], a[0], a[1], 300, 300, R);
    if (g1.kind !== 'arc' || g2.kind !== 'arc') throw new Error('expected arcs');
    expect(g1.ccw).not.toBe(g2.ccw);
    expect((g1.cx - 300) ** 2 + (g1.cy - 300) ** 2).toBeCloseTo(R * R + g1.r * g1.r, 3);
  });
});
