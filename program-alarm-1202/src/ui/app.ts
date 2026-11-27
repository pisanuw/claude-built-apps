import { APOLLO_11_TIMELINE } from '../core/apollo';
import { CORE_SETS, TICK_SECONDS, UNITS_PER_TICK, VAC_AREAS, nominalDemandPerTick, template, type JobId } from '../core/jobs';
import { decodeShare, encodeShare, MAX_STEAL, type Tab } from '../core/share';
import {
  compare,
  formatTime,
  initialState,
  SCHEDULERS,
  step,
  type Outcome,
  type RunSummary,
  type SimConfig,
  type SimEvent,
  type SimState,
} from '../core/sim';
import { drawDescent, drawTimelines } from './charts';

const JOB_COLORS: Record<JobId, string> = {
  servicer: 'var(--job-servicer)',
  radar: 'var(--job-radar)',
  telemetry: 'var(--job-telemetry)',
  display: 'var(--job-display)',
  monitor: 'var(--job-monitor)',
};

const SPEEDS = [1, 4, 16] as const;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}

function byId<T extends HTMLElement>(root: ParentNode, id: string): T {
  const n = root.querySelector<T>(`#${id}`);
  if (!n) throw new Error(`missing #${id}`);
  return n;
}

export function outcomeLabel(o: Outcome): string {
  switch (o.kind) {
    case 'landed':
      return `Landed at ${o.speed.toFixed(1)} m/s`;
    case 'hard':
      return `Hard landing at ${o.speed.toFixed(1)} m/s`;
    case 'crashed':
      return `Crashed at ${o.speed.toFixed(1)} m/s`;
    case 'aborted':
      return `Aborted at ${formatTime(o.tick)} (computer halted)`;
    case 'timeout':
      return 'Still airborne when the run ended';
  }
}

