import { interpretInput, type Interpreted } from '../core/interpret.js';
import { expandSchedule } from '../core/expand.js';
import type { DayCell, ExpandResult, WallTime } from '../core/types.js';
import { pad2 } from '../core/types.js';
import { listTimeZones, localZone } from '../core/tz.js';
import { DEFAULT_HORIZON, decodeShare, encodeShare } from '../core/share.js';

interface AppState {
  input: string;
  scheduleZone: string;
  displayZone: string;
  horizonDays: 30 | 90 | 365;
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const KIND_LABEL: Record<string, string> = {
  cron: 'cron',
  rrule: 'RRULE',
  'github-actions': 'GitHub Actions',
  'natural-language': 'English → cron',
};

const EXAMPLES: Array<{ label: string; value: string }> = [
  { label: '15 4 * * 1-5', value: '15 4 * * 1-5' },
  { label: 'every weekday at 4:15am', value: 'every weekday at 4:15am' },
  { label: '*/10 9-17 * * *', value: '*/10 9-17 * * *' },
  { label: '@daily', value: '@daily' },
  { label: 'first Monday (RRULE)', value: 'FREQ=MONTHLY;BYDAY=1MO;BYHOUR=9' },
  { label: 'GitHub Actions snippet', value: 'on:\n  schedule:\n    - cron: "30 5 * * 1,3,5"' },
  { label: '0 0 13 * 5', value: '0 0 13 * 5' },
];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function wallDateLabel(w: WallTime): string {
  return `${DOW_SHORT[new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay()]} ${w.year}-${pad2(w.month)}-${pad2(w.day)}`;
}

function relativeLabel(utcMs: number, nowMs: number): string {
  const diffMin = Math.round((utcMs - nowMs) / 60000);
  if (diffMin < 1) return 'now';
  if (diffMin < 60) return `in ${diffMin}m`;
  const h = Math.floor(diffMin / 60);
  if (h < 48) return `in ${h}h ${diffMin % 60}m`;
  return `in ${Math.floor(h / 24)}d ${h % 24}h`;
}

export function mountApp(root: HTMLElement): void {
  const initial = decodeShare(window.location.search, localZone());
  const state: AppState = initial
    ? { ...initial }
    : {
        input: '15 4 * * 1-5',
        scheduleZone: 'UTC',
        displayZone: localZone(),
        horizonDays: DEFAULT_HORIZON,
      };
  let selectedDate: string | null = null;

  // ----- static skeleton ----------------------------------------------------
  const wrap = el('div', 'wrap');
  const hero = el('header', 'hero');
  const h1 = el('h1');
  h1.append('Cron ', Object.assign(el('span', 'accent', 'Cartographer')));
  const tagline = el(
    'p',
    undefined,
    'Paste a cron expression, an RRULE, a GitHub Actions schedule, or plain English, and see exactly when it fires on a calendar heatmap, in any time zone. Everything runs in your browser.',
  );
  hero.append(h1, tagline);

  const inputCard = el('div', 'card input-row');
  const textarea = el('textarea');
  textarea.value = state.input;
  textarea.rows = 2;
  textarea.placeholder = 'e.g. 15 4 * * 1-5  —  or  "every weekday at 4:15am"';
  textarea.setAttribute('aria-label', 'Schedule input');
  const chips = el('div', 'chips');
  for (const ex of EXAMPLES) {
    const chip = el('button', 'chip', ex.label);
    chip.type = 'button';
    chip.addEventListener('click', () => {
      textarea.value = ex.value;
      state.input = ex.value;
      recompute();
    });
    chips.append(chip);
  }
  const verdict = el('div', 'verdict');
  inputCard.append(textarea, chips, verdict);

  const controlsCard = el('div', 'card');
  const controls = el('div', 'controls');
  const horizonSeg = el('div', 'seg');
  const horizonButtons = new Map<number, HTMLButtonElement>();
  for (const days of [30, 90, 365] as const) {
    const b = el('button', undefined, `${days} days`);
    b.type = 'button';
    b.addEventListener('click', () => {
      state.horizonDays = days;
      recompute();
    });
    horizonButtons.set(days, b);
    horizonSeg.append(b);
  }
  const horizonCtl = el('div', 'control');
  horizonCtl.append(el('label', undefined, 'Preview window'), horizonSeg);

  const zones = listTimeZones();
  const makeZoneSelect = (labelText: string, get: () => string, set: (z: string) => void) => {
    const ctl = el('div', 'control');
    const select = el('select');
    select.setAttribute('aria-label', labelText);
    for (const z of zones) {
      const opt = el('option', undefined, z);
      opt.value = z;
      select.append(opt);
    }
    select.value = get();
    select.addEventListener('change', () => {
      set(select.value);
      recompute();
    });
    ctl.append(el('label', undefined, labelText), select);
    return { ctl, select };
  };
  const scheduleZoneSel = makeZoneSelect(
    'Schedule runs in',
    () => state.scheduleZone,
    (z) => (state.scheduleZone = z),
  );
  const displayZoneSel = makeZoneSelect(
    'Show times in',
    () => state.displayZone,
    (z) => (state.displayZone = z),
  );

  const shareBtn = el('button', 'share-btn', 'Copy share link');
  shareBtn.type = 'button';
  shareBtn.addEventListener('click', () => {
    const url = `${window.location.origin}${window.location.pathname}?${encodeShare(state)}`;
    void navigator.clipboard
      .writeText(url)
      .then(() => {
        shareBtn.textContent = 'Copied!';
        setTimeout(() => (shareBtn.textContent = 'Copy share link'), 1500);
      })
      .catch(() => {
        window.prompt('Copy this link:', url);
      });
  });
  const shareCtl = el('div', 'control');
  shareCtl.append(el('label', undefined, 'Share'), shareBtn);
  controls.append(horizonCtl, scheduleZoneSel.ctl, displayZoneSel.ctl, shareCtl);
  controlsCard.append(controls);

  const mapCard = el('div', 'card');
  const stats = el('div', 'stats');
  const heatmapScroll = el('div', 'heatmap-scroll');
  const dayDetail = el('div', 'day-detail');
  mapCard.append(el('h2', 'section', 'Firing heatmap'), stats, heatmapScroll, dayDetail);

  const nextCard = el('div', 'card');
  const nextScroll = el('div', 'next-scroll');
  nextCard.append(el('h2', 'section', 'Next firings'), nextScroll);

  const footer = el('footer');
  const repoLink = el('a', undefined, 'source');
  repoLink.href = 'https://github.com/pisanuw/Claude-capstone/tree/main/cron-cartographer';
  repoLink.target = '_blank';
  repoLink.rel = 'noopener';
  footer.append(
    'Deterministic and offline: parsing, natural-language conversion, and time-zone math are all local rule-based logic (',
    repoLink,
    '). Nothing you paste leaves this page.',
  );

  wrap.append(hero, inputCard, controlsCard, mapCard, nextCard, footer);
  root.append(wrap);

  // ----- rendering ------------------------------------------------------------
  function renderVerdict(parsed: ReturnType<typeof interpretInput>): void {
    verdict.replaceChildren();
    if (!parsed.ok) {
      const box = el('div', 'error-box');
      box.append(el('div', undefined, `Could not parse: ${parsed.error}`));
      box.append(el('div', 'hint', parsed.hint));
      verdict.append(box);
      return;
    }
    const desc = el('div', 'desc');
    // English that cron cannot say (e.g. "last Friday of the month") comes back as an RRULE.
    const englishRRule = parsed.kind === 'natural-language' && parsed.schedule.kind === 'rrule';
    const badge = englishRRule ? 'English → RRULE' : KIND_LABEL[parsed.kind];
    desc.append(Object.assign(el('span', 'kind-badge', badge)), parsed.description);
    verdict.append(desc);
    const result = parsed.cron ?? (englishRRule ? parsed.schedule.source : null);
    if (result !== null) {
      const line = el('div', 'cron-line');
      line.append(parsed.cron !== null ? 'cron: ' : 'RRULE: ');
      line.append(el('code', 'mono', result));
      const copy = el('button', 'copy-btn', 'copy');
      copy.type = 'button';
      copy.addEventListener('click', () => {
        void navigator.clipboard.writeText(result).then(() => {
          copy.textContent = 'copied!';
          setTimeout(() => (copy.textContent = 'copy'), 1200);
        });
      });
      line.append(copy);
      verdict.append(line);
    }
    if (parsed.notes.length > 0) {
      const ul = el('ul', 'notes');
      for (const n of parsed.notes) ul.append(el('li', undefined, n));
      verdict.append(ul);
    }
  }

  function levelClass(count: number, max: number): string {
    if (count <= 0) return '';
    const level = Math.max(1, Math.ceil((count / max) * 4));
    return `l${level}`;
  }

  function renderDetail(day: DayCell | null): void {
    dayDetail.replaceChildren();
    if (!day) {
      dayDetail.append(
        el('span', 'muted', 'Hover or click a day to see its exact fire times.'),
      );
      return;
    }
    const [y, m, d] = day.date.split('-').map(Number);
    const head = el('div', undefined);
    head.append(
      el('strong', undefined, wallDateLabel({ year: y, month: m, day: d, hour: 0, minute: 0 })),
      ` — ${day.count === 0 ? 'no firings' : day.count === 1 ? '1 firing' : `${day.count} firings`} (${state.displayZone})`,
    );
    dayDetail.append(head);
    if (day.count > 0) {
      const times = el('div', 'times mono', day.times.join('  '));
      dayDetail.append(times);
      if (day.more > 0) dayDetail.append(el('div', 'muted', `…and ${day.more} more that day`));
    }
  }

  function renderHeatmap(result: ExpandResult): void {
    heatmapScroll.replaceChildren();
    const heatmap = el('div', 'heatmap');
    const monthsRow = el('div', 'hm-months');
    const body = el('div', 'hm-body');
    const dows = el('div', 'hm-dows');
    for (let i = 0; i < 7; i++) dows.append(el('span', undefined, i % 2 === 1 ? DOW_SHORT[i] : ''));
    const grid = el('div', 'hm-grid');

    const firstWeekday = result.days[0]?.weekday ?? 0;
    for (let i = 0; i < firstWeekday; i++) grid.append(el('div', 'hm-cell pad'));

    const byDate = new Map(result.days.map((d) => [d.date, d]));
    let column = 0;
    let cellIndex = firstWeekday;
    const columnMonths: string[] = [];
    for (const day of result.days) {
      const cell = el('div', `hm-cell ${levelClass(day.count, result.maxPerDay)}`.trim());
      cell.dataset.date = day.date;
      cell.title = `${day.date}: ${day.count} firing${day.count === 1 ? '' : 's'}`;
      cell.addEventListener('mouseenter', () => renderDetail(day));
      cell.addEventListener('click', () => {
        selectedDate = day.date;
        grid.querySelectorAll('.hm-cell.selected').forEach((c) => c.classList.remove('selected'));
        cell.classList.add('selected');
        renderDetail(day);
      });
      if (day.date === selectedDate) cell.classList.add('selected');
      grid.append(cell);
      column = Math.floor(cellIndex / 7);
      if (columnMonths[column] === undefined) {
        columnMonths[column] = MONTH_SHORT[Number(day.date.slice(5, 7)) - 1];
      }
      cellIndex++;
    }
    grid.addEventListener('mouseleave', () => {
      renderDetail(selectedDate !== null ? (byDate.get(selectedDate) ?? null) : null);
    });

    let prevLabel = '';
    for (const m of columnMonths) {
      const slot = el('div', undefined, m === prevLabel ? '' : m);
      slot.style.width = '16px';
      slot.style.overflow = 'visible';
      slot.style.whiteSpace = 'nowrap';
      prevLabel = m;
      monthsRow.append(slot);
    }

    body.append(dows, grid);
    heatmap.append(monthsRow, body);

    const legend = el('div', 'hm-legend');
    legend.append(el('span', undefined, 'fewer'));
    for (const cls of ['', 'l1', 'l2', 'l3', 'l4']) {
      legend.append(el('div', `hm-cell ${cls}`.trim()));
    }
    legend.append(el('span', undefined, 'more'));
    heatmap.append(legend);
    heatmapScroll.append(heatmap);
  }

  function renderNext(result: ExpandResult): void {
    nextScroll.replaceChildren();
    if (result.next.length === 0) {
      nextScroll.append(el('div', 'stats', 'No firings inside the preview window.'));
      return;
    }
    const table = el('table', 'next');
    const thead = el('thead');
    const hr = el('tr');
    for (const h of ['#', `${state.scheduleZone} (schedule)`, `${state.displayZone} (display)`, '']) {
      hr.append(el('th', undefined, h));
    }
    thead.append(hr);
    const tbody = el('tbody');
    const nowMs = Date.now();
    result.next.forEach((f, i) => {
      const tr = el('tr');
      tr.append(el('td', undefined, String(i + 1)));
      const sw = f.scheduleWall;
      const dw = f.displayWall;
      tr.append(el('td', 'mono', `${wallDateLabel(sw)} ${pad2(sw.hour)}:${pad2(sw.minute)}`));
      tr.append(el('td', 'mono', `${wallDateLabel(dw)} ${pad2(dw.hour)}:${pad2(dw.minute)}`));
      tr.append(el('td', 'rel', relativeLabel(f.utcMs, nowMs)));
      tbody.append(tr);
    });
    table.append(thead, tbody);
    nextScroll.append(table);
  }

  function renderStats(result: ExpandResult, parsed: Interpreted): void {
    const parts: string[] = [
      `${result.totalFirings.toLocaleString()} firing${result.totalFirings === 1 ? '' : 's'} in the next ${state.horizonDays} days`,
      `${result.daysWithFirings} day${result.daysWithFirings === 1 ? '' : 's'} with firings`,
      `max ${result.maxPerDay.toLocaleString()}/day`,
    ];
    stats.replaceChildren(parts.join(' · '));
    if (result.skippedInDstGap > 0) {
      stats.append(' · ');
      stats.append(
        el(
          'span',
          'warn',
          `${result.skippedInDstGap} firing${result.skippedInDstGap === 1 ? '' : 's'} skipped (DST spring-forward gap in ${state.scheduleZone})`,
        ),
      );
    }
    if (result.truncated) {
      stats.append(' · ');
      stats.append(el('span', 'warn', 'enumeration capped; counts are a lower bound'));
    }
    if (parsed.kind === 'github-actions' && state.scheduleZone !== 'UTC') {
      stats.append(' · ');
      stats.append(el('span', 'warn', 'GitHub Actions always evaluates cron in UTC'));
    }
  }

  function updateControls(): void {
    for (const [days, b] of horizonButtons) {
      b.classList.toggle('on', days === state.horizonDays);
    }
    scheduleZoneSel.select.value = state.scheduleZone;
    displayZoneSel.select.value = state.displayZone;
  }

  function recompute(): void {
    updateControls();
    window.history.replaceState(null, '', `?${encodeShare(state)}`);
    const parsed = interpretInput(state.input);
    renderVerdict(parsed);
    if (!parsed.ok) {
      stats.replaceChildren('');
      heatmapScroll.replaceChildren();
      dayDetail.replaceChildren();
      nextScroll.replaceChildren();
      return;
    }
    const result = expandSchedule(parsed.schedule, {
      scheduleZone: state.scheduleZone,
      displayZone: state.displayZone,
      horizonDays: state.horizonDays,
    });
    selectedDate = null;
    renderStats(result, parsed);
    renderHeatmap(result);
    renderDetail(null);
    renderNext(result);
  }

  let debounce: number | undefined;
  textarea.addEventListener('input', () => {
    state.input = textarea.value;
    window.clearTimeout(debounce);
    debounce = window.setTimeout(recompute, 250);
  });

  recompute();
}
