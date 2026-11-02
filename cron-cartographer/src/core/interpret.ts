import type { Schedule } from './types.js';
import { CronParseError, extractGithubActionsCrons, parseCron } from './cron.js';
import { describeCron, describeRRule } from './describe.js';
import { RRuleParseError, parseRRule } from './rrule.js';
import { naturalLanguageToCron } from './nl.js';

/**
 * Turn whatever the user pasted into a schedule: a cron expression, an
 * RRULE, a GitHub Actions `on.schedule` snippet, or an English phrase.
 */

export type InputKind = 'cron' | 'rrule' | 'github-actions' | 'natural-language';

export interface Interpreted {
  ok: true;
  kind: InputKind;
  schedule: Schedule;
  /** The five-field cron this resolves to (absent for RRULE input). */
  cron: string | null;
  description: string;
  notes: string[];
}

export interface InterpretFailure {
  ok: false;
  error: string;
  hint: string;
}

export function interpretInput(raw: string): Interpreted | InterpretFailure {
  const text = raw.trim();
  if (text.length === 0) {
    return { ok: false, error: 'nothing to parse', hint: 'Paste a cron expression, an RRULE, or plain English like "every weekday at 4:15am".' };
  }

  if (/^RRULE\s*:/i.test(text) || /(^|;)\s*FREQ=/i.test(text)) {
    try {
      const schedule = parseRRule(text);
      return {
        ok: true,
        kind: 'rrule',
        schedule,
        cron: null,
        description: describeRRule(schedule),
        notes: [
          'RRULE has no DTSTART here, so expansion anchors at the start of the preview window.',
        ],
      };
    } catch (e) {
      if (e instanceof RRuleParseError) {
        return { ok: false, error: `RRULE: ${e.message}`, hint: 'Supported parts: FREQ, INTERVAL, BYDAY, BYMONTHDAY, BYMONTH, BYHOUR, BYMINUTE, COUNT, UNTIL.' };
      }
      throw e;
    }
  }

  const ghCrons = extractGithubActionsCrons(text);
  if (ghCrons.length > 0) {
    try {
      const schedule = parseCron(ghCrons[0]);
      const notes = ['GitHub Actions schedules always run in UTC; set the schedule zone accordingly.'];
      if (ghCrons.length > 1) {
        notes.push(`the snippet lists ${ghCrons.length} cron entries; previewing the first (${ghCrons[0]})`);
      }
      return {
        ok: true,
        kind: 'github-actions',
        schedule,
        cron: schedule.source,
        description: describeCron(schedule),
        notes,
      };
    } catch (e) {
      if (e instanceof CronParseError) {
        return { ok: false, error: `cron "${ghCrons[0]}": ${e.message}`, hint: 'GitHub Actions uses standard five-field cron syntax.' };
      }
      throw e;
    }
  }

  const looksLikeCron =
    /^[\d*@]/.test(text) ||
    /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|sun|mon|tue|wed|thu|fri|sat)([-,/]|$)/i.test(
      text.split(/\s/)[0] ?? '',
    );
  try {
    const schedule = parseCron(text);
    return {
      ok: true,
      kind: 'cron',
      schedule,
      cron: schedule.source,
      description: describeCron(schedule),
      notes: [],
    };
  } catch (e) {
    if (!(e instanceof CronParseError)) throw e;
    // Fall through to natural language, but keep the cron error around: if
    // the input clearly wanted to be cron, that error is the useful one.
    const nl = naturalLanguageToCron(text);
    if (nl !== null && nl.rrule !== null) {
      // Phrases like "the last Friday of the month" that cron cannot say.
      const schedule = parseRRule(nl.rrule);
      return {
        ok: true,
        kind: 'natural-language',
        schedule,
        cron: null,
        description: describeRRule(schedule),
        notes: nl.notes,
      };
    }
    if (nl !== null && nl.cron !== null) {
      try {
        const schedule = parseCron(nl.cron);
        return {
          ok: true,
          kind: 'natural-language',
          schedule,
          cron: schedule.source,
          description: describeCron(schedule),
          notes: nl.notes,
        };
      } catch {
        // A bug in the NL builder produced an invalid cron; report honestly.
        return { ok: false, error: `converted "${text}" to "${nl.cron}", which did not parse`, hint: 'Please rephrase, or write the cron expression directly.' };
      }
    }
    if (looksLikeCron) {
      return { ok: false, error: e.message, hint: 'Cron fields: minute hour day-of-month month day-of-week, e.g. "15 4 * * 1-5".' };
    }
    return {
      ok: false,
      error: 'could not understand that as cron, RRULE, or a schedule phrase',
      hint: 'Try "every weekday at 4:15am", "*/10 * * * *", or "FREQ=WEEKLY;BYDAY=MO,FR".',
    };
  }
}