const SHELL = `
<header class="top">
  <div class="title-row"><h1>Program Alarm <span class="mono">1202</span></h1><hw-theme-toggle></hw-theme-toggle></div>
  <p class="lede">Fly the last 1.5 km of a lunar descent while a mis-set radar switch steals CPU cycles.
  Watch the Apollo Guidance Computer's priority Executive run out of job slots, raise the famous alarms,
  restart itself, and keep landing guidance alive. Then try the same load on schedulers without that design.</p>
</header>
<nav class="tabs" role="tablist">
  <button role="tab" data-tab="fly" id="tab-fly">Fly</button>
  <button role="tab" data-tab="compare" id="tab-compare">Compare</button>
  <button role="tab" data-tab="apollo" id="tab-apollo">Apollo 11</button>
</nav>
<main>
<section id="panel-fly" class="panel" role="tabpanel" aria-labelledby="tab-fly">
  <div class="card controls">
    <fieldset class="seg" id="sched">
      <legend>Scheduler</legend>
    </fieldset>
    <p class="hint" id="sched-blurb"></p>
    <div class="row">
      <label class="slider">Radar cycle steal <strong id="steal-val"></strong>
        <input type="range" id="steal" min="0" max="${MAX_STEAL}" step="1" />
      </label>
      <label class="check"><input type="checkbox" id="monitor" /> Crew monitor display (Verb 16 Noun 68)</label>
    </div>
    <p class="hint" id="load-note"></p>
    <div class="row buttons">
      <button id="play" class="primary">Play</button>
      <button id="step">Step 0.1 s</button>
      <button id="reset">Reset</button>
      <label class="speed">Speed <select id="speed">${SPEEDS.map((s) => `<option value="${s}">${s}x</option>`).join('')}</select></label>
      <button id="share" title="Copy a link to these settings">Copy link</button>
    </div>
  </div>
  <div id="banner" class="banner" hidden></div>
  <div class="grid">
    <div class="card descent">
      <h2>Descent</h2>
      <canvas id="descent" aria-label="Altitude and velocity over time" role="img"></canvas>
      <p class="legend"><span class="sw sw-alt"></span>altitude <span class="sw sw-vel"></span>sink rate <span class="sw sw-tgt"></span>target sink rate <span class="sw sw-alarm"></span>alarm <span class="sw sw-gd"></span>guidance update</p>
    </div>
    <div class="card dsky" aria-label="DSKY display">
      <h2>DSKY</h2>
      <div class="dsky-body">
        <div class="lights">
          <span id="l-prog" class="light">PROG</span>
          <span id="l-restart" class="light">RESTART</span>
          <span id="l-acty" class="light acty">COMP ACTY</span>
          <span id="l-stale" class="light">GUID STALE</span>
        </div>
        <div class="readouts">
          <div class="ro"><span>PROG</span><b id="d-prog" class="seg7">63</b></div>
          <div class="ro"><span>ALARM</span><b id="d-alarm" class="seg7">----</b></div>
          <div class="ro wide"><span>ALT m</span><b id="d-alt" class="seg7"></b></div>
          <div class="ro wide"><span>H-DOT m/s</span><b id="d-vel" class="seg7"></b></div>
          <div class="ro wide"><span>FUEL kg</span><b id="d-fuel" class="seg7"></b></div>
          <div class="ro wide"><span>CLOCK</span><b id="d-time" class="seg7"></b></div>
        </div>
      </div>
    </div>
    <div class="card exec">
      <h2>Executive</h2>
      <div class="meter-label">CPU this tick <span id="cpu-text"></span></div>
      <div class="meter" id="cpu"><div class="used"></div><div class="steal"></div></div>
      <div class="meter-label">Core sets <span id="core-text"></span></div>
      <div class="slots" id="core"></div>
      <div class="meter-label">VAC areas <span id="vac-text"></span></div>
      <div class="slots" id="vac"></div>
      <table class="jobs">
        <thead><tr><th>Job</th><th>Prio</th><th>Left</th><th title="Restart protected">RP</th></tr></thead>
        <tbody id="jobs"></tbody>
      </table>
    </div>
  </div>
  <div class="card">
    <h2>Event log</h2>
    <div class="log-box" tabindex="0" role="region" aria-label="Event log"><ol id="log" class="log" aria-live="polite"></ol></div>
  </div>
</section>
<section id="panel-compare" class="panel" role="tabpanel" aria-labelledby="tab-compare" hidden>
  <div class="card">
    <h2>Same load, three schedulers</h2>
    <p>Runs the whole descent under each scheduler with the steal and monitor settings from the Fly tab
    (<span id="cmp-settings"></span>). Change them there and come back.</p>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Schedulers compared"><table class="cmp"><thead><tr>
      <th>Scheduler</th><th>Outcome</th><th>1202</th><th>1201</th><th>Restarts</th><th>Missed guidance</th><th>Longest stale</th><th>Display jobs done</th>
    </tr></thead><tbody id="cmp-body"></tbody></table></div>
  </div>
  <div class="card">
    <h2>Guidance timeline</h2>
    <p class="hint">One row per scheduler. Each tick is a completed SERVICER pass; red marks are alarms; the row ends at touchdown or abort.</p>
    <canvas id="timeline" role="img" aria-label="Guidance updates and alarms per scheduler"></canvas>
  </div>
  <div class="card">
    <h2>Steal sweep</h2>
    <p class="hint">Outcome for every steal level from 0% to ${MAX_STEAL}%, with the monitor setting from the Fly tab.</p>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Steal sweep"><table class="sweep" id="sweep"></table></div>
  </div>
</section>
<section id="panel-apollo" class="panel" role="tabpanel" aria-labelledby="tab-apollo" hidden>
  <div class="card">
    <h2>What happened on Apollo 11</h2>
    <p>During the descent on 20 July 1969 the rendezvous radar switch was set so that its interface kept
    interrupting the computer, stealing cycles the flight software had not budgeted for. With the crew also
    running a monitor display, the Executive ran out of the small, fixed pools it used to start jobs and raised
    alarms 1202 and 1201. Instead of failing, the software restarted, dropped the work that could be redone
    later, and re-established the restart-protected jobs, so landing guidance never stopped.</p>
    <ol class="timeline" id="apollo-list"></ol>
    <p class="hint">Times are approximate ground elapsed time; wording follows the NASA air-to-ground transcript as presented in the
    <a href="https://www.hq.nasa.gov/alsj/a11/a11.landing.html" rel="noopener">Apollo Lunar Surface Journal</a>.</p>
  </div>
  <div class="card">
    <h2>How this model maps to the real computer</h2>
    <ul>
      <li><b>Core sets (7) and VAC areas (5)</b> are the real pool sizes. A job asks for a core set; a FINDVAC job also asks for a VAC area. Running out gives 1202 or 1201 here exactly as the alarm codes meant on the AGC.</li>
      <li><b>Priorities</b> decide who gets the CPU. Under overload the lowest-priority jobs starve, keep holding their slots, and the pool drains until a new request fails.</li>
      <li><b>Restart protection</b>: on an overflow, BAILOUT flushes everything and re-establishes only jobs registered in the phase tables (here SERVICER and LR READ), resuming them at their last completed phase.</li>
      <li><b>Simplified</b>: one tick is 0.1 s and 100 work units; job sizes are invented so the nominal load sits near 87% like the real descent; the descent is vertical only; the real Executive was cooperative (jobs yielded at checkpoints), here a higher-priority job takes the CPU at the next tick.</li>
    </ul>
  </div>
</section>
</main>
<footer class="foot">Fully client-side. Not affiliated with NASA or MIT. Source: <a href="https://github.com/pisanuw/Claude-capstone/tree/main/program-alarm-1202" rel="noopener">Claude-capstone/program-alarm-1202</a>.</footer>
`;

