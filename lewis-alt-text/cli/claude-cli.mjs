// Runs one model request through the local `claude` CLI (headless). It uses
// the signed-in Claude subscription: no API key, no per-token bill.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Short names the claude CLI accepts for the app's model ids. */
const ALIASES = { 'claude-opus-5-5': 'opus', 'claude-sonnet-5-5': 'sonnet', 'claude-haiku-5-5': 'haiku' };

/**
 * @param {import('../src/core/alt-text.ts').ModelRequest} req
 * @param {{bin?: string, timeoutMs?: number}} [o]
 * @returns {Promise<import('../src/core/alt-text.ts').ModelReply>}
 */
export function generateWithClaude(req, { bin = process.env.CLAUDE_BIN || 'claude', timeoutMs = 180_000 } = {}) {
  // The system prompt is ~35 kB: pass it as a file. Run in a temp dir so no project CLAUDE.md is read.
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lewis-alt-'));
  const promptFile = path.join(dir, 'system.md');
  writeFileSync(promptFile, req.system.map((b) => b.text).join('\n\n'));
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--tools', '',
    '--no-session-persistence', '--system-prompt-file', promptFile, '--model', ALIASES[req.model] ?? req.model];

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    const finish = (fn, v) => {
      clearTimeout(timer);
      rmSync(dir, { recursive: true, force: true });
      fn(v);
    };
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) =>
      finish(reject, e.code === 'ENOENT' ? new Error(`claude CLI not found (${bin}). Install Claude Code or set CLAUDE_BIN.`) : e));
    child.on('close', (code, signal) => {
      if (signal) return finish(reject, new Error(`claude CLI stopped (${signal}) after ${timeoutMs / 1000} s`));
      const result = out.split('\n').filter(Boolean).map(safeJson).find((e) => e?.type === 'result');
      if (!result) return finish(reject, new Error(`claude CLI exited ${code} without a result. ${err.trim().slice(-500)}`));
      if (result.is_error || result.subtype !== 'success') return finish(reject, new Error(`claude CLI: ${result.result || result.subtype}`));
      finish(resolve, { text: result.result, model: Object.keys(result.modelUsage ?? {})[0], usage: result.usage, stopReason: result.stop_reason });
    });
    child.stdin.end(JSON.stringify({ type: 'user', message: req.messages[0] }) + '\n');
  });
}

function safeJson(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
