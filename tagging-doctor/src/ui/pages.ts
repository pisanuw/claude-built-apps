/**
 * The signed-in pages (SPEC.md section 4): My courses (AC-18, AC-24), a
 * course (AC-19, AC-25), its printable report (AC-20), a project's history
 * (AC-21, AC-25), the save dialog (AC-17, AC-21, AC-26) and "What we keep"
 * (AC-26). Plain DOM, like the scan screen; the data comes through a
 * CourseStore, so tests run on the in-memory one.
 */
import {
  blockerTable,
  courseReportBody,
  courseReportHtml,
  courseRows,
  latestCheck,
  deltaLine,
  exportJson,
  latestByProject,
  reportData,
  shortDate,
  shortDateTime,
  suggestedProjectName,
  type CourseReport,
  type SaveItem,
} from '../core/saved';
import { SaveError, type CourseRow, type CourseStore, type ProjectRow, type SavedResult } from '../lib/store';
import type { StatusData } from '../core/status';
import { jobLine } from '../core/compile';

export interface PageCtx {
  /** The signed-in person's store, or null when signed out. */
  store: () => CourseStore | null;
  now: () => Date;
  download: (name: string, type: string, content: string) => void;
  confirm: (message: string) => boolean;
  print: () => void;
  /** The package data file, whose header the course report names (AC-75). */
  loadData: () => Promise<StatusData>;
  /** True while this render is still the page on screen (a newer route replaces it). */
  current: () => boolean;
}

export const KEEP_HASH = '#/what-we-keep';
export const SIGN_IN_FOR_COURSES = 'Sign in to see your courses. The scan works without signing in.';
export const NO_COURSES = 'You have no courses yet. Scan a project, choose “Save”, and start a course there.';
export const NO_PROJECTS = 'No projects yet. Drop a project to scan it.';

/**
 * An error in plain words (R2.1-9): the two the database gives when another
 * tab changed the same course, and otherwise the message as it came.
 */
export function plainError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/foreign key/i.test(m)) return 'the course or project is no longer there, perhaps deleted in another tab. Choose the course again';
  if (/duplicate key|unique constraint/i.test(m)) return 'a project of that name was saved at the same moment, perhaps in another tab. Save again to add this scan to it';
  if (/failed to fetch|networkerror|network request failed/i.test(m)) return 'the connection was lost; check it';
  return m;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

function link(href: string, text: string, attrs: Record<string, string> = {}): HTMLAnchorElement {
  return el('a', { href, ...attrs }, text);
}

function button(text: string, onClick: () => void, attrs: Record<string, string> = {}): HTMLButtonElement {
  const b = el('button', { type: 'button', ...attrs }, text);
  b.addEventListener('click', onClick);
  return b;
}

function heading(text: string): HTMLHeadingElement {
  return el('h2', { id: 'page-h', tabindex: '-1' }, text);
}

function table(caption: string, cols: string[], rows: (string | Node)[][]): HTMLElement {
  const t = el('table');
  t.append(el('caption', {}, caption));
  const head = el('tr');
  for (const c of cols) head.append(el('th', { scope: 'col' }, c));
  const thead = el('thead');
  thead.append(head);
  const body = el('tbody');
  for (const r of rows) {
    const tr = el('tr');
    for (const cell of r) {
      const td = el('td');
      td.append(cell);
      tr.append(td);
    }
    body.append(tr);
  }
  t.append(thead, body);
  const wrap = el('div', { class: 'table-wrap' });
  wrap.append(t);
  return wrap;
}

