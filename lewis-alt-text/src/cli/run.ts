/**
 * Starts the command-line tool in this Node process: the real terminal,
 * session file, claude CLI and (on a Mac) sips, for both ways of running it.
 * Only wiring; the bundle test runs it end to end in a child process.
 */
import os from 'node:os';
import { errorMessage, hintwiseConfig, main } from './main.ts';
import { fileStore, generateWithClaude, programName, sessionDir, sipsFit, terminalIO } from './node.ts';

export interface RunOptions {
  skill: () => Promise<string>;
  /** The text of deploy/target.yml, for the public sign-in settings. */
  targetYml: () => string;
  version: string;
  /** True for the downloaded file, which people start with `node lewis-alt-text.mjs`. */
  viaNode: boolean;
}

/** Node 20 can warn that fetch is experimental; that means nothing to the person running this. */
function quietExperimentalWarnings(): void {
  const listeners = process.listeners('warning');
  process.removeAllListeners('warning');
  process.on('warning', (w) => {
    if (w.name !== 'ExperimentalWarning') for (const l of listeners) l.call(process, w);
  });
}

export async function run(r: RunOptions): Promise<void> {
  quietExperimentalWarnings();
  const io = terminalIO();
  const env = process.env;
  let code: number;
  try {
    code = await main({
      argv: process.argv.slice(2),
      program: programName(process.argv[1] ?? 'lewis-alt-text', { cwd: process.cwd(), viaNode: r.viaNode }),
      version: r.version,
      io,
      skill: r.skill,
      config: () => hintwiseConfig(r.targetYml(), env),
      store: fileStore(sessionDir(env)),
      local: (req) => generateWithClaude(req, { bin: env.CLAUDE_BIN }),
      fit: process.platform === 'darwin' ? sipsFit() : undefined,
      env,
      homedir: os.homedir(),
      platform: process.platform,
    });
  } catch (e) {
    io.err(`error: ${errorMessage(e)}`);
    code = 1;
  }
  // Exit once stdout and stderr are flushed: a pipe on macOS or Windows is written asynchronously.
  process.stdout.write('', () => process.stderr.write('', () => process.exit(code)));
}
