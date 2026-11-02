import './style.css';
import rawSchedule from './data/schedule.json';
import { validateSchedule, sessionsForDay, groupByStart, trackMap } from './core/schedule';
import { nowNext, sessionStatus, timeLabel } from './core/clock';
import { emptyFilter, filterSessions, hasActiveFilter, type FilterState } from './core/filter';
import { createStarStore } from './core/stars';
import { dayLabel } from './core/schedule';
import { el, renderBlocks, renderDayTab } from './ui/render';

const data = validateSchedule(rawSchedule);
const tracks = trackMap(data);
const stars = createStarStore(window.localStorage);
const confZone = data.conference.timeZone;
const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

interface AppState {
  day: string;
  filter: FilterState;
  /** null = show conference time; otherwise the viewer's zone. */
  viewZone: string | null;
}

function todayInZone(nowMs: number): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: confZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(nowMs);
}

function initialDay(): string {
  const today = todayInZone(Date.now());
  return data.days.includes(today) ? today : data.days[0];
}

const state: AppState = { day: initialDay(), filter: emptyFilter(), viewZone: null };

const root = document.getElementById('app')!;
root.textContent = '';

/* ---------- header ---------- */
const hdr = el('header', 'hdr');
hdr.append(el('h1', undefined, data.conference.name));
hdr.append(
  el(
    'p',
    'sub',
    `${data.conference.venue} · ${data.conference.city} · ${dayLabel(data.days[0]).label} – ${dayLabel(data.days[data.days.length - 1]).label}, 2026`,
  ),
);
const hdrRow = el('div', 'hdr-row');
const agendaBtn = el('button', 'hdr-btn');
const tzBtn = el('button', 'hdr-btn');
hdrRow.append(agendaBtn, tzBtn);
hdr.append(hdrRow);
root.append(hdr);

/* ---------- sticky nav ---------- */
const sticky = el('nav', 'sticky');
const dayTabs = el('div', 'daytabs');
dayTabs.setAttribute('role', 'tablist');
sticky.append(dayTabs);

const filters = el('div', 'filters');
const search = el('input', 'search') as HTMLInputElement;
search.type = 'search';
search.placeholder = 'Search titles, speakers, rooms…';
search.setAttribute('aria-label', 'Search sessions');
const chips = el('div', 'chips');
filters.append(search, chips);
sticky.append(filters);
root.append(sticky);

/* ---------- body ---------- */
const nowbar = el('div', 'nowbar');
const list = el('main', 'list');
root.append(nowbar, list);

/* ---------- footer ---------- */
const foot = el('footer', 'foot');
const note = el('p', undefined, data.conference.dataNote + ' ');
const link = el('a', undefined, 'Official program ↗');
link.href = data.conference.website;
link.target = '_blank';
link.rel = 'noopener';
note.append(link);
foot.append(note);
foot.append(
  el(
    'p',
    undefined,
    'Stars are saved in your browser only. Built as a reusable template: swap src/data/schedule.json for any conference.',
  ),
);
root.append(foot);

/* ---------- events ---------- */
agendaBtn.addEventListener('click', () => {
  state.filter.starredOnly = !state.filter.starredOnly;
  render();
});
tzBtn.addEventListener('click', () => {
  state.viewZone = state.viewZone === null ? localZone : null;
  render();
});
search.addEventListener('input', () => {
  state.filter.query = search.value;
  render();
});

function toggleTrack(id: string): void {
  if (state.filter.tracks.has(id)) state.filter.tracks.delete(id);
  else state.filter.tracks.add(id);
  render();
}

/* ---------- render ---------- */
function renderNowBar(): void {
  const info = nowNext(data.sessions, Date.now(), confZone);
  nowbar.textContent = '';
  if (info.now.length === 0 && info.next.length === 0) {
    nowbar.hidden = true;
    return;
  }
  nowbar.hidden = false;
  if (info.now.length > 0) {
    const line = el('div');
    line.append(el('span', 'tag', 'Now'));
    line.append(info.now.map((s) => s.title).join(' · '));
    nowbar.append(line);
  }
  if (info.next.length > 0 && info.nextStart) {
    const line = el('div');
    line.append(el('span', 'tag', 'Next'));
    const { day, start } = info.nextStart;
    const when = `${dayLabel(day).weekday} ${timeLabel(day, start, confZone, state.viewZone)}`;
    line.append(`${when} — ${info.next.map((s) => s.title).join(' · ')}`);
    nowbar.append(line);
  }
}

function render(): void {
  // header buttons
  agendaBtn.textContent = `★ My agenda (${stars.count()})`;
  agendaBtn.setAttribute('aria-pressed', String(state.filter.starredOnly));
  tzBtn.textContent = state.viewZone === null ? 'Times: Atlanta (ET)' : `Times: ${localZone}`;
  tzBtn.setAttribute('aria-pressed', String(state.viewZone !== null));
  tzBtn.hidden = localZone === confZone;

  // day tabs
  dayTabs.textContent = '';
  for (const day of data.days) {
    const tab = renderDayTab(day, day === state.day);
    tab.addEventListener('click', () => {
      state.day = day;
      render();
    });
    dayTabs.append(tab);
  }

  // track chips
  chips.textContent = '';
  for (const t of data.tracks) {
    const chip = el('button', 'chip', t.name);
    const on = state.filter.tracks.has(t.id);
    chip.setAttribute('aria-pressed', String(on));
    if (on) chip.style.background = t.color;
    chip.addEventListener('click', () => toggleTrack(t.id));
    chips.append(chip);
  }

  renderNowBar();

  // session list for the selected day
  const daySessions = sessionsForDay(data, state.day);
  const filtered = filterSessions(daySessions, state.filter, tracks, stars.all());
  list.textContent = '';
  if (filtered.length === 0) {
    const msg = hasActiveFilter(state.filter)
      ? state.filter.starredOnly && stars.count() === 0
        ? 'No starred sessions yet. Tap ☆ on any session to build your agenda.'
        : 'No sessions match the current filters on this day.'
      : 'No sessions on this day.';
    list.append(el('div', 'empty', msg));
  } else {
    list.append(
      renderBlocks(groupByStart(filtered), {
        trackNames: tracks,
        confZone,
        viewZone: state.viewZone,
        isStarred: (id) => stars.has(id),
        onToggleStar: (id) => {
          stars.toggle(id);
          render();
        },
        status: (s) => sessionStatus(s, Date.now(), confZone),
      }),
    );
  }
}

render();
// Keep the ON NOW markers and the now/next banner fresh.
setInterval(() => {
  renderNowBar();
}, 30_000);