/** Shows "Loading…", runs `load`, and on failure the error with a retry (AC-18). */
async function withStates(page: HTMLElement, title: string, ctx: PageCtx, what: string, load: (store: CourseStore) => Promise<HTMLElement[]>): Promise<void> {
  const store = ctx.store();
  if (!store) {
    page.replaceChildren(heading(title), el('p', { class: 'signed-out' }, SIGN_IN_FOR_COURSES));
    return;
  }
  page.replaceChildren(heading(title), el('p', { class: 'loading', role: 'status' }, `Loading ${what}…`));
  try {
    const parts = await load(store);
    if (!ctx.current()) return;
    page.replaceChildren(...parts);
  } catch (e) {
    if (!ctx.current()) return;
    const msg = el('p', { class: 'error-text', role: 'alert' }, `Could not load ${what}: ${plainError(e)}`);
    const again = el('p');
    again.append(button('Retry', () => void withStates(page, title, ctx, what, load)));
    page.replaceChildren(heading(title), msg, again);
  }
}

function courseTitle(c: Pick<CourseRow, 'name' | 'term'>): string {
  return c.term ? `${c.name}, ${c.term}` : c.name;
}

/** My courses: the list with project counts, and "Export my data" (AC-18, AC-24). */
export function renderCourses(page: HTMLElement, ctx: PageCtx): Promise<void> {
  return withStates(page, 'My courses', ctx, 'your courses', async (store) => {
    const courses = await store.courses();
    const out: HTMLElement[] = [heading('My courses')];
    if (!courses.length) {
      const p = el('p', { class: 'empty' }, NO_COURSES);
      const start = el('p');
      start.append(link('#/', 'Scan a project'));
      out.push(p, start);
    } else {
      out.push(
        table(
          'Your courses',
          ['Course', 'Projects', 'Started'],
          courses.map((c) => [link(`#/course/${c.id}`, courseTitle(c)), String(c.projects), shortDate(c.created_at)]),
        ),
      );
    }
    const exp = el('p', { class: 'actions' });
    exp.append(
      button('Export my data', () => {
        void store.exportAll().then(
          (rows) => ctx.download('tagging-doctor-my-data.json', 'application/json', exportJson(rows, ctx.now())),
          (e) => exp.append(el('span', { role: 'alert' }, ` Could not export: ${plainError(e)}`)),
        );
      }),
    );
    out.push(exp, el('p', { class: 'help' }, 'The export is one JSON file with all your courses, projects, scans, checks and alt texts.'));
    return out;
  });
}

/** A course: each project with its latest verdict, counts and date (AC-19), the report, and delete (AC-25). */
export function renderCourse(page: HTMLElement, ctx: PageCtx, id: string, go: (hash: string) => void): Promise<void> {
  return withStates(page, 'Course', ctx, 'this course', async (store) => {
    const course = await store.course(id);
    if (!course) return notFound('This course was not found. It may have been deleted.');
    const projects = await store.projects(id);
    const latest = latestByProject(await store.scanSummaries(projects.map((p) => p.id)));
    const out: HTMLElement[] = [heading(courseTitle(course))];
    if (!projects.length) {
      out.push(el('p', { class: 'empty' }, NO_PROJECTS));
    } else {
      const rows = courseRows(projects, latest);
      out.push(
        table(
          'Projects, with their latest scan',
          ['Project', 'Latest verdict', 'Blockers', 'Warnings', 'Latest scan'],
          rows.map((r, i) => [link(`#/project/${projects[i].id}`, r.project), r.verdict ?? 'Not scanned yet', String(r.blockers), String(r.warnings), r.scannedAt ? shortDate(r.scannedAt) : 'none']),
        ),
      );
    }
    const actions = el('p', { class: 'actions' });
    if (projects.length) actions.append(link(`#/course/${id}/report`, 'Course report', { class: 'button-link' }), ' ');
    actions.append(link('#/', 'Add a project', { class: 'button-link' }), ' ');
    actions.append(
      button('Delete this course', () => {
        if (!ctx.confirm(`Delete ${courseTitle(course)}, its ${projects.length === 1 ? 'project' : `${projects.length} projects`} and all their scans? This cannot be undone.`)) return;
        void store.deleteCourse(id).then(
          () => go('#/courses'),
          (e) => actions.append(el('span', { role: 'alert' }, ` Could not delete: ${plainError(e)}`)),
        );
      }),
    );
    out.push(actions);
    return out;
  });
}