export function mountApp(root: HTMLElement): void {
  root.innerHTML = SHELL;
  const initial = decodeShare(location.hash);
  let config: SimConfig = { ...initial.config };
  let tab: Tab = initial.tab;
  let state: SimState = initialState();
  let playing = false;
  let speed: number = SPEEDS[0];
  let lastFrame = 0;
  let carry = 0;
  let renderedEvents = 0;

  const sched = byId<HTMLFieldSetElement>(root, 'sched');
  for (const s of SCHEDULERS) {
    const id = `sched-${s.id}`;
    sched.append(
      el('input', { type: 'radio', name: 'sched', id, value: s.id }),
      el('label', { for: id, text: s.name }),
    );
  }
  const steal = byId<HTMLInputElement>(root, 'steal');
  const monitor = byId<HTMLInputElement>(root, 'monitor');
  const playBtn = byId<HTMLButtonElement>(root, 'play');
  const speedSel = byId<HTMLSelectElement>(root, 'speed');
  const descentCanvas = byId<HTMLCanvasElement>(root, 'descent');
  const timelineCanvas = byId<HTMLCanvasElement>(root, 'timeline');
  const log = byId<HTMLOListElement>(root, 'log');
  const banner = byId<HTMLDivElement>(root, 'banner');

  const apolloList = byId<HTMLOListElement>(root, 'apollo-list');
  for (const e of APOLLO_11_TIMELINE) {
    apolloList.append(
      el('li', { class: e.alarm ? 'alarm' : '' }, [
        el('span', { class: 'get mono', text: e.get }),
        el('div', {}, [el('b', { text: `${e.who}: ` }), `“${e.text}”`, el('p', { class: 'note', text: e.note })]),
      ]),
    );
  }

  function syncUrl(): void {
    history.replaceState(null, '', encodeShare({ config, tab }));
  }

  function syncControls(): void {
    (byId<HTMLInputElement>(root, `sched-${config.scheduler}`)).checked = true;
    steal.value = String(config.stealPct);
    monitor.checked = config.monitorOn;
    byId(root, 'steal-val').textContent = `${config.stealPct}%`;
    byId(root, 'sched-blurb').textContent = SCHEDULERS.find((s) => s.id === config.scheduler)?.blurb ?? '';
    const demand = nominalDemandPerTick(config.monitorOn);
    const cap = UNITS_PER_TICK * (1 - config.stealPct / 100);
    const pct = (demand / cap) * 100;
    byId(root, 'load-note').textContent =
      `Nominal job load ${demand.toFixed(1)} units per tick against ${cap.toFixed(0)} available: ` +
      `${pct.toFixed(0)}% of what is left after the steal. ` +
      (pct > 100 ? 'Overloaded: low-priority work will pile up.' : 'Fits, with no backlog.');
  }

  function setTab(t: Tab): void {
    tab = t;
    for (const name of ['fly', 'compare', 'apollo'] as const) {
      byId(root, `panel-${name}`).hidden = name !== t;
      byId(root, `tab-${name}`).setAttribute('aria-selected', String(name === t));
    }
    if (t === 'compare') renderCompare();
    if (t === 'fly') renderFly();
    syncUrl();
  }

  function reset(): void {
    state = initialState();
    renderedEvents = 0;
    log.replaceChildren();
    setPlaying(false);
    renderFly();
  }

  function setPlaying(p: boolean): void {
    playing = p && !state.outcome;
    playBtn.textContent = playing ? 'Pause' : state.outcome ? 'Done' : 'Play';
    if (playing) {
      lastFrame = performance.now();
      carry = 0;
      requestAnimationFrame(frame);
    }
  }

  function frame(now: number): void {
    if (!playing) return;
    carry += ((now - lastFrame) / 1000) * speed;
    lastFrame = now;
    let n = Math.floor(carry / TICK_SECONDS);
    carry -= n * TICK_SECONDS;
    while (n-- > 0 && !state.outcome) step(state, config);
    renderFly();
    if (state.outcome) setPlaying(false);
    else requestAnimationFrame(frame);
  }

  function renderEvent(e: SimEvent): HTMLLIElement {
    return el('li', { class: `ev ev-${e.kind}` }, [el('span', { class: 'mono t', text: formatTime(e.tick) }), ` ${e.text}`]);
  }

  function renderFly(): void {
    const s = state;
    const l = s.lander;
    const last = s.history[s.history.length - 1];
    const recentAlarm = [...s.alarmTicks].reverse().find((a) => s.tick - a.tick < 30);
    const lastAlarm = s.alarmTicks[s.alarmTicks.length - 1];
    const stale = s.tick - s.lastGuidanceTick > 25 && !s.outcome;
    byId(root, 'l-prog').classList.toggle('on', Boolean(recentAlarm));
    byId(root, 'l-restart').classList.toggle('on', Boolean(recentAlarm) && config.scheduler === 'agc');
    byId(root, 'l-acty').classList.toggle('on', Boolean(last && last.used > 0) && !s.outcome);
    byId(root, 'l-stale').classList.toggle('on', stale || s.halted);
    byId(root, 'd-prog').textContent = s.halted ? '--' : l.altitude < 150 ? '64' : '63';
    byId(root, 'd-alarm').textContent = lastAlarm ? String(lastAlarm.code) : '----';
    byId(root, 'd-alt').textContent = Math.max(0, l.altitude).toFixed(0).padStart(5, '0');
    byId(root, 'd-vel').textContent = (l.velocity >= 0 ? '+' : '-') + Math.abs(l.velocity).toFixed(1).padStart(4, '0');
    byId(root, 'd-fuel').textContent = l.fuel.toFixed(0).padStart(4, '0');
    byId(root, 'd-time').textContent = (s.tick * TICK_SECONDS).toFixed(1);

    const cap = last ? last.capacity : UNITS_PER_TICK * (1 - config.stealPct / 100);
    const used = last ? last.used : 0;
    const cpu = byId(root, 'cpu');
    (cpu.querySelector('.used') as HTMLElement).style.width = `${used}%`;
    (cpu.querySelector('.steal') as HTMLElement).style.width = `${UNITS_PER_TICK - cap}%`;
    byId(root, 'cpu-text').textContent = `${used.toFixed(0)} used, ${(UNITS_PER_TICK - cap).toFixed(0)} stolen or spent on restart, of ${UNITS_PER_TICK}`;

    const slot = (job: (typeof s.jobs)[number] | undefined): HTMLSpanElement => {
      const span = el('span', { class: job ? 'slot full' : 'slot' });
      if (job) {
        span.style.background = JOB_COLORS[job.id];
        span.title = template(job.id).name;
        span.textContent = template(job.id).name.slice(0, 3);
      }
      return span;
    };
    const coreJobs = Array.from({ length: CORE_SETS }, (_, i) => s.jobs.find((j) => j.coreSet === i));
    byId(root, 'core').replaceChildren(...coreJobs.map(slot));
    byId(root, 'core-text').textContent = `${s.jobs.length} of ${CORE_SETS} in use`;
    const vacJobs = Array.from({ length: VAC_AREAS }, (_, i) => s.jobs.find((j) => j.vac === i));
    byId(root, 'vac').replaceChildren(...vacJobs.map(slot));
    byId(root, 'vac-text').textContent = `${vacJobs.filter(Boolean).length} of ${VAC_AREAS} in use`;

    const rows = [...s.jobs]
      .sort((a, b) => template(b.id).priority - template(a.id).priority || a.uid - b.uid)
      .map((j) => {
        const t = template(j.id);
        return el('tr', {}, [
          el('td', {}, [el('span', { class: 'dot', style: `background:${JOB_COLORS[j.id]}` }), ` ${t.name}${j.restarted ? ' ↻' : ''}`]),
          el('td', { text: String(t.priority) }),
          el('td', { text: `${Math.round((j.remaining / j.work) * 100)}%` }),
          el('td', { text: t.restartProtected ? '✓' : '' }),
        ]);
      });
    byId(root, 'jobs').replaceChildren(
      ...(rows.length ? rows : [el('tr', {}, [el('td', { colspan: '4', class: 'muted', text: 'No jobs waiting' })])]),
    );

    for (; renderedEvents < s.events.length; renderedEvents++) log.prepend(renderEvent(s.events[renderedEvents]));

    if (s.outcome) {
      banner.hidden = false;
      banner.className = `banner ${s.outcome.kind === 'landed' ? 'good' : 'bad'}`;
      banner.textContent = `${outcomeLabel(s.outcome)}. ${s.alarmTicks.length} alarm${s.alarmTicks.length === 1 ? '' : 's'}, ${s.restarts} restart${s.restarts === 1 ? '' : 's'}, ${s.misses} missed guidance deadline${s.misses === 1 ? '' : 's'}.`;
    } else {
      banner.hidden = true;
    }
    playBtn.textContent = playing ? 'Pause' : s.outcome ? 'Done' : 'Play';
    drawDescent(descentCanvas, s);
  }

  let lastResults: RunSummary[] | null = null;
  function renderCompare(): void {
    const results: RunSummary[] = compare(config.stealPct, config.monitorOn);
    lastResults = results;
    byId(root, 'cmp-settings').textContent = `${config.stealPct}% steal, monitor ${config.monitorOn ? 'on' : 'off'}`;
    byId(root, 'cmp-body').replaceChildren(
      ...results.map((r) =>
        el('tr', {}, [
          el('th', { scope: 'row', text: SCHEDULERS.find((s) => s.id === r.scheduler)?.name ?? r.scheduler }),
          el('td', { class: r.outcome.kind === 'landed' ? 'good' : 'bad', text: outcomeLabel(r.outcome) }),
          el('td', { text: String(r.alarms1202) }),
          el('td', { text: String(r.alarms1201) }),
          el('td', { text: String(r.restarts) }),
          el('td', { text: String(r.misses) }),
          el('td', { text: `${r.maxStaleSeconds.toFixed(1)} s` }),
          el('td', { text: String(r.displaysCompleted) }),
        ]),
      ),
    );
    drawTimelines(timelineCanvas, results, SCHEDULERS.map((s) => s.name));

    const sweep = byId<HTMLTableElement>(root, 'sweep');
    const head = el('tr', {}, [el('th', { text: 'Steal' }), ...SCHEDULERS.map((s) => el('th', { text: s.name }))]);
    const body: HTMLTableRowElement[] = [];
    for (let p = 0; p <= MAX_STEAL; p += 2) {
      const res = compare(p, config.monitorOn);
      body.push(
        el('tr', { class: p === config.stealPct ? 'current' : '' }, [
          el('th', { scope: 'row', text: `${p}%` }),
          ...res.map((r) => {
            const short = r.outcome.kind === 'aborted' ? 'abort' : r.outcome.kind;
            return el('td', { class: r.outcome.kind === 'landed' ? 'good' : 'bad', text: `${short} (${r.alarms1201 + r.alarms1202})` });
          }),
        ]),
      );
    }
    sweep.replaceChildren(el('thead', {}, [head]), el('tbody', {}, body));
  }

  sched.addEventListener('change', (e) => {
    const v = (e.target as HTMLInputElement).value as SimConfig['scheduler'];
    config = { ...config, scheduler: v };
    syncControls();
    syncUrl();
    reset();
  });
  steal.addEventListener('input', () => {
    config = { ...config, stealPct: Number(steal.value) };
    syncControls();
    syncUrl();
    if (!playing && state.tick === 0) renderFly();
  });
  monitor.addEventListener('change', () => {
    config = { ...config, monitorOn: monitor.checked };
    syncControls();
    syncUrl();
  });
  playBtn.addEventListener('click', () => {
    if (state.outcome) reset();
    setPlaying(!playing);
  });
  byId(root, 'step').addEventListener('click', () => {
    setPlaying(false);
    step(state, config);
    renderFly();
  });
  byId(root, 'reset').addEventListener('click', reset);
  speedSel.addEventListener('change', () => {
    speed = Number(speedSel.value);
  });
  byId(root, 'share').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget as HTMLButtonElement;
    syncUrl();
    try {
      await navigator.clipboard.writeText(location.href);
      btn.textContent = 'Copied';
    } catch {
      btn.textContent = 'Copy from address bar';
    }
    setTimeout(() => (btn.textContent = 'Copy link'), 1500);
  });
  for (const b of root.querySelectorAll<HTMLButtonElement>('.tabs button')) {
    b.addEventListener('click', () => setTab(b.dataset.tab as Tab));
  }
  window.addEventListener('resize', () => (tab === 'compare' ? renderCompare() : renderFly()));

  // The charts read the colour tokens as they draw, so draw them again when the theme changes, and at once on
  // the way into print and back: print takes the light set, but a canvas keeps the pixels it drew on screen.
  // matchMedia('print') changes with the print colours in place (the next frame would come after the printout).
  const redrawCharts = (): void => {
    if (tab === 'compare' && lastResults) drawTimelines(timelineCanvas, lastResults, SCHEDULERS.map((s) => s.name));
    else drawDescent(descentCanvas, state);
  };
  document.addEventListener('hw-themechange', redrawCharts);
  if (typeof window.matchMedia === 'function') window.matchMedia('print').addEventListener?.('change', redrawCharts);

  syncControls();
  setTab(tab);
}
