import { allFunctions, codeLines } from '../core/code';
import { commitStats } from '../core/commits';
import {
  acceptTranscript,
  emptyCourse,
  finalScores,
  flagQueue,
  generateAll,
  linksCsv,
  parseCourse,
  replaceQuestion,
  resultsCsv,
  retime,
  rows,
  type Course,
  type Row,
} from '../core/course';
import { importClassroom } from '../core/github';
import { decodeResponses, vivaId, vivaLink } from '../core/pack';
import { nextCandidate } from '../core/questions';
import { DEMOS, loadDemo } from '../core/demos';
import { RUBRIC, scoreViva } from '../core/scoring';
import type { Submission } from '../core/types';
import { readSubmissionsZip } from '../core/zip';
import { codeBlock, copy, download, esc, prose, store } from './dom';
import { GUIDE_HTML, STEP_HELP } from './guide';

type Tab = 'guide' | 'import' | 'questions' | 'review';

const KEY = 'code-viva-course';

function linkBase(): string {
  return location.href.replace(/[?#].*$/, '');
}

function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? '' : `${Math.round(v * 100)}%`;
}

function sevBadge(severity: number, text: string): string {
  return `<span class="badge sev${severity}">${esc(text)}</span>`;
}

function localOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}

function isoWithLocalOffset(local: string): string {
  if (!local) return '';
  const m = localOffsetMinutes();
  const sign = m < 0 ? '-' : '+';
  const abs = Math.abs(m);
  return `${local.length === 16 ? `${local}:00` : local}${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

export function mountInstructor(root: HTMLElement): void {
  let course: Course = parseCourse(JSON.stringify(store<Course>(KEY) ?? '')) ?? emptyCourse();
  let tab: Tab = course.submissions.length ? (Object.keys(course.transcripts).length ? 'review' : 'questions') : 'guide';
  let selected: string | null = null;
  let message = '';
  let error = '';

  const save = (c: Course) => {
    course = c;
    store(KEY, c);
  };
  const say = (msg: string, isError = false) => {
    message = isError ? '' : msg;
    error = isError ? msg : '';
  };

  root.innerHTML = `
    <header class="top">
      <h1>Code Viva</h1>
      <hw-theme-toggle></hw-theme-toggle>
      <p class="lede">Short written orals about each student's own submission: questions anchored to their functions, names and commits, a timed session from a personal link, and proposed scores with quoted evidence for you to approve. Everything runs in this browser; no code or answers leave it unless you send them.</p>
    </header>
    <section class="card demo-bar" aria-labelledby="demo-h">
      <div>
        <h2 id="demo-h">New here? Start with a demo course</h2>
        <p class="small muted">Each demo is a made-up class with real-looking code and commit history. Most students have already "taken" their viva, so you land on the Review tab with transcripts, proposed scores and a flag queue to explore. Nothing is sent anywhere.</p>
      </div>
      <div class="demo-pick">
        <label for="demo-select">Demo course</label>
        <select id="demo-select">${DEMOS.map((d) => `<option value="${esc(d.id)}">${esc(d.topic)} (${esc(d.languages)}, ${d.students.length} students)</option>`).join('')}</select>
        <button class="primary" id="demo">Load demo</button>
      </div>
    </section>
    <nav class="tabs" role="tablist" aria-label="Steps">
      <button role="tab" data-tab="guide">How it works</button>
      <button role="tab" data-tab="import">1. Import</button>
      <button role="tab" data-tab="questions">2. Questions and links</button>
      <button role="tab" data-tab="review">3. Review</button>
    </nav>
    <div id="msg" role="status" aria-live="polite"></div>
    <div id="panel"></div>`;
  const panel = root.querySelector<HTMLElement>('#panel')!;

  root.querySelector('.tabs')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-tab]');
    if (!b) return;
    tab = b.dataset.tab as Tab;
    say('');
    render();
  });

  function render() {
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    root.querySelector('#msg')!.innerHTML = error ? `<p class="notice bad">${esc(error)}</p>` : message ? `<p class="notice">${prose(message)}</p>` : '';
    if (tab === 'guide') renderGuide();
    else if (tab === 'import') renderImport();
    else if (tab === 'questions') renderQuestions();
    else renderReview();
    addStepHelp();
  }

  root.querySelector('#demo')!.addEventListener('click', () => {
    const id = root.querySelector<HTMLSelectElement>('#demo-select')!.value;
    if (course.submissions.length && !confirm('Replace the current course with this demo course? Export it first if you want to keep it.')) return;
    save(loadDemo(id));
    selected = null;
    tab = 'review';
    const all = rows(course);
    const answered = all.filter((r) => r.score).length;
    const first = flagQueue(course)[0];
    say(`Demo loaded: ${course.settings.course}, ${course.settings.assignment}. ${answered} of ${all.length} students have answered${first ? `; ${first.student} is at the top of the flag queue` : ''}. Open "How it works" for a guided tour.`);
    render();
  });

  /** A collapsible "how to use this step" box at the top of each step tab; its open/closed state is remembered. */
  function addStepHelp() {
    const help = STEP_HELP[tab];
    if (!help) return;
    const key = `code-viva-help-${tab}`;
    const open = store<boolean>(key) ?? true;
    panel.insertAdjacentHTML('afterbegin', `<details class="card help" ${open ? 'open' : ''}><summary>How to use this step</summary>${help}</details>`);
    const d = panel.querySelector<HTMLDetailsElement>('details.help')!;
    d.addEventListener('toggle', () => store(key, d.open));
  }

  function renderGuide() {
    panel.innerHTML = GUIDE_HTML;
    for (const b of panel.querySelectorAll<HTMLButtonElement>('[data-goto]')) {
      b.addEventListener('click', () => {
        tab = b.dataset.goto as Tab;
        say('');
        render();
      });
    }
    panel.querySelector('#guide-demo')?.addEventListener('click', () => {
      root.querySelector<HTMLSelectElement>('#demo-select')!.focus();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // ---------- Import ----------

  function renderImport() {
    const s = course.settings;
    const deadlineLocal = s.deadline ? s.deadline.slice(0, 16) : '';
    panel.innerHTML = `
      <section class="card">
        <h2>Assignment</h2>
        <div class="grid">
          <div class="field"><label for="course">Course</label><input id="course" value="${esc(s.course)}" placeholder="CS 143"></div>
          <div class="field"><label for="assignment">Assignment</label><input id="assignment" value="${esc(s.assignment)}" placeholder="A4: Linked lists"></div>
          <div class="field"><label for="minutes">Session length (minutes)</label><input id="minutes" type="number" min="5" max="120" value="${s.minutes}"></div>
          <div class="field"><label for="nq">Questions per student</label><select id="nq">${[4, 5, 6].map((n) => `<option ${n === s.questions ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
          <div class="field"><label for="fu">Follow-ups per question (max)</label><select id="fu">${[0, 1, 2].map((n) => `<option ${n === s.maxFollowUps ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
          <div class="field"><label for="deadline">Deadline (optional)</label><input id="deadline" type="datetime-local" value="${esc(deadlineLocal)}"><p class="hint">Used to spot code that all arrived in the last hour. Read in this browser's timezone.</p></div>
        </div>
        <div class="field"><label for="spec">Assignment spec (optional)</label><textarea id="spec" rows="5" placeholder="Paste the assignment text. Functions it names are asked about first, and its must/should sentences become questions.">${esc(s.spec)}</textarea></div>
        <button id="save-settings">Save settings</button>
      </section>
      <section class="card">
        <h2>Submissions</h2>
        <div class="two">
          <div>
            <h3>Upload a zip</h3>
            <p class="small muted">A Gradescope export (with <code>submission_metadata.yml</code>), a Canvas "Download submissions" zip, or one folder per student. Add a <code>git-log.txt</code> (output of <code>git log --numstat</code>) to a folder to include its commits.</p>
            <label for="zip" class="sr-only">Submissions zip</label>
            <input id="zip" type="file" accept=".zip,application/zip">
            <p class="small muted" style="margin-top:14px">Just exploring? Use <b>Load demo</b> at the top of the page instead.</p>
          </div>
          <form id="gh">
            <h3>GitHub Classroom</h3>
            <p class="small muted">Reads each student repo for one assignment directly from your browser to GitHub. The token stays in this tab's memory and is never stored.</p>
            <div class="field"><label for="org">Organization</label><input id="org" required placeholder="uw-cs143-fall26"></div>
            <div class="field"><label for="prefix">Assignment prefix</label><input id="prefix" required placeholder="a4-linked-lists"><p class="hint">Classroom names repos <code>prefix-username</code>.</p></div>
            <div class="field"><label for="token">Token (repo read access)</label><input id="token" type="password" autocomplete="off" required></div>
            <div class="field"><label for="offset">Students' timezone (UTC offset, hours)</label><input id="offset" type="number" step="0.5" value="${localOffsetMinutes() / 60}"><p class="hint">GitHub reports commit times in UTC; this turns them back into local time for the late-night check.</p></div>
            <button class="primary" type="submit">Import from GitHub</button>
            <span id="gh-progress" class="small muted" role="status"></span>
          </form>
        </div>
      </section>
      ${submissionsTable()}
      <section class="card">
        <h2>Course file</h2>
        <p class="small muted">The course (submissions, questions, answers and your decisions) is saved in this browser. Export it to keep a copy or hand it to a co-instructor.</p>
        <div class="row">
          <button id="export">Export course JSON</button>
          <label class="button" for="import-json" style="margin:0;font-weight:400">Import course JSON</label>
          <input id="import-json" type="file" accept=".json,application/json" class="sr-only">
          <button id="clear">Clear everything</button>
        </div>
      </section>`;

    const val = (id: string) => panel.querySelector<HTMLInputElement>(`#${id}`)!.value;
    panel.querySelector('#save-settings')!.addEventListener('click', () => {
      save({
        ...course,
        settings: {
          ...course.settings,
          course: val('course').trim(),
          assignment: val('assignment').trim(),
          minutes: Math.min(120, Math.max(5, Number(val('minutes')) || 20)),
          questions: Number(val('nq')),
          maxFollowUps: Number(val('fu')),
          deadline: isoWithLocalOffset(val('deadline')),
          spec: val('spec'),
        },
      });
      say('Settings saved. Questions already generated keep their old settings until you regenerate them.');
      render();
    });
    panel.querySelector<HTMLInputElement>('#zip')!.addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const res = readSubmissionsZip(new Uint8Array(await file.arrayBuffer()));
        if (!res.submissions.length) throw new Error('No code files found in that zip.');
        save(addSubmissions(res.submissions));
        say(`Imported ${res.submissions.length} submissions (${res.layout} layout${res.skipped ? `, ${res.skipped} non-code or oversized files skipped` : ''}).`);
      } catch (err) {
        say(`Could not read that zip: ${(err as Error).message}`, true);
      }
      render();
    });
    panel.querySelector<HTMLFormElement>('#gh')!.addEventListener('submit', async (e) => {
      e.preventDefault();
      const progress = panel.querySelector('#gh-progress')!;
      try {
        const res = await importClassroom((url, init) => fetch(url, init), {
          org: val('org').trim(),
          prefix: val('prefix').trim(),
          token: val('token').trim(),
          utcOffset: Math.round(Number(val('offset')) * 60),
          onProgress: (d, t, repo) => (progress.textContent = t ? `${d} of ${t} repos${repo ? `: ${repo}` : ''}` : 'No repos matched.'),
        });
        if (!res.submissions.length) throw new Error(res.failed.length ? res.failed.map((f) => `${f.repo}: ${f.error}`).join('; ') : 'no repositories start with that prefix');
        save(addSubmissions(res.submissions));
        say(`Imported ${res.submissions.length} repos.${res.failed.length ? ` Skipped ${res.failed.length}: ${res.failed.map((f) => f.repo).join(', ')}.` : ''}`);
      } catch (err) {
        say(`GitHub import failed: ${(err as Error).message}`, true);
      }
      render();
    });
    panel.querySelector('#export')!.addEventListener('click', () => download(`code-viva-${slug(course.settings.assignment || 'course')}.json`, JSON.stringify(course, null, 1), 'application/json'));
    panel.querySelector<HTMLInputElement>('#import-json')!.addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const c = parseCourse(await file.text());
      if (!c) say('That file is not a Code Viva course export.', true);
      else {
        save(c);
        say(`Loaded ${c.submissions.length} submissions.`);
      }
      render();
    });
    panel.querySelector('#clear')!.addEventListener('click', () => {
      if (!confirm('Delete all submissions, questions, answers and decisions from this browser?')) return;
      save(emptyCourse());
      selected = null;
      say('Cleared.');
      render();
    });
    bindAccommodations();
  }

  function addSubmissions(subs: Submission[]): Course {
    const known = new Map(course.submissions.map((s) => [s.id, s]));
    for (const s of subs) known.set(s.id, s);
    return { ...course, submissions: [...known.values()].sort((a, b) => a.student.localeCompare(b.student)) };
  }

  function submissionsTable(): string {
    if (!course.submissions.length) return '';
    const body = course.submissions
      .map((sub) => {
        const st = commitStats(sub.commits, course.settings.deadline || undefined);
        const fns = allFunctions(sub.files).length;
        return `<tr>
          <td>${esc(sub.student)}<div class="small muted">${esc(sub.id)}</div></td>
          <td>${plural(sub.files.length, 'file')}, ${plural(codeLines(sub.files), 'line')}, ${plural(fns, 'function')}</td>
          <td>${st.count ? `${st.count} commits over ${st.spanHours < 48 ? `${st.spanHours.toFixed(1)} h` : `${(st.spanHours / 24).toFixed(1)} days`}` : '<span class="muted">no history</span>'}
            ${st.events.map((e) => `<div>${sevBadge(e.severity, e.kind)} <span class="small">${esc(e.reason)}</span></div>`).join('')}</td>
          <td><label class="sr-only" for="acc-${esc(sub.id)}">Time multiplier for ${esc(sub.student)}</label>
            <select id="acc-${esc(sub.id)}" data-acc="${esc(sub.id)}">${[1, 1.25, 1.5, 2, 3].map((m) => `<option value="${m}" ${(course.accommodations[sub.id] ?? 1) === m ? 'selected' : ''}>${m}x</option>`).join('')}</select></td>
        </tr>`;
      })
      .join('');
    return `<section class="card"><h2>${course.submissions.length} submissions</h2>
      <div class="table-wrap" tabindex="0" role="region" aria-label="Submissions"><table><thead><tr><th>Student</th><th>Code</th><th>Commits</th><th>Extended time</th></tr></thead><tbody>${body}</tbody></table></div>
      <div class="row" style="margin-top:10px"><button class="primary" data-goto="questions">Next: generate questions</button></div></section>`;
  }

  function bindAccommodations() {
    for (const sel of panel.querySelectorAll<HTMLSelectElement>('[data-acc]')) {
      sel.addEventListener('change', () => {
        const id = sel.dataset.acc!;
        let c: Course = { ...course, accommodations: { ...course.accommodations, [id]: Number(sel.value) } };
        if (c.vivas[id] && !c.transcripts[id]) c = retime(c, id);
        save(c);
        say(`Extended time for ${c.submissions.find((s) => s.id === id)?.student} set to ${sel.value}x.${c.vivas[id] ? ' Their link has changed; send the new one.' : ''}`);
        render();
      });
    }
    for (const b of panel.querySelectorAll<HTMLButtonElement>('[data-goto]')) {
      b.addEventListener('click', () => {
        tab = b.dataset.goto as Tab;
        say('');
        render();
      });
    }
  }

  // ---------- Questions ----------

  function renderQuestions() {
    if (!course.submissions.length) {
      panel.innerHTML = `<section class="card"><p>Import submissions first.</p><button data-goto="import">Go to Import</button></section>`;
      bindAccommodations();
      return;
    }
    const issued = course.submissions.filter((s) => course.vivas[s.id]).length;
    const cards = course.submissions
      .map((sub) => {
        const v = course.vivas[sub.id];
        const answered = !!course.transcripts[sub.id];
        if (!v) return `<section class="card"><h3>${esc(sub.student)}</h3><p class="muted">No questions yet.</p></section>`;
        const qs = v.questions
          .map(
            (q, i) => `<div class="question">
              <div class="row"><span class="badge kind">${esc(q.kind)}</span><b>Q${i + 1}</b>
                ${answered ? '' : `<button class="small" data-replace="${esc(sub.id)}" data-i="${i}">Replace</button><button class="small" data-edit="${esc(sub.id)}" data-i="${i}">Edit wording</button>`}</div>
              <p>${prose(q.prompt)}</p>
              ${q.anchor ? `<details><summary class="small">Code shown to the student</summary>${codeBlock(q.anchor)}</details>` : ''}
            </div>`,
          )
          .join('');
        return `<section class="card">
          <div class="row" style="justify-content:space-between">
            <h3>${esc(sub.student)} <span class="muted small">${v.questions.length} questions, ${Math.round(v.minutes * v.timeMultiplier)} min${v.timeMultiplier > 1 ? ` (${v.timeMultiplier}x)` : ''}</span></h3>
            <div class="row">
              ${answered ? '<span class="badge ok">answered</span>' : `<button data-copy="${esc(sub.id)}">Copy link</button><a class="button" target="_blank" rel="noopener" href="${esc(vivaLink(linkBase(), v))}">Open as student</a><button data-regen="${esc(sub.id)}">Regenerate</button>`}
            </div>
          </div>
          ${qs}
        </section>`;
      })
      .join('');
    panel.innerHTML = `
      <section class="card">
        <h2>Questions and links</h2>
        <p class="small muted">Each student gets 4 to 6 questions built from their own code: their functions, guards, data structures, unclear names and unusual commits. Review them, replace any you do not like, then send each student their link. The link carries the questions and code excerpts in its <code>#fragment</code>, which browsers never send to a server.</p>
        <div class="row">
          <button class="primary" id="gen">${issued ? 'Regenerate unanswered' : 'Generate questions for everyone'}</button>
          ${issued ? '<button id="links">Download links CSV</button>' : ''}
          <span class="muted small">${issued} of ${course.submissions.length} have questions.</span>
        </div>
      </section>
      ${cards}`;
    panel.querySelector('#gen')!.addEventListener('click', () => {
      if (issued && !confirm('Regenerate questions for every student who has not answered yet? Links you already sent stop matching.')) return;
      save(generateAll(course));
      say('Questions generated. Copy each link, or download the links CSV for a mail merge.');
      render();
    });
    panel.querySelector('#links')?.addEventListener('click', () => download(`code-viva-links-${slug(course.settings.assignment || 'course')}.csv`, linksCsv(course, (v) => vivaLink(linkBase(), v)), 'text/csv'));
  }

  // One delegated listener for the per-student buttons on the Questions tab.
  panel.addEventListener('click', (e) => void onQuestionClick(e));

  async function onQuestionClick(e: Event) {
    const t = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!t || tab !== 'questions') return;
    const sub = course.submissions.find((s) => s.id === (t.dataset.copy ?? t.dataset.regen ?? t.dataset.replace ?? t.dataset.edit));
    if (!sub) return;
    const v = course.vivas[sub.id]!;
    if (t.dataset.copy) {
      const ok = await copy(vivaLink(linkBase(), v));
      say(ok ? `Link for ${sub.student} copied.` : 'Copy failed: use "Open as student" and copy the address bar.', !ok);
    } else if (t.dataset.regen) {
      save(generateAll(course, [sub.id]));
      say(`New questions for ${sub.student}.`);
    } else if (t.dataset.replace) {
      const i = Number(t.dataset.i);
      const s = course.settings;
      const q = nextCandidate(sub, { spec: s.spec, ...(s.deadline ? { deadline: s.deadline } : {}) }, v.questions);
      if (q) {
        save(replaceQuestion(course, sub.id, i, q));
        say(`Replaced question ${i + 1} for ${sub.student}.`);
      } else say('No other questions are available for this submission. Use "Edit wording" instead.', true);
    } else if (t.dataset.edit) {
      const i = Number(t.dataset.i);
      const q = v.questions[i]!;
      const text = prompt('Question wording (backticks mark code):', q.prompt);
      if (text && text.trim() && text !== q.prompt) {
        save(replaceQuestion(course, sub.id, i, { ...q, prompt: text.trim(), id: `${q.id}-edited` }));
        say(`Edited question ${i + 1} for ${sub.student}.`);
      }
    }
    render();
  }

  // ---------- Review ----------

  function renderReview() {
    const all = rows(course);
    const queue = flagQueue(course);
    const answered = all.filter((r) => r.score);
    const approved = all.filter((r) => r.status === 'approved').length;
    if (!selected || !all.some((r) => r.id === selected && r.score)) selected = queue[0]?.id ?? answered[0]?.id ?? null;
    panel.innerHTML = `
      <section class="card">
        <h2>Collect answers</h2>
        <p class="small muted">Students finish with a response code starting <code>CVR1.</code>. Paste any text containing codes (an LMS export, a pile of emails), or load .txt files.</p>
        <label for="codes" class="sr-only">Response codes</label>
        <textarea id="codes" rows="3" placeholder="CVR1.…"></textarea>
        <div class="row" style="margin-top:8px">
          <button class="primary" id="add-codes">Add responses</button>
          <label class="button" for="code-files" style="margin:0;font-weight:400">Load .txt files</label>
          <input id="code-files" type="file" accept=".txt,text/plain" multiple class="sr-only">
        </div>
      </section>
      <section class="card">
        <div class="row" style="justify-content:space-between">
          <div>
            <span class="stat"><b>${answered.length}/${all.length}</b><span class="small muted">answered</span></span>
            <span class="stat"><b>${queue.length}</b><span class="small muted">to see in person</span></span>
            <span class="stat"><b>${approved}</b><span class="small muted">approved</span></span>
          </div>
          <button id="csv" ${answered.length ? '' : 'disabled'}>Export results CSV</button>
        </div>
      </section>
      <div class="two">
        <div>
          <section class="card">
            <h2>Flag queue</h2>
            <p class="small muted">Answered, not yet approved, and either under 60% or carrying a serious flag. Flags are reasons for a short conversation, not findings of misconduct.</p>
            ${queue.length ? `<ol class="flag-list">${queue.map((r) => `<li><button class="linkish" data-sel="${esc(r.id)}">${esc(r.student)}</button> <span class="small muted">${pct(r.score!.percent)}</span><div>${r.score!.flags.map((f) => sevBadge(f.severity, f.kind)).join(' ')}</div></li>`).join('')}</ol>` : '<p class="muted">Nobody needs a follow-up right now.</p>'}
          </section>
          <section class="card">
            <h2>All students</h2>
            <div class="table-wrap" tabindex="0" role="region" aria-label="All students"><table>
              <thead><tr><th>Student</th><th>Status</th><th>Proposed</th><th>Final</th></tr></thead>
              <tbody>${all.map((r) => rowHtml(r)).join('')}</tbody>
            </table></div>
          </section>
        </div>
        <div id="detail">${detailHtml()}</div>
      </div>`;

    const addText = (text: string) => {
      const { transcripts, errors } = decodeResponses(text);
      const added: string[] = [];
      const problems: string[] = [];
      let c = course;
      for (const t of transcripts) {
        const res = acceptTranscript(c, t);
        if (!res.ok) problems.push(res.error);
        else {
          c = res.course;
          added.push(res.mismatch ? `${res.student} (questions do not match the issued version)` : res.student);
        }
      }
      save(c);
      if (!transcripts.length && !errors) say('No response codes (CVR1.…) found in that text.', true);
      else say(`${added.length ? `Added ${added.join(', ')}.` : ''}${errors ? ` ${errors} code${errors > 1 ? 's were' : ' was'} damaged.` : ''}${problems.length ? ` ${problems.join(' ')}` : ''}`.trim(), !added.length);
      render();
    };
    panel.querySelector('#add-codes')!.addEventListener('click', () => addText(panel.querySelector<HTMLTextAreaElement>('#codes')!.value));
    panel.querySelector<HTMLInputElement>('#code-files')!.addEventListener('change', async (e) => {
      const files = [...((e.target as HTMLInputElement).files ?? [])];
      addText((await Promise.all(files.map((f) => f.text()))).join('\n'));
    });
    panel.querySelector('#csv')!.addEventListener('click', () => download(`code-viva-results-${slug(course.settings.assignment || 'course')}.csv`, resultsCsv(course), 'text/csv'));
    for (const b of panel.querySelectorAll<HTMLElement>('[data-sel]')) {
      b.addEventListener('click', () => {
        selected = b.dataset.sel!;
        render();
        root.querySelector<HTMLElement>('#detail h2')?.focus();
      });
    }
    bindDetail();
  }

  function rowHtml(r: Row): string {
    const status = r.status === 'approved' ? '<span class="badge ok">approved</span>' : r.status === 'to review' ? '<span class="badge sev2">to review</span>' : `<span class="badge">${r.status}</span>`;
    const name = r.score ? `<button class="linkish" data-sel="${esc(r.id)}">${esc(r.student)}</button>` : esc(r.student);
    return `<tr class="${r.id === selected ? 'selected' : ''}"><td>${name}</td><td>${status}</td><td>${pct(r.score?.percent)}</td><td>${pct(r.final)}</td></tr>`;
  }

  function detailHtml(): string {
    if (!selected) return '<section class="card"><p class="muted">No answers yet. Paste response codes above, or load a demo course from the top of the page to see what a finished review looks like.</p></section>';
    const sub = course.submissions.find((s) => s.id === selected)!;
    const v = course.vivas[sub.id]!;
    const t = course.transcripts[sub.id]!;
    const score = scoreViva(v, t, vivaId(v));
    const review = course.reviews[sub.id];
    const finals = finalScores(v, score, review);
    const byId = new Map(t.questions.map((q) => [q.questionId, q]));
    const qs = v.questions
      .map((q, i) => {
        const qs = score.questions[i]!;
        const turns = byId.get(q.id)?.turns ?? [];
        return `<div class="question">
          <div class="row"><span class="badge kind">${esc(q.kind)}</span><b>Q${i + 1}</b></div>
          ${q.anchor ? `<details><summary class="small">Code shown (${esc(q.anchor.file)}:${q.anchor.focus ?? q.anchor.line})</summary>${codeBlock(q.anchor)}</details>` : ''}
          ${turns.map((x) => `<div class="turn ${x.role}"><span class="who">${x.role === 'answer' ? `${esc(sub.student)}${x.pasted ? `, ${Math.round((100 * x.pasted) / x.text.length)}% pasted` : ''}` : x.role === 'followup' ? 'Follow-up' : 'Question'} · ${Math.round(x.at / 1000)} s</span>${prose(x.text)}</div>`).join('') || '<p class="muted">Not reached.</p>'}
          <div class="row" style="margin-top:6px">
            <span>Proposed <b>${qs.score}/3</b></span>
            <label for="s-${i}" style="display:inline;margin:0">Your score</label>
            <select id="s-${i}" data-score="${esc(q.id)}">${[0, 1, 2, 3].map((n) => `<option value="${n}" ${finals[i] === n ? 'selected' : ''}>${n}: ${esc(RUBRIC[n]!.split(':')[0]!)}</option>`).join('')}</select>
          </div>
          ${qs.evidence.length ? qs.evidence.map((e) => `<blockquote>${prose(e)}</blockquote>`).join('') : qs.answered ? '<p class="small muted">No sentence names this code or covers the question.</p>' : ''}
          <p class="small muted">${prose(qs.notes.join(' '))}</p>
        </div>`;
      })
      .join('');
    const total = finals.reduce((a, b) => a + b, 0);
    return `<section class="card">
      <h2 tabindex="-1">${esc(sub.student)}</h2>
      <p class="small muted">${new Date(t.startedAt).toLocaleString()} · ${Math.round(t.durationMs / 60000)} of ${Math.round(v.minutes * v.timeMultiplier)} min${t.timedOut ? ' · timed out' : ''} · left the window ${t.blurs} time${t.blurs === 1 ? '' : 's'}</p>
      ${score.flags.length ? `<ul class="flag-list">${score.flags.map((f) => `<li>${sevBadge(f.severity, f.kind)} ${esc(f.message)}</li>`).join('')}</ul>` : '<p><span class="badge ok">no flags</span></p>'}
      <p>Proposed ${score.total}/${score.max} (${pct(score.percent)}). Your total <b id="final-total">${total}/${score.max} (${pct(total / Math.max(1, score.max))})</b>.</p>
      <details><summary class="small">Rubric</summary><ol start="0" class="small">${RUBRIC.map((r) => `<li>${esc(r)}</li>`).join('')}</ol></details>
      ${qs}
      <div class="field" style="margin-top:12px"><label for="note">Note (exported with the results)</label><textarea id="note" rows="2">${esc(review?.note ?? '')}</textarea></div>
      <div class="row">
        <button class="primary" id="approve">${review?.approved ? 'Approved (update)' : 'Approve these scores'}</button>
        ${review?.approved ? '<button id="unapprove">Reopen</button>' : ''}
      </div>
    </section>`;
  }

  function bindDetail() {
    if (!selected) return;
    const id = selected;
    const collect = (approved: boolean) => {
      const scores: Record<string, number> = {};
      for (const sel of panel.querySelectorAll<HTMLSelectElement>('[data-score]')) scores[sel.dataset.score!] = Number(sel.value);
      save({ ...course, reviews: { ...course.reviews, [id]: { scores, approved, note: panel.querySelector<HTMLTextAreaElement>('#note')!.value } } });
    };
    for (const sel of panel.querySelectorAll<HTMLSelectElement>('[data-score]')) {
      sel.addEventListener('change', () => {
        collect(course.reviews[id]?.approved ?? false);
        const picks = [...panel.querySelectorAll<HTMLSelectElement>('[data-score]')].map((x) => Number(x.value));
        const max = picks.length * 3;
        const total = picks.reduce((a, b) => a + b, 0);
        panel.querySelector('#final-total')!.textContent = `${total}/${max} (${pct(total / Math.max(1, max))})`;
      });
    }
    panel.querySelector('#note')?.addEventListener('change', () => collect(course.reviews[id]?.approved ?? false));
    panel.querySelector('#approve')?.addEventListener('click', () => {
      collect(true);
      const next = flagQueue(course)[0] ?? rows(course).find((r) => r.status === 'to review');
      say(`Approved ${course.submissions.find((s) => s.id === id)?.student}.${next ? ` Next: ${next.student}.` : ' Everyone who answered is approved.'}`);
      selected = next?.id ?? id;
      render();
    });
    panel.querySelector('#unapprove')?.addEventListener('click', () => {
      collect(false);
      render();
    });
  }

  render();
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'course';
}
