#!/usr/bin/env node
// Refreshes the bundled US tariff data from the public USITC HTS service.
//
//   npm run refresh-hts
//
// The USITC service does not allow calls from other websites' pages (no CORS),
// so the app cannot read it live. Instead this script downloads the chapters
// that handmade goods fall into, keeps every 10-digit line with its full legal
// wording and general duty rate, and writes src/data/hts.json. When a previous
// file exists, every changed general rate is appended to src/data/rate-history.json,
// which the app uses to tell makers what changed between data updates.
// Run it, check the diff, commit and redeploy.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'src', 'data');
const outFile = join(dataDir, 'hts.json');
const historyFile = join(dataDir, 'rate-history.json');
const BASE = 'https://hts.usitc.gov/reststop';

// Chapters that cover what UK makers typically sell.
const CHAPTERS = [
  '17', '19', '20', '21', // sweets, baked goods, jams, other food
  '33', '34', // cosmetics, bath products, soap, candles
  '39', // plastic articles (resin)
  '42', // bags, purses, leather goods
  '44', '46', // wood, basketwork
  '48', '49', // stationery, cards, prints
  '56', '58', '60', '61', '62', '63', // textiles, clothing, homeware
  '65', '67', // hats, artificial flowers
  '68', '69', '70', '71', // stone, ceramics, glass, jewellery
  '73', '74', '83', // metal articles and ornaments
  '94', '95', '96', '97', // furniture and lamps, toys, misc, art
];

const clean = (s) => String(s ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const digits = (code) => code.replace(/\./g, '');

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/** Turns one chapter's export rows into 10-digit lines with their wording chain and rate. */
export function linesFromExport(rows) {
  const out = [];
  const stack = []; // stack[indent] = { description, general }
  for (const r of rows) {
    const indent = Number(r.indent) || 0;
    const node = { description: clean(r.description), general: clean(r.general), code: clean(r.htsno) };
    stack.length = indent;
    stack[indent] = node;
    if (digits(node.code).length !== 10) continue;
    const chain = stack.filter(Boolean).map((n) => n.description).filter(Boolean);
    // The rate sits on the 8-digit line (or the line itself); take the nearest one up the chain.
    let general = '';
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i] && stack[i].general) { general = stack[i].general; break; }
    }
    out.push([node.code, chain.join(' | '), general]);
  }
  return out;
}

async function main() {
  const releases = await getJson(`${BASE}/releaseList`);
  const current = releases.find((r) => r.status === 'current') ?? releases[0];
  const lines = [];
  for (const ch of CHAPTERS) {
    const rows = await getJson(`${BASE}/exportList?from=${ch}01&to=${ch}99&format=JSON&styles=false`);
    const got = linesFromExport(rows);
    lines.push(...got);
    console.log(`chapter ${ch}: ${got.length} lines`);
  }
  // The UK country layer (Chapter 99) and its legal wording.
  const layerRows = await getJson(`${BASE}/search?keyword=9903.05.81`);
  const layerRow = layerRows.find((r) => r.htsno === '9903.05.81');

  const data = {
    revision: current.name,
    revisionTitle: current.title,
    revisionStart: current.releaseStartDate,
    fetched: new Date().toISOString().slice(0, 10),
    source: 'https://hts.usitc.gov',
    ukLayer: layerRow ? { heading: '9903.05.81', general: clean(layerRow.general), description: clean(layerRow.description) } : null,
    lines,
  };

  if (existsSync(outFile)) {
    const prev = JSON.parse(readFileSync(outFile, 'utf8'));
    if (prev.revision !== data.revision) {
      const before = new Map(prev.lines.map(([c, , g]) => [c, g]));
      const history = existsSync(historyFile) ? JSON.parse(readFileSync(historyFile, 'utf8')) : [];
      let changed = 0;
      for (const [code, , general] of lines) {
        const was = before.get(code);
        if (was !== undefined && was !== general) {
          history.push({ revision: data.revision, date: data.revisionStart, code, before: was, after: general });
          changed++;
        }
      }
      writeFileSync(historyFile, JSON.stringify(history, null, 1) + '\n');
      console.log(`${changed} general rates changed since ${prev.revision}`);
    }
  }
  writeFileSync(outFile, JSON.stringify(data) + '\n');
  console.log(`wrote ${lines.length} lines (${data.revision}) to ${outFile}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
