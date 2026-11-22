/**
 * The downloadable single file: scripts/build-cli.mjs bundles this into
 * dist/cli/lewis-alt-text.mjs with the skill, the public sign-in settings
 * and the version built in, so the file needs nothing beside it.
 */
import skill from '../../skill/lewis-structure-alt-text-v8.txt';
import targetYml from '../../deploy/target.yml';
import { run } from './run.ts';

declare const __VERSION__: string;

void run({ skill: async () => skill, targetYml: () => targetYml, version: __VERSION__, viaNode: true });
