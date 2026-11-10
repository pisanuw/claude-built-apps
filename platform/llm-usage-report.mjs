#!/usr/bin/env node
/**
 * Emails the owner the LLM usage of the HintWise key (docs/platform.md,
 * section 4): one table per app with yesterday, the ISO week to date and the
 * month to date, each against its cap, plus calls, distinct users and errors.
 *
 * Sends when yesterday had any call on the owner's key, and every Monday as a
 * weekly summary even when quiet (UTC date of the run; the subject says which:
 * "LLM usage: Tue 10 Nov" or "LLM usage, weekly summary"). Otherwise it exits
 * quietly. No state file: the scheduled pair of runs is reduced to one by the
 * Pacific-hour guard, and the Resend Idempotency-Key (one per UTC date) makes
 * a repeated send on the same day a no-op.
 *
 * Usage:
 *   node platform/llm-usage-report.mjs                 # send if due
 *   node platform/llm-usage-report.mjs --dry-run       # print, send nothing
 *   node platform/llm-usage-report.mjs --force         # send even when quiet
 *   node platform/llm-usage-report.mjs --not-before-pacific-hour=9
 *   node platform/llm-usage-report.mjs --date=2026-11-09   # pretend this UTC run date (tests)
 *   node platform/llm-usage-report.mjs --days=7            # report window in days (default 1)
 *
 * Env (CI: GitHub secrets; local: platform/.env, git-ignored):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API, ADMIN_EMAIL
 *
 * Zero dependencies beyond src/report/format.mjs. Needs Node 18+ for fetch.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decideSend, FROM, renderHtml, renderText, subjectFor } from './src/report/format.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FORCE = args.includes('--force');

function numberFlag(name) {
  const arg = args.find((a) => a.startsWith(`${name}=`));
  if (!arg) return null;
  const n = Number(arg.slice(name.length + 1));
  return Number.isFinite(n) ? n : null;
}
function stringFlag(name) {
  const arg = args.find((a) => a.startsWith(`${name}=`));
  return arg ? arg.slice(name.length + 1) : null;
}

// GitHub cron is UTC and has no DST, so the workflow fires at 16:10 and 17:10
// UTC and this guard drops the run that lands before 9am Pacific. The other
// run, when both pass (PDT), is a no-op at Resend thanks to the idempotency key.
const NOT_BEFORE = numberFlag('--not-before-pacific-hour');
const DAYS = Math.max(1, numberFlag('--days') || 1);
const DATE = stringFlag('--date');

function pacificHour(now) {
  return Number(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hour12: false }));
}

// Local convenience only: in CI the values arrive as real env vars and this
// file does not exist. Existing env always wins.
function loadDotEnv() {
  const file = path.join(HERE, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
}

function need(names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) throw new Error(`missing env: ${missing.join(', ')}`);
}

/** PostgREST call of platform.llm_usage_report with the service role. */
async function fetchReport(days) {
  need(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(`${process.env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/llm_usage_report`, {
    method: 'POST',
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      'content-profile': 'platform',
      accept: 'application/json',
    },
    body: JSON.stringify({ p_days: days }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`llm_usage_report: HTTP ${res.status} ${text.slice(0, 300)}`);
  const report = JSON.parse(text);
  if (!report || typeof report !== 'object' || !Array.isArray(report.apps)) throw new Error(`llm_usage_report returned an unexpected shape: ${text.slice(0, 200)}`);
  return report;
}

async function send(subject, text, html, idempotencyKey) {
  need(['RESEND_API', 'ADMIN_EMAIL']);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.RESEND_API}`,
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
    },
    body: JSON.stringify({ from: FROM, to: [process.env.ADMIN_EMAIL], subject, text, html }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Resend ${res.status}: ${body.slice(0, 300)}`);
  try { return JSON.parse(body).id || ''; } catch { return ''; }
}

async function main() {
  loadDotEnv();
  const now = new Date();
  const runDate = DATE ? new Date(`${DATE}T12:00:00Z`) : now;
  if (Number.isNaN(runDate.getTime())) throw new Error(`--date must be YYYY-MM-DD, got ${DATE}`);
  const isoDay = runDate.toISOString().slice(0, 10);

  if (!DRY_RUN && !FORCE && NOT_BEFORE !== null && pacificHour(now) < NOT_BEFORE) {
    console.log(`Pacific hour is ${pacificHour(now)}, before ${NOT_BEFORE}; the later scheduled run will send.`);
    return;
  }

  const report = await fetchReport(DAYS);
  const decision = decideSend(report, runDate, { force: FORCE });
  const subject = subjectFor(runDate, decision.weekly);
  const text = renderText(report, runDate);

  if (DRY_RUN) {
    console.log(`--- ${decision.send ? 'would send' : 'would NOT send'} (${decision.reason}) to ${process.env.ADMIN_EMAIL || '(ADMIN_EMAIL unset)'}`);
    console.log(`Subject: ${subject}`);
    console.log('');
    console.log(text);
    console.log('--- end (dry run: nothing sent)');
    return;
  }
  if (!decision.send) {
    console.log(`Nothing to send for ${isoDay}: ${decision.reason}.`);
    return;
  }
  const id = await send(subject, text, renderHtml(report, runDate), `llm-usage-${isoDay}`);
  console.log(`Sent "${subject}" for ${isoDay} (${decision.reason})${id ? ` (Resend id ${id})` : ''}.`);
}

main().catch((err) => {
  console.error(`! ${err.message}`);
  process.exit(1);
});
