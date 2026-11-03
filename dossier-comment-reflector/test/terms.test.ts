import { describe, expect, it } from 'vitest';
import { sortTerms, termIndex, termOrder } from '../src/core/terms';

describe('termOrder', () => {
  it('reads season and year in either order', () => {
    expect(termOrder('Fall 2024')).toBe(20244);
    expect(termOrder('2024 Autumn')).toBe(20244);
    expect(termOrder('Spring 2025')).toBe(20252);
    expect(termOrder('Winter Quarter 2025')).toBe(20251);
    expect(termOrder('Summer Session 2023')).toBe(20233);
  });
  it('reads compact codes', () => {
    expect(termOrder('FA24')).toBe(20244);
    expect(termOrder('SP2025')).toBe(20252);
    expect(termOrder('W25')).toBe(20251);
    expect(termOrder('SU 23')).toBe(20233);
    expect(termOrder("F'22")).toBe(20224);
    expect(termOrder('S24')).toBe(20242);
  });
  it('reads academic-year labels', () => {
    expect(termOrder('2024-25 Semester 1')).toBe(20244);
    expect(termOrder('2024-25 Semester 2')).toBe(20252);
    expect(termOrder('2024/2025 Spring')).toBe(20252);
    expect(termOrder('2024-25 Fall')).toBe(20244);
    expect(termOrder('2023-24')).toBe(20234);
  });
  it('reads numbered terms and bare years', () => {
    expect(termOrder('Term 2 2024')).toBe(20242);
    expect(termOrder('2nd semester 2024')).toBe(20242);
    expect(termOrder('2022')).toBe(20220);
  });
  it('returns null for labels without a year', () => {
    expect(termOrder('')).toBeNull();
    expect(termOrder('Last spring')).toBeNull();
  });
});

describe('sortTerms', () => {
  it('sorts in calendar order, unreadable labels last in first-seen order', () => {
    expect(sortTerms(['Fall 2023', 'Pilot', 'Spring 2023', 'Fall 2023', 'Winter 2024', 'Other'])).toEqual(['Spring 2023', 'Fall 2023', 'Winter 2024', 'Pilot', 'Other']);
  });
  it('keeps equal keys in first-seen order', () => {
    expect(sortTerms(['2024', '2024 (online)'])).toEqual(['2024', '2024 (online)']);
  });
  it('indexes terms', () => {
    expect(termIndex(['Fall 2024', 'Spring 2024']).get('Fall 2024')).toBe(1);
  });
});
