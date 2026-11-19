#!/usr/bin/env node
/**
 * Converts the LaTeX Project's tagging status list into src/data/tagging-status.json.
 *
 *   node scripts/convert-tagging-status.mjs <tagging-status.yml> <commit> <retrieved YYYY-MM-DD>
 *
 * Get the file at a fixed commit, for example:
 *   git ls-remote https://github.com/latex3/tagging-project refs/heads/main
 *   curl -o /tmp/ts.yml https://raw.githubusercontent.com/latex3/tagging-project/<commit>/_data/tagging-status.yml
 *
 * The output keeps, per package and class, the source's own status word,
 * comment (markdown, as written), link and subpackages, plus our group
 * (src/core/status.ts, AC-62). The source is under the LaTeX Project Public
 * License 1.3c or later; the output says it is a converted copy.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const GROUP = {
  'no-support': 'blocker',
  'currently-incompatible': 'blocker',
  'partially-compatible': 'warning',
  compatible: 'ok',
  unchecked: 'unknown',
};

const PAGE = 'https://latex3.github.io/tagging-project/tagging-status/';

/**
 * The status page has a row (id = name) for each package and class, and none
 * for a library: a babel language links to babel's row, a TikZ library to
 * tikz's, any other library to the page itself.
 */
function linkFor(e) {
  if (e.type !== 'library') return `${PAGE}#${encodeURIComponent(e.name)}`;
  if (e.name.startsWith('babel-')) return `${PAGE}#babel`;
  if (e.name.startsWith('tikzlibrary-')) return `${PAGE}#tikz`;
  return PAGE;
}

const [, , input, commit, retrieved] = process.argv;
if (!input || !/^[0-9a-f]{40}$/.test(commit ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(retrieved ?? '')) {
  console.error('usage: convert-tagging-status.mjs <tagging-status.yml> <40-hex commit> <YYYY-MM-DD>');
  process.exit(2);
}

const raw = parse(fs.readFileSync(input, 'utf8'));
if (!Array.isArray(raw)) throw new Error('expected a YAML list');

const latest = raw.reduce((max, e) => {
  const d = e.updated instanceof Date ? e.updated.toISOString().slice(0, 10) : String(e.updated ?? '');
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && d > max ? d : max;
}, '');

const entries = raw
  .filter((e) => e && typeof e.name === 'string' && typeof e.status === 'string')
  .map((e) => {
    const out = {
      name: e.name,
      type: e.type,
      status: e.status,
      group: GROUP[e.status] ?? 'unknown',
      link: linkFor(e),
    };
    if (typeof e.comments === 'string' && e.comments.trim()) out.comment = e.comments.trim().replace(/\s+/g, ' ');
    if (Array.isArray(e.subpackages) && e.subpackages.length) out.subpackages = e.subpackages.map(String);
    return out;
  });

const data = {
  asOf: retrieved,
  latestEntryUpdate: latest,
  source: {
    name: 'LaTeX Project tagging status',
    url: 'https://github.com/latex3/tagging-project/blob/main/_data/tagging-status.yml',
    page: 'https://latex3.github.io/tagging-project/tagging-status/',
    commit,
    retrieved,
    note: 'A converted copy of the LaTeX Project’s tagging-status.yml: fields kept are name, type, status, comments, subpackages; group and link are added by Tagging Doctor.',
    licence: 'LaTeX Project Public License, version 1.3c or later',
  },
  entries,
};

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '..', 'src', 'data', 'tagging-status.json');
fs.writeFileSync(out, JSON.stringify(data, null, 0).replace(/\},\{/g, '},\n{') + '\n');
console.log(`wrote ${entries.length} entries to ${out}`);
