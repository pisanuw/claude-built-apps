import { describe, expect, it } from 'vitest';
import skill from '../../skill/lewis-structure-alt-text-v8.txt?raw';
import { stripHeader, systemBlocks, systemText } from '../../src/core/prompt';

describe('system prompt', () => {
  it('is the skill without its header, plus the app rules', () => {
    const s = systemText(skill);
    expect(s.startsWith('# Writing Alt Text for Lewis Structures')).toBe(true);
    expect(s).toMatch(/## Worked Examples/);
    expect(s).toMatch(/QUESTION:/);
  });
  it('is one cached block', () => {
    const b = systemBlocks(skill);
    expect(b).toHaveLength(1);
    expect(b[0].cache_control).toEqual({ type: 'ephemeral' });
  });
  it('leaves text without a header alone', () => {
    expect(stripHeader('# Title\nbody')).toBe('# Title\nbody');
    expect(stripHeader('name: x\n---\n# T')).toBe('# T');
  });
});
