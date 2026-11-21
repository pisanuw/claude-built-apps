import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readVersions } from '../src/versions.ts';

describe('the versions shown by the health route (AC-36)', () => {
  it('reads the first line of each file written at image build time', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tdw-v-'));
    writeFileSync(path.join(dir, 'texlive'), 'This is LuaHBTeX, Version 1.24.0 (TeX Live 2026)\nmore\n');
    writeFileSync(path.join(dir, 'verapdf'), '\n');
    expect(readVersions(dir)).toEqual({ texlive: 'This is LuaHBTeX, Version 1.24.0 (TeX Live 2026)', verapdf: 'unknown' });
    expect(readVersions(path.join(dir, 'none'))).toEqual({ texlive: 'unknown', verapdf: 'unknown' });
    rmSync(dir, { recursive: true });
  });
});
