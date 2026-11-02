/**
 * Deterministic natural-language-to-cron conversion. A fixed set of
 * patterns replaces the Claude API call the original idea suggested, so
 * conversion is instant, offline, and reproducible; anything the rules do
 * not recognize gets an honest null instead of a guessed schedule.
 */

export interface NlResult {
  /** Five-field cron, or null when only an RRULE can say it exactly. */
  cron: string | null;
  /**
   * An RRULE for schedules cron cannot express, such as "the last Friday
   * of the month" (set exactly when `cron` is null).
   */
  rrule: string | null;
  /** Assumptions the converter made, e.g. "assumed midnight". */
  notes: string[];
}

const DOW: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const BYDAY_CODE = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** "first" .. "fifth" and "last" as RRULE BYDAY ordinals. */
const ORDINALS: Record<string, number> = {
  first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3,
  fourth: 4, '4th': 4, fifth: 5, '5th': 5, last: -1,
  'second to last': -2, 'next to last': -2, penultimate: -2,
};
const ORDINAL_WORDS: Record<number, string> = {
  1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth', [-1]: 'last', [-2]: 'second-to-last',
};
const ORDINAL_RE_SRC = '(second[- ]to[- ]last|next[- ]to[- ]last|penultimate|first|second|third|fourth|fifth|last|1st|2nd|3rd|4th|5th)';

interface OrdinalWeekday {
  weekday: number;
  ordinal: number;
}

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8,
  september: 9, sep: 9, sept: 9, october: 10, oct: 10,
  november: 11, nov: 11, december: 12, dec: 12,
};

interface TimeOfDay {
  hour: number;
  minute: number;
}