/** The not-found page, for an id that is gone or malformed (R2.1-9). */
export function renderNotFound(page: HTMLElement, text: string): void {
  page.replaceChildren(...notFound(text));
}

function notFound(text: string): HTMLElement[] {
  const back = el('p');
  back.append(link('#/courses', 'Back to My courses'));
  return [heading('Not found'), el('p', { class: 'empty' }, text), back];
}

/** The data of a course's report (AC-20). */
export async function courseReport(store: CourseStore, id: string, now: Date, data: StatusData, known?: CourseRow): Promise<CourseReport | null> {
  const course = known ?? (await store.course(id));
  if (!course) return null;
  const projects = await store.projects(id);
  // Summaries first; then the findings of the latest scan of each project only (R2.1-6).
  const latestSummaries = latestByProject(await store.scanSummaries(projects.map((p) => p.id)));
  const ids = projects.map((p) => p.id);
  const [latest, jobs, alts] = await Promise.all([store.scansById([...latestSummaries.values()].map((x) => x.id)).then(latestByProject), store.jobsOf(ids), store.altTextsOf(ids)]);
  // AC-52: each project's latest check, and how many alt texts it has approved here.
  const approved = new Map<string, number>();
  for (const a of alts) approved.set(a.project_id, (approved.get(a.project_id) ?? 0) + 1);
  return {
    course: { name: course.name, term: course.term },
    generatedAt: now.toISOString(),
    rows: courseRows(projects, latest, latestCheck(jobs), approved),
    blockers: blockerTable(projects, latest),
    data: reportData(latest.values(), data),
  };
}

/** The printable course report: the report alone, with Print and Download HTML (AC-20). */
export function renderCourseReport(page: HTMLElement, ctx: PageCtx, id: string): Promise<void> {
  return withStates(page, 'Course report', ctx, 'the course report', async (store) => {
    const [data, found] = await Promise.all([ctx.loadData(), store.course(id)]);
    // The course row read once (R2.2-3).
    const r = found ? await courseReport(store, id, ctx.now(), data, found) : null;
    if (!r) return notFound('This course was not found. It may have been deleted.');
    const actions = el('p', { class: 'actions no-print' });
    actions.append(
      button('Print', () => ctx.print()),
      ' ',
      button('Download HTML', () => ctx.download(`tagging-doctor-course-${slug(r.course.name)}.html`, 'text/html', courseReportHtml(r))),
      ' ',
      link(`#/course/${id}`, 'Back to the course'),
    );
    const body = el('div', { class: 'course-report' });
    // Every value in it went through escapeHtml.
    body.innerHTML = courseReportBody(r, 2, 'local');
    return [actions, body];
  });
}

function slug(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'course';
}

