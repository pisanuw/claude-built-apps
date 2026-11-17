// This terminal's HintWise session, in a file only you can read
// (~/.config/lewis-alt-text/session.json, mode 600). It holds a refresh
// token: treat it like a password. `lewis-alt-text logout` removes it.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function sessionDir() {
  if (process.env.LEWIS_ALT_TEXT_HOME) return process.env.LEWIS_ALT_TEXT_HOME;
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'lewis-alt-text');
}

export function fileStore(dir = sessionDir()) {
  const file = path.join(dir, 'session.json');
  return {
    file,
    async load() {
      if (!existsSync(file)) return null;
      try {
        const s = JSON.parse(readFileSync(file, 'utf8'));
        return s && typeof s.accessToken === 'string' && typeof s.refreshToken === 'string' ? s : null;
      } catch {
        return null;
      }
    },
    async save(s) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(s), { mode: 0o600 });
      chmodSync(tmp, 0o600);
      renameSync(tmp, file);
    },
    async clear() {
      rmSync(file, { force: true });
    },
  };
}