function parseTimeToken(h: string, m: string | undefined, ampm: string | undefined): TimeOfDay | null {
  let hour = Number(h);
  const minute = m === undefined ? 0 : Number(m);
  if (minute > 59) return null;
  if (ampm) {
    if (hour < 1 || hour > 12) return null;
    if (ampm === 'pm' && hour !== 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
  } else if (hour > 23) {
    return null;
  }
  return { hour, minute };
}

function compressList(values: number[]): string {
  return [...new Set(values)].sort((a, b) => a - b).join(',');
}

/**
 * Convert phrases like "every weekday at 4:15am" to a cron expression, or
 * to an RRULE for "the last Friday of the month"-style phrases, which cron
 * cannot express (it ORs day-of-month with day-of-week).
 */
export function naturalLanguageToCron(input: string): NlResult | null {
  let text = ` ${input.toLowerCase().replace(/[.!?]/g, ' ').replace(/\s+/g, ' ').trim()} `;
  if (text.trim().length === 0) return null;
  const notes: string[] = [];

  // --- ordinal weekdays ("the last friday") ------------------------------
  // "the last weekday" would need BYSETPOS; refuse rather than drop "last".
  if (new RegExp(`\\b${ORDINAL_RE_SRC}\\s+(?:week ?days?|business days?|working days?|weekend days?)\\b`).test(text)) {
    return null;
  }
  const ordinalDays: OrdinalWeekday[] = [];
  const ordRe = new RegExp(`\\b${ORDINAL_RE_SRC}\\s+(${Object.keys(DOW).join('|')})s?\\b`, 'g');
  text = text.replace(ordRe, (_m, ord: string, day: string) => {
    ordinalDays.push({ weekday: DOW[day], ordinal: ORDINALS[ord.replace(/-/g, ' ')] });
    return ' ';
  });

  // --- times of day -------------------------------------------------------
  const times: TimeOfDay[] = [];
  const timeRe = /(?:^|[\s@])(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?=[\s,])|(?:at\s+)(\d{1,2})(?::(\d{2}))?(?=[\s,])/g;
  let tm: RegExpExecArray | null;
  while ((tm = timeRe.exec(text)) !== null) {
    const t =
      tm[1] !== undefined
        ? parseTimeToken(tm[1], tm[2], tm[3])
        : parseTimeToken(tm[4], tm[5], undefined);
    if (t) times.push(t);
  }
  if (/\bnoon\b/.test(text)) times.push({ hour: 12, minute: 0 });
  if (/\bmidnight\b/.test(text)) times.push({ hour: 0, minute: 0 });

  // --- day-of-week --------------------------------------------------------
  const dows = new Set<number>();
  let sawWeekday = false;
  if (/\bweekdays?\b/.test(text) || /\bbusiness days?\b/.test(text)) {
    sawWeekday = true;
  }
  const sawWeekend = /\bweekends?\b/.test(text);
  for (const [name, num] of Object.entries(DOW)) {
    if (new RegExp(`\\b${name}s?\\b`).test(text)) dows.add(num);
  }

  // --- day-of-month -------------------------------------------------------
  const doms: number[] = [];
  const domRe = /\b(?:on\s+)?the\s+(\d{1,2})(?:st|nd|rd|th)\b|\bfirst (?:day )?of (?:the|each|every) month\b|\blast day\b/g;
  let dm: RegExpExecArray | null;
  while ((dm = domRe.exec(text)) !== null) {
    if (dm[0].includes('last day')) {
      return null; // cron has no "last day of month"; be honest about it
    }
    if (dm[1] !== undefined) {
      const d = Number(dm[1]);
      if (d >= 1 && d <= 31) doms.push(d);
    } else {
      doms.push(1);
    }
  }

  // --- months -------------------------------------------------------------
  const monthsSet = new Set<number>();
  for (const [name, num] of Object.entries(MONTHS)) {
    if (new RegExp(`\\b(?:in|during|of)\\s+${name}\\b`).test(text)) monthsSet.add(num);
  }
  if (/\bevery quarter\b|\bquarterly\b/.test(text)) {
    [1, 4, 7, 10].forEach((m) => monthsSet.add(m));
    if (doms.length === 0 && ordinalDays.length === 0) {
      doms.push(1);
      notes.push('quarterly runs on the 1st of Jan/Apr/Jul/Oct');
    }
  }

  // --- intervals ----------------------------------------------------------
  const every = /\bevery\s+(?:(\d+)|other)\s*(minute|min|hour|day|week|month)s?\b/.exec(text);
  const intervalN = every ? (every[1] !== undefined ? Number(every[1]) : 2) : null;
  const intervalUnit = every
    ? every[2].startsWith('min')
      ? 'minute'
      : every[2]
    : null;

  const hourly = /\bhourly\b|\bevery hour\b/.test(text);
  const daily = /\bdaily\b|\bevery day\b|\bonce a day\b/.test(text);
  const weekly = /\bweekly\b|\bevery week\b|\bonce a week\b/.test(text);
  const monthly = /\bmonthly\b|\bevery month\b|\bonce a month\b/.test(text);
  const yearly = /\byearly\b|\bannually\b|\bevery year\b|\bonce a year\b/.test(text);
  const everyMinute = /\bevery minute\b/.test(text) && intervalN === null;

  // --- assemble the five fields -------------------------------------------
  let minuteField: string | null = null;
  let hourField: string | null = null;
  let domField = doms.length > 0 ? compressList(doms) : '*';
  let monthField = monthsSet.size > 0 ? compressList([...monthsSet]) : '*';
  let dowField = '*';
  if (sawWeekday && dows.size === 0) dowField = '1-5';
  else if (sawWeekend && dows.size === 0) dowField = '0,6';
  else if (dows.size > 0) dowField = compressList([...dows]);

  if (times.length > 0) {
    const uniq = new Map<string, TimeOfDay>();
    for (const t of times) uniq.set(`${t.hour}:${t.minute}`, t);
    const list = [...uniq.values()];
    const minutes = new Set(list.map((t) => t.minute));
    if (minutes.size === 1) {
      minuteField = String(list[0].minute);
      hourField = compressList(list.map((t) => t.hour));
    } else if (list.length === 1) {
      minuteField = String(list[0].minute);
      hourField = String(list[0].hour);
    } else {
      // Mixed minutes across several times cannot be expressed in one cron.
      notes.push('multiple times with different minutes need separate cron entries; using the first');
      minuteField = String(list[0].minute);
      hourField = String(list[0].hour);
    }
  }

  if (ordinalDays.length > 0) {
    return ordinalWeekdayRRule(ordinalDays, {
      minuteField,
      hourField,
      months: [...monthsSet],
      monthInterval: intervalUnit === 'month' ? (intervalN as number) : 1,
      // Anything else would need a day filter RRULE cannot combine exactly.
      conflict:
        doms.length > 0 ||
        dows.size > 0 ||
        sawWeekday ||
        sawWeekend ||
        (intervalN !== null && intervalUnit !== 'month') ||
        hourly ||
        everyMinute ||
        (yearly && monthsSet.size === 0),
      notes,
    });
  }

  if (intervalN !== null && intervalUnit === 'minute') {
    minuteField = intervalN === 1 ? '*' : `*/${intervalN}`;
    hourField = hourField ?? '*';
  } else if (everyMinute) {
    minuteField = '*';
    hourField = hourField ?? '*';
  } else if (intervalN !== null && intervalUnit === 'hour') {
    minuteField = minuteField ?? '0';
    hourField = intervalN === 1 ? '*' : `*/${intervalN}`;
  } else if (hourly) {
    minuteField = minuteField ?? '0';
    hourField = '*';
  } else if (intervalN !== null && intervalUnit === 'day') {
    if (intervalN > 1) {
      domField = `*/${intervalN}`;
      notes.push(`"every ${intervalN} days" becomes day-of-month */${intervalN}, which resets at each month boundary`);
    }
  } else if (intervalN !== null && intervalUnit === 'week') {
    if (intervalN > 1) return null; // cron cannot express "every N weeks"
    if (dowField === '*') {
      dowField = '1';
      notes.push('assumed Monday for the weekly run');
    }
  } else if (intervalN !== null && intervalUnit === 'month') {
    if (intervalN > 1) {
      monthField = `*/${intervalN}`;
    }
    if (domField === '*') {
      domField = '1';
      notes.push('assumed the 1st of the month');
    }
  } else if (weekly && dowField === '*') {
    dowField = '1';
    notes.push('assumed Monday for the weekly run');
  } else if (monthly && domField === '*') {
    domField = '1';
    notes.push('assumed the 1st of the month');
  } else if (yearly) {
    if (monthField === '*') {
      monthField = '1';
      notes.push('assumed January 1st for the yearly run');
    }
    if (domField === '*') domField = '1';
  }

  const anySignal =
    times.length > 0 ||
    dows.size > 0 ||
    sawWeekday ||
    sawWeekend ||
    doms.length > 0 ||
    monthsSet.size > 0 ||
    intervalN !== null ||
    hourly || daily || weekly || monthly || yearly || everyMinute;
  if (!anySignal) return null;

  if (minuteField === null || hourField === null) {
    // A date-ish schedule with no time of day: assume midnight, say so.
    minuteField = minuteField ?? '0';
    hourField = hourField ?? '0';
    if (times.length === 0 && !hourly && !everyMinute) {
      notes.push('no time of day given; assumed 00:00');
    }
  }

  return { cron: `${minuteField} ${hourField} ${domField} ${monthField} ${dowField}`, rrule: null, notes };
}

interface OrdinalContext {
  minuteField: string | null;
  hourField: string | null;
  months: number[];
  monthInterval: number;
  conflict: boolean;
  notes: string[];
}

/** Build the MONTHLY RRULE for "the last Friday"-style phrases. */
function ordinalWeekdayRRule(days: OrdinalWeekday[], ctx: OrdinalContext): NlResult | null {
  if (ctx.conflict) return null;
  const notes = ctx.notes;
  const parts = ['FREQ=MONTHLY'];
  if (ctx.monthInterval > 1) {
    parts.push(`INTERVAL=${ctx.monthInterval}`);
    notes.push(`every ${ctx.monthInterval} months counts from the start of the preview window (no DTSTART)`);
  }
  parts.push(`BYDAY=${days.map((d) => `${d.ordinal}${BYDAY_CODE[d.weekday]}`).join(',')}`);
  if (ctx.months.length > 0) parts.push(`BYMONTH=${compressList(ctx.months)}`);
  if (ctx.minuteField === null || ctx.hourField === null) {
    notes.push('no time of day given; assumed 00:00');
  }
  parts.push(`BYHOUR=${ctx.hourField ?? '0'}`, `BYMINUTE=${ctx.minuteField ?? '0'}`);
  const phrase = days.map((d) => `the ${ORDINAL_WORDS[d.ordinal]} ${DOW_FULL[d.weekday]}`).join(' and ');
  const quartz =
    days.length === 1 && days[0].ordinal !== -2
      ? `; Quartz-style cron writes it as ${days[0].weekday}${days[0].ordinal === -1 ? 'L' : `#${days[0].ordinal}`}`
      : '';
  notes.push(
    `standard cron cannot express "${phrase} of the month": with both day-of-month and day-of-week set it fires on either, so this is an RRULE instead${quartz}`,
  );
  return { cron: null, rrule: parts.join(';'), notes };
}