/** A project's history: scans with fixed and new counts (AC-21), checks, alt texts, and delete (AC-25). */
export function renderProject(page: HTMLElement, ctx: PageCtx, id: string, go: (hash: string) => void): Promise<void> {
  return withStates(page, 'Project', ctx, 'this project', async (store) => {
    const h = await store.history(id);
    if (!h) return notFound('This project was not found. It may have been deleted.');
    const out: HTMLElement[] = [heading(h.project.name)];
    const where = el('p', { class: 'meta' });
    where.append(`Main file ${h.project.main_file}${h.course ? ', in ' : ''}`);
    if (h.course) where.append(link(`#/course/${h.course.id}`, courseTitle(h.course)));
    where.append('.');
    out.push(where, el('h3', {}, 'Scans'));
    if (!h.scans.length) out.push(el('p', { class: 'empty' }, 'No scans saved yet.'));
    else {
      out.push(
        table(
          'Scans, newest first',
          ['Saved', 'Verdict', 'Blockers', 'Warnings', 'Since the previous scan'],
          h.scans.map(({ scan, delta }) => [shortDateTime(scan.created_at), scan.summary.verdict, String(scan.summary.blockers), String(scan.summary.warnings), delta ? `${delta.fixed} fixed, ${delta.added} new` : 'first scan']),
        ),
      );
    }
    out.push(el('h3', {}, 'Checks'));
    if (!h.jobs.length) out.push(el('p', { class: 'empty' }, 'No checks yet. “Compile and check” on a saved scan adds one here.'));
    else {
      // Each check names the scan whose files were compiled (AC-35).
      const savedAt = new Map(h.scans.map(({ scan }) => [scan.id, shortDateTime(scan.created_at)]));
      out.push(
        table(
          'Checks, newest first',
          ['Finished', 'Scan saved', 'Kind', 'Result'],
          h.jobs.map((j) => [
            j.finished_at ? shortDateTime(j.finished_at) : shortDateTime(j.created_at),
            savedAt.get(j.scan_id) ?? 'an earlier scan',
            j.kind === 'patched-check' ? 'patched copy' : 'original',
            jobLine(j),
          ]),
        ),
      );
    }
    out.push(el('h3', {}, 'Alt texts'));
    out.push(el('p', { class: 'empty' }, h.altTexts.length ? `${h.altTexts.length === 1 ? '1 alt text' : `${h.altTexts.length} alt texts`} saved.` : 'No saved alt texts.'));
    const actions = el('p', { class: 'actions' });
    actions.append(
      button('Delete this project', () => {
        if (!ctx.confirm(`Delete ${h.project.name} and its ${h.scans.length === 1 ? 'scan' : `${h.scans.length} scans`}? This cannot be undone.`)) return;
        void store.deleteProject(id).then(
          () => go(`#/course/${h.project.course_id}`),
          (e) => actions.append(el('span', { role: 'alert' }, ` Could not delete: ${plainError(e)}`)),
        );
      }),
    );
    out.push(actions);
    return out;
  });
}

/** The statements of "What we keep" (AC-26), in order. */
export const KEEP_POINTS: string[] = [
  'Your sources are never stored. The scan reads your files in this browser, and nothing is uploaded for it: the line “Nothing is uploaded” on the scan page speaks of the scan only.',
  'Files named like student records (grades, gradebook, roster, students), and files in folders named so, are left out and never read.',
  'When you save a scan, we keep its report only: the verdict and the counts, and for each finding the file path, the line number, the package name and an excerpt of at most 200 characters. Saved reports hold excerpts only, never whole files.',
  'Saved reports stay until you delete them. You can delete a project or a course, with its scans, checks and alt texts; download everything with “Export my data” on My courses; and delete your account with “Delete my account”, in the panel under your name, which removes what every HintWise app keeps for you.',
  'Your account and saved reports are kept in HintWise’s database at Supabase, in the US (US East).',
  'Compile and check sends the project’s files to the HintWise checker, which runs on Render in the US (region oregon). The checker deletes a job’s files within 30 minutes. Upload only materials you wrote or may change. For a saved scan, the check’s result is kept with the project: its status, times, page count, warnings and the PDF/UA failures by clause, never the PDF or your files.',
  'A figure draft sends the figure’s image file as it is (PNG, JPEG, GIF or WebP; one over 680 KB or 1568 pixels is redrawn smaller first, and what a file carries inside, such as a photo’s place, goes with it), the file’s name without its folders, its caption and label, and up to 1,200 characters of the text around it to Anthropic, and only when you choose Draft or Draft all: straight from this browser with your own key, which is kept in this browser only, or through HintWise’s gateway with HintWise’s key. The gateway records when each person first and last used the app.',
  'Visits are counted without cookies.',
];

export function renderKeep(page: HTMLElement): void {
  const ul = el('ul', { class: 'keep' });
  for (const t of KEEP_POINTS) ul.append(el('li', {}, t));
  const back = el('p');
  back.append(link('#/', 'Back to the scan'));
  page.replaceChildren(heading('What we keep'), ul, back);
}

