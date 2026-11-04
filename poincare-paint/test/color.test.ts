import { describe, expect, it } from 'vitest';
import { hexToHsv, hsToWheel, hsvToHex, hsvToRgb, wheelToHs } from '../src/core/color';

describe('colour wheel maths', () => {
  it('converts primaries and greys', () => {
    expect(hsvToHex(0, 1, 1)).toBe('#ff0000');
    expect(hsvToHex(120, 1, 1)).toBe('#00ff00');
    expect(hsvToHex(240, 1, 1)).toBe('#0000ff');
    expect(hsvToHex(60, 1, 1)).toBe('#ffff00');
    expect(hsvToHex(180, 1, 1)).toBe('#00ffff');
    expect(hsvToHex(300, 1, 1)).toBe('#ff00ff');
    expect(hsvToHex(0, 0, 1)).toBe('#ffffff');
    expect(hsvToHex(200, 0.5, 0)).toBe('#000000');
    expect(hsvToRgb(-120, 1, 1)).toEqual([0, 0, 255]);
    expect(hexToHsv('#000000')).toEqual({ h: 0, s: 0, v: 0 });
    expect(hexToHsv('#808080').s).toBe(0);
  });

  it('round-trips hex through hsv', () => {
    for (const hex of ['#1d4ed8', '#dc2626', '#16a34a', '#f59e0b', '#7c3aed', '#0f172a', '#ec4899', '#ffffff', '#ff00ff']) {
      const { h, s, v } = hexToHsv(hex);
      expect(hsvToHex(h, s, v)).toBe(hex);
    }
  });

  it('maps wheel positions to hue and saturation and back', () => {
    expect(wheelToHs(1, 0)).toEqual({ h: 0, s: 1 });
    expect(wheelToHs(0, -0.5).h).toBeCloseTo(90);
    expect(wheelToHs(0, 0.5).h).toBeCloseTo(270);
    expect(wheelToHs(3, 4).s).toBe(1);
    const [x, y] = hsToWheel(135, 0.6);
    const back = wheelToHs(x, y);
    expect(back.h).toBeCloseTo(135);
    expect(back.s).toBeCloseTo(0.6);
  });
});