/** The save dialog (AC-17, AC-21, AC-26): choose or create a course, name the project, save. */
export interface SaveDialogOpts {
  store: CourseStore;
  items: SaveItem[];
  /** One document saved under a name the person gives, or every document of a "Scan all", each named by its path. */
  mode: 'one' | 'all';
  onClose: () => void;
  onSaved?: (results: SavedResult[], course: CourseRow) => void;
}

export function renderSaveDialog(panel: HTMLElement, opts: SaveDialogOpts): void {
  const { store, items, mode } = opts;
  const h = el('h3', { id: 'save-h', tabindex: '-1' }, mode === 'all' ? 'Save all to a course' : 'Save to a course');
  const keep = el('p', { class: 'help' });
  keep.append('Saved: the verdict, the counts, and each finding’s file, line and a short excerpt; never your files. ', link(KEEP_HASH, 'What we keep'));
  const status = el('p', { class: 'save-status', role: 'status' });
  panel.replaceChildren(h, keep, el('p', { class: 'loading', role: 'status' }, 'Loading your courses…'));

  let courses: CourseRow[] = [];
  const load = async () => {
    try {
      courses = await store.courses();
      // A dialog drawn again meanwhile (sign-out, another person) is not this one any more (R2.2-3).
      if (!panel.contains(h)) return;
      draw();
    } catch (e) {
      if (!panel.contains(h)) return;
      const retry = el('p');
      retry.append(button('Retry', () => void load()), ' ', button('Cancel', opts.onClose));
      panel.replaceChildren(h, keep, el('p', { role: 'alert' }, `Could not load your courses: ${plainError(e)}`), retry);
    }
  };

  function draw() {
    const form = el('form', { class: 'save-form' });
    const pick = el('select', { id: 'save-course' });
    pick.append(el('option', { value: '' }, 'A new course'));
    for (const c of courses) pick.append(el('option', { value: c.id }, courseTitle(c)));
    if (courses.length) pick.value = courses[courses.length - 1].id;
    const pickLabel = el('label', { for: 'save-course' }, 'Course');
    const newBox = el('div', { class: 'new-course' });
    const name = el('input', { id: 'save-course-name', autocomplete: 'off', maxlength: '200' });
    const term = el('input', { id: 'save-term', autocomplete: 'off', maxlength: '100', placeholder: 'for example Fall 2026' });
    newBox.append(fieldP(el('label', { for: 'save-course-name' }, 'Course name'), name), fieldP(el('label', { for: 'save-term' }, 'Term (optional)'), term));
    const projectBox = el('div');
    const projName = el('input', { id: 'save-project', autocomplete: 'off', maxlength: '300', list: 'save-projects' });
    const known = el('datalist', { id: 'save-projects' });
    const hint = el('p', { class: 'help', id: 'save-hint' });
    let existing: ProjectRow[] = [];
    if (mode === 'one') {
      projName.value = items[0].name;
      projectBox.append(fieldP(el('label', { for: 'save-project' }, 'Project name'), projName), known, hint);
    } else {
      projectBox.append(el('p', {}, `Each document is saved as its own project, named by its path: ${items.map((i) => i.name).join(', ')}. A project that already has that name gets a new scan.`));
    }
    // Until the person types a name, the suggestion follows the chosen course (AC-73, AC-74).
    let typed = false;
    const suggest = () => {
      if (mode === 'one' && !typed) projName.value = suggestedProjectName(items[0].name, existing.map((p) => p.name));
    };
    const updateHint = () => {
      if (mode !== 'one') return;
      const same = existing.find((p) => p.name === projName.value.trim());
      hint.textContent = same ? `This saves a new scan of the project “${same.name}”, and shows what changed since its previous scan.` : '';
    };
    const onCourse = async () => {
      newBox.hidden = pick.value !== '';
      existing = [];
      known.replaceChildren();
      suggest();
      updateHint();
      if (!pick.value) return;
      const chosen = pick.value;
      try {
        const ps = await store.projects(chosen);
        if (pick.value !== chosen) return;
        existing = ps;
        for (const p of ps) known.append(el('option', { value: p.name }));
        suggest();
        updateHint();
      } catch {
        // The list is a convenience; saving still finds the project by name.
      }
    };
    pick.addEventListener('change', () => void onCourse());
    projName.addEventListener('input', () => {
      typed = true;
      updateHint();
    });
    const save = el('button', { type: 'submit', class: 'primary' }, mode === 'all' ? `Save ${items.length} projects` : 'Save');
    const cancel = button('Cancel', opts.onClose);
    const actions = el('p', { class: 'actions' });
    actions.append(save, ' ', cancel);
    form.append(fieldP(pickLabel, pick), newBox, projectBox, actions);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void submit();
    });
    let busy = false;
    let partial: { course: string; results: SavedResult[] } | null = null;
    const submit = async () => {
      if (busy) return;
      const newName = name.value.trim();
      if (!pick.value && !newName) {
        status.textContent = 'Give the new course a name.';
        name.focus();
        return;
      }
      const chosenName = projName.value.trim();
      if (mode === 'one' && !chosenName) {
        status.textContent = 'Give the project a name.';
        projName.focus();
        return;
      }
      busy = true;
      save.disabled = true;
      status.textContent = 'Saving…';
      try {
        const course = pick.value ? (courses.find((c) => c.id === pick.value) as CourseRow) : await store.createCourse(newName, term.value);
        if (!pick.value) {
          courses.push(course);
          const opt = el('option', { value: course.id }, courseTitle(course));
          pick.append(opt);
          pick.value = course.id;
          newBox.hidden = true;
        }
        const list = mode === 'one' ? [{ ...items[0], name: chosenName }] : items;
        // After a save that stopped part way, Save again saves only the rest (R2.1-5).
        const prior = partial && partial.course === course.id ? partial.results : [];
        const todo = list.filter((i) => !prior.some((r) => r.project.name === i.name.trim()));
        try {
          const results = [...prior, ...(await store.save(course.id, todo))];
          partial = null;
          status.replaceChildren(savedLine(results, course), ' ', link(`#/course/${course.id}`, `Open ${courseTitle(course)}`));
          opts.onSaved?.(results, course);
          void onCourse();
        } catch (e) {
          if (e instanceof SaveError) partial = { course: course.id, results: [...prior, ...e.saved] };
          const kept = partial?.results.length ?? 0;
          status.textContent = `Could not save: ${plainError(e)}. ${kept ? `${kept} of ${list.length} saved; Save again saves the rest.` : 'Try again.'}`;
        }
      } catch (e) {
        status.textContent = `Could not save: ${plainError(e)}. Try again.`;
      } finally {
        busy = false;
        save.disabled = false;
      }
    };
    // Redrawing moves the heading; a focus on it stays there.
    const focused = document.activeElement === h;
    panel.replaceChildren(h, keep, form, status);
    if (focused) h.focus();
    void onCourse();
  }

  void load();
}

function fieldP(label: HTMLElement, input: HTMLElement): HTMLElement {
  const p = el('p', { class: 'field' });
  p.append(label, ' ', input);
  return p;
}

/** "Saved “hw1” to Calculus. 1 blocker fixed and 0 new since the previous scan." */
export function savedLine(results: SavedResult[], course: CourseRow): string {
  const where = courseTitle(course);
  if (results.length === 1) {
    const r = results[0];
    if (!r.delta) return `Saved “${r.project.name}” to ${where}.`;
    return `Saved a new scan of “${r.project.name}” in ${where}. ${deltaLine(r.delta)}`;
  }
  const again = results.filter((r) => r.delta);
  const parts = [`Saved ${results.length} projects to ${where}.`];
  for (const r of again) parts.push(`${r.project.name}: ${deltaLine(r.delta as NonNullable<typeof r.delta>)}`);
  return parts.join(' ');
}
