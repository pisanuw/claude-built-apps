/**
 * The student's side: the form behind a professor's request link. Nothing is
 * uploaded anywhere. The finished request (answers, documents, signed FERPA
 * release) is sealed to the professor's public key and downloaded as one file
 * the student emails to the professor. A draft without the documents is kept
 * in this browser so a reload loses nothing typed.
 */

import { newId, toBase64 } from '../core/codec';
import { daysBetween, prettyDay, today } from '../core/dates';
import { checkRequest, hasErrors, isOptional, MAX_FILE_BYTES, packetFileName, sealPacket, type Issue } from '../core/request';
import { buildRelease, releaseText } from '../core/release';
import { fingerprint } from '../core/seal';
import type { Attachment, CourseTaken, DocKind, Policy, Program, ReleaseScope, RequestPacket } from '../core/types';
import { DOC_LABELS, SCOPE_LABELS } from '../core/types';
import { download, esc, fileBytes, plural, size, store } from './dom';
import { mailto } from '../core/notify';

interface Draft {
  student: RequestPacket['student'];
  programs: Program[];
  courses: CourseTaken[];
  highlights: string;
  answers: string[];
  scope: ReleaseScope[];
  waive: boolean;
  consent: boolean;
  signature: string;
}

const ROLES = ['student', 'TA', 'research assistant', 'grader', 'other'];
const SCOPES: ReleaseScope[] = ['grades', 'performance', 'conduct', 'transcript'];
const DOC_KINDS: DocKind[] = ['cv', 'statement', 'transcript', 'photo', 'other'];

const blankProgram = (): Program => ({ id: newId(), name: '', kind: '', url: '', deadline: '', method: '', tailoring: '' });
const blankCourse = (): CourseTaken => ({ code: '', title: '', term: '', grade: '', role: 'student' });

function emptyDraft(p: Policy): Draft {
  return {
    student: { name: '', email: '', studentId: '', pronouns: '', howKnown: '' },
    programs: [blankProgram()],
    courses: [blankCourse()],
    highlights: '',
    answers: p.questions.map(() => ''),
    scope: ['grades', 'performance', 'conduct'],
    waive: true,
    consent: false,
    signature: '',
  };
}

export function mountStudent(root: HTMLElement, policy: Policy | null): void {
  if (!policy) {
    root.innerHTML = `<header class="top"><div class="title-row"><h1>This request link is damaged</h1><hw-theme-toggle></hw-theme-toggle></div></header><section class="card"><p>The link may have been cut off when it was copied. Ask your professor to send it again, or copy the whole address including everything after <code>#ask=</code>.</p></section>`;
    return;
  }
  const p = policy;
  const draftKey = `letter-ledger-draft-${p.publicKey.slice(0, 16)}`;
  const saved = store<Draft>(draftKey);
  const d: Draft = saved && Array.isArray(saved.programs) ? { ...emptyDraft(p), ...saved, answers: p.questions.map((_, i) => saved.answers?.[i] ?? '') } : emptyDraft(p);
  const files: Attachment[] = [];
  let warnedOnce = false;
  const day = today();
  const who = p.professor || 'your professor';

  const save = () => store(draftKey, d);

  root.innerHTML = `
    <header class="top">
      <div class="title-row"><h1>Letter request for ${esc(who)}</h1><hw-theme-toggle></hw-theme-toggle></div>
      <p class="lede">${esc([p.title, p.institution].filter(Boolean).join(', '))}</p>
    </header>
    <section class="card" aria-labelledby="before-h">
      <h2 id="before-h">Before you start</h2>
      ${p.conditions.trim() ? `<p class="pre">${esc(p.conditions)}</p>` : ''}
      <ul>
        <li>Ask at least <b>${plural(p.leadDays, 'day')}</b> before your first deadline; list up to <b>${plural(p.maxPrograms, 'program')}</b> in one request.</li>
        ${p.minGrade.trim() && p.minCourses > 0 ? `<li>I usually write for students with ${plural(p.minCourses, 'course')} at <b>${esc(p.minGrade)}</b> or better with me.</li>` : ''}
        <li>Required documents: ${p.requiredDocs.length ? p.requiredDocs.map((k) => esc(DOC_LABELS[k])).join('; ') : 'none'}.</li>
        <li>You will sign a FERPA release so I can discuss your records. Without it I can only confirm that you took my course.</li>
      </ul>
      <p class="small muted">Privacy: this form runs in your browser. When you finish, it makes one encrypted file that only ${esc(who)} can open (key <code id="fp">...</code>), and you email that file. Nothing is uploaded. Your typing is saved in this browser as a draft; attached files are not.</p>
    </section>
    <div id="summary" tabindex="-1"></div>
    <form id="req" novalidate>
      <fieldset class="card">
        <legend><h2>About you</h2></legend>
        <div class="grid">
          ${field('name', 'Full name', `<input id="f-name" data-k="student.name" autocomplete="name" aria-required="true" value="${esc(d.student.name)}">`)}
          ${field('email', 'Email', `<input id="f-email" type="email" data-k="student.email" autocomplete="email" aria-required="true" value="${esc(d.student.email)}">`)}
          ${field('studentId', 'Student number (optional)', `<input id="f-studentId" data-k="student.studentId" value="${esc(d.student.studentId)}">`)}
          ${field('pronouns', 'Pronouns for the letter (optional)', `<input id="f-pronouns" data-k="student.pronouns" placeholder="she/her, he/him, they/them" value="${esc(d.student.pronouns)}">`)}
        </div>
        ${field('howKnown', 'How do I know you?', `<textarea id="f-howKnown" data-k="student.howKnown" rows="2" aria-required="true" aria-describedby="h-howKnown" placeholder="Took CS 143 in Fall 2025, came to office hours about the hashing assignment, TA for CS 142.">${esc(d.student.howKnown)}</textarea>`, 'A sentence or two in your own words. Mention anything that will help me place you.')}
      </fieldset>

      <fieldset class="card" id="f-courses" tabindex="-1">
        <legend><h2>Courses with me</h2></legend>
        <p class="small muted">Every course you took with me, or worked in as a TA or researcher.</p>
        <div id="courses"></div>
        <button type="button" id="add-course">Add a course</button>
      </fieldset>

      <fieldset class="card" id="f-programs" tabindex="-1">
        <legend><h2>Programs</h2></legend>
        <p class="small muted">One entry per program or position that needs a letter. Use the <b>letter</b> deadline, which is sometimes earlier than the application deadline.</p>
        <div id="programs"></div>
        <button type="button" id="add-program">Add a program</button>
      </fieldset>

      <fieldset class="card" id="f-docs" tabindex="-1">
        <legend><h2>Documents</h2></legend>
        <p class="small muted">PDF preferred, ${size(MAX_FILE_BYTES)} at most per file. They are only read on this device and sealed into your request file.</p>
        <div class="grid" id="doc-inputs">
          ${DOC_KINDS.map((k) => {
            const req = p.requiredDocs.includes(k);
            return field(`doc-${k}`, `${DOC_LABELS[k]}${req ? '' : ' (optional)'}`, `<input id="f-doc-${k}" type="file" data-doc="${k}" ${k === 'other' ? 'multiple' : ''} ${req ? 'aria-required="true"' : ''} accept="${k === 'photo' ? 'image/*' : '.pdf,.doc,.docx,.txt,.md,.rtf,image/*'}">`);
          }).join('')}
        </div>
        <ul id="file-list" class="files"></ul>
      </fieldset>

      <fieldset class="card">
        <legend><h2>What should the letter say?</h2></legend>
        ${p.questions
          .map((q, i) => (q.trim() ? field(`answer-${i}`, q, `<textarea id="f-answer-${i}" data-k="answers.${i}" rows="3" ${isOptional(q) ? '' : 'aria-required="true"'}>${esc(d.answers[i] ?? '')}</textarea>`) : ''))
          .join('')}
        ${field('highlights', 'Anything else you would like me to highlight (optional)', `<textarea id="f-highlights" data-k="highlights" rows="2">${esc(d.highlights)}</textarea>`)}
      </fieldset>

      <fieldset class="card" id="f-release" tabindex="-1">
        <legend><h2>FERPA release</h2></legend>
        <p class="small muted">The Family Educational Rights and Privacy Act lets me share information from your education records only with your signed consent. Choose what the letter may discuss.</p>
        <fieldset class="plain">
          <legend class="label">The letter may discuss</legend>
          ${SCOPES.map((s) => `<label class="check"><input type="checkbox" data-scope="${s}" ${d.scope.includes(s) ? 'checked' : ''}> ${esc(SCOPE_LABELS[s])}</label>`).join('')}
        </fieldset>
        <fieldset class="plain">
          <legend class="label">Your right to read the letter</legend>
          <label class="check"><input type="radio" name="waive" value="yes" ${d.waive ? 'checked' : ''}> I waive my right to read it (most programs expect this)</label>
          <label class="check"><input type="radio" name="waive" value="no" ${d.waive ? '' : 'checked'}> I keep my right to read it</label>
        </fieldset>
        <p class="label" id="rt-label">The release you are signing</p>
        <pre class="release" id="release-text" aria-labelledby="rt-label" tabindex="0"></pre>
        <label class="check"><input type="checkbox" id="f-consent" ${d.consent ? 'checked' : ''}> I have read this release and I consent to it.</label>
        ${field('signature', 'Sign by typing your full name', `<input id="f-signature" data-k="signature" autocomplete="off" aria-required="true" value="${esc(d.signature)}">`)}
      </fieldset>

      <div class="card row">
        <button class="primary" type="submit" id="make">Create my request file</button>
        <button type="button" id="clear">Start over</button>
        <span class="small muted">Files are sealed in this browser; nothing is sent until you email the file yourself.</span>
      </div>
    </form>
    <div id="done"></div>`;

  void fingerprint(p.publicKey).then((f) => (root.querySelector('#fp')!.textContent = f));
  const form = root.querySelector<HTMLFormElement>('#req')!;

  function renderCourses() {
    root.querySelector('#courses')!.innerHTML = d.courses
      .map(
        (c, i) => `<div class="rowset" role="group" aria-label="Course ${i + 1}">
        ${field(`course-${i}-code`, 'Course', `<input id="f-course-${i}-code" data-k="courses.${i}.code" placeholder="CS 143" value="${esc(c.code)}">`)}
        ${field(`course-${i}-title`, 'Title (optional)', `<input id="f-course-${i}-title" data-k="courses.${i}.title" placeholder="Data Structures" value="${esc(c.title)}">`)}
        ${field(`course-${i}-term`, 'Term', `<input id="f-course-${i}-term" data-k="courses.${i}.term" placeholder="Fall 2025" value="${esc(c.term)}">`)}
        ${field(`course-${i}-grade`, 'Grade (optional)', `<input id="f-course-${i}-grade" data-k="courses.${i}.grade" placeholder="A- or 3.7" value="${esc(c.grade)}">`)}
        ${field(`course-${i}-role`, 'Role', `<select id="f-course-${i}-role" data-k="courses.${i}.role">${ROLES.map((r) => `<option ${r === c.role ? 'selected' : ''}>${r}</option>`).join('')}</select>`)}
        ${d.courses.length > 1 ? `<button type="button" class="linkish" data-del-course="${i}" aria-label="Remove course ${i + 1}">Remove</button>` : ''}
      </div>`,
      )
      .join('');
  }

  function renderPrograms() {
    root.querySelector('#programs')!.innerHTML = d.programs
      .map((g, i) => {
        const left = g.deadline ? daysBetween(day, g.deadline) : null;
        const note = left === null ? '' : left < 0 ? 'already passed' : left < p.leadDays ? `${plural(left, 'day')} away, under the ${p.leadDays}-day notice` : `${plural(left, 'day')} away`;
        return `<div class="rowset program" role="group" aria-label="Program ${i + 1}">
        ${field(`program-${i}-name`, 'Program or position', `<input id="f-program-${i}-name" data-k="programs.${i}.name" placeholder="University of X, PhD in Computer Science" value="${esc(g.name)}">`)}
        ${field(`program-${i}-kind`, 'Type (optional)', `<input id="f-program-${i}-kind" data-k="programs.${i}.kind" list="kinds" placeholder="PhD" value="${esc(g.kind)}">`)}
        ${field(`program-${i}-deadline`, 'Letter deadline', `<input id="f-program-${i}-deadline" type="date" data-k="programs.${i}.deadline" min="${day}" value="${esc(g.deadline)}" aria-describedby="h-program-${i}-deadline">`, note)}
        ${field(`program-${i}-method`, 'How the letter is submitted', `<input id="f-program-${i}-method" data-k="programs.${i}.method" list="methods" placeholder="Portal emails a link" value="${esc(g.method)}">`)}
        ${field(`program-${i}-url`, 'Program link (optional)', `<input id="f-program-${i}-url" type="url" data-k="programs.${i}.url" placeholder="https://" value="${esc(g.url)}">`)}
        <div class="wide">${field(`program-${i}-tailoring`, 'Why this program, or what it looks for (optional)', `<textarea id="f-program-${i}-tailoring" data-k="programs.${i}.tailoring" rows="2">${esc(g.tailoring)}</textarea>`)}</div>
        ${d.programs.length > 1 ? `<button type="button" class="linkish" data-del-program="${i}" aria-label="Remove program ${i + 1}">Remove</button>` : ''}
      </div>`;
      })
      .join('') +
      `<datalist id="kinds">${['PhD', 'MS', 'MBA', 'Medical school', 'Law school', 'Internship', 'Job', 'Scholarship', 'Fellowship', 'Study abroad'].map((k) => `<option value="${k}">`).join('')}</datalist>
       <datalist id="methods">${['Portal emails me a link', 'Email the letter to the program', 'Interfolio', 'Paper form', 'Common App'].map((k) => `<option value="${k}">`).join('')}</datalist>`;
  }

  function renderFiles() {
    root.querySelector('#file-list')!.innerHTML = files.length
      ? files.map((f, i) => `<li><span class="badge">${esc(DOC_LABELS[f.kind])}</span> ${esc(f.name)} <span class="muted small">${size(f.size)}</span> <button type="button" class="linkish" data-del-file="${i}" aria-label="Remove ${esc(f.name)}">Remove</button></li>`).join('')
      : '<li class="muted small">No files attached yet.</li>';
  }

  function renderRelease() {
    const named = d.programs.filter((g) => g.name.trim());
    root.querySelector('#release-text')!.textContent = releaseText(p, { student: d.student.name, programs: named, scope: d.scope, waive: d.waive, date: day });
  }

  function setPath(path: string, value: string) {
    const parts = path.split('.');
    let o: Record<string, unknown> = d as unknown as Record<string, unknown>;
    for (const k of parts.slice(0, -1)) o = o[k] as Record<string, unknown>;
    o[parts.at(-1)!] = value;
  }

  form.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.k) {
      setPath(t.dataset.k, t.value);
      if (/^programs\.\d+\.deadline$/.test(t.dataset.k)) {
        const i = Number(t.dataset.k.split('.')[1]);
        const left = t.value ? daysBetween(day, t.value) : null;
        const hint = root.querySelector(`#h-program-${i}-deadline`);
        if (hint) hint.textContent = left === null ? '' : left < 0 ? 'already passed' : left < p.leadDays ? `${plural(left, 'day')} away, under the ${p.leadDays}-day notice` : `${plural(left, 'day')} away`;
      }
    } else if (t.dataset.scope) {
      const s = t.dataset.scope as ReleaseScope;
      d.scope = t.checked ? SCOPES.filter((x) => x === s || d.scope.includes(x)) : d.scope.filter((x) => x !== s);
    } else if (t.name === 'waive') d.waive = t.value === 'yes';
    else if (t.id === 'f-consent') d.consent = t.checked;
    warnedOnce = false;
    renderRelease();
    save();
  });

  form.addEventListener('change', async (e) => {
    const t = e.target as HTMLInputElement;
    if (!t.dataset.doc || !t.files?.length) return;
    const kind = t.dataset.doc as DocKind;
    if (kind !== 'other') for (let i = files.length - 1; i >= 0; i--) if (files[i]!.kind === kind) files.splice(i, 1);
    for (const f of t.files) files.push({ id: newId(), kind, name: f.name, type: f.type || 'application/octet-stream', size: f.size, data: f.size <= MAX_FILE_BYTES ? toBase64(await fileBytes(f)) : '' });
    t.value = '';
    renderFiles();
  });

  form.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b) return;
    if (b.id === 'add-course') {
      d.courses.push(blankCourse());
      renderCourses();
      root.querySelector<HTMLInputElement>(`#f-course-${d.courses.length - 1}-code`)!.focus();
    } else if (b.id === 'add-program') {
      if (d.programs.length >= p.maxPrograms) {
        showSummary([{ level: 'error', field: 'programs', message: `${who} writes for at most ${plural(p.maxPrograms, 'program')} per request.` }]);
        return;
      }
      d.programs.push(blankProgram());
      renderPrograms();
      root.querySelector<HTMLInputElement>(`#f-program-${d.programs.length - 1}-name`)!.focus();
    } else if (b.dataset.delCourse) {
      d.courses.splice(Number(b.dataset.delCourse), 1);
      renderCourses();
      root.querySelector<HTMLButtonElement>('#add-course')!.focus();
    } else if (b.dataset.delProgram) {
      d.programs.splice(Number(b.dataset.delProgram), 1);
      renderPrograms();
      root.querySelector<HTMLButtonElement>('#add-program')!.focus();
    } else if (b.dataset.delFile) {
      files.splice(Number(b.dataset.delFile), 1);
      renderFiles();
    } else if (b.id === 'clear') {
      if (!confirm('Clear everything you typed on this form?')) return;
      store(draftKey, null);
      location.reload();
      return;
    } else return;
    renderRelease();
    save();
  });

  function showSummary(issues: Issue[]) {
    for (const el of form.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
    const box = root.querySelector<HTMLElement>('#summary')!;
    if (!issues.length) {
      box.innerHTML = '';
      return;
    }
    const errors = issues.filter((i) => i.level === 'error');
    const warns = issues.filter((i) => i.level === 'warn');
    for (const i of errors) form.querySelector(`#f-${i.field}`)?.setAttribute('aria-invalid', 'true');
    const li = (i: Issue) => `<li><a href="#f-${esc(i.field)}" data-focus="f-${esc(i.field)}">${esc(i.message)}</a></li>`;
    box.innerHTML = `<section class="card ${errors.length ? 'error-box' : 'warn-box'}" role="alert">
      ${errors.length ? `<h2>Please fix ${plural(errors.length, 'thing')} before creating the file</h2><ul>${errors.map(li).join('')}</ul>` : ''}
      ${warns.length ? `<h2>${errors.length ? 'Also note' : 'Before you send'}</h2><ul>${warns.map(li).join('')}</ul>${errors.length ? '' : '<p>Press <b>Create my request file</b> again to go ahead anyway.</p>'}` : ''}
    </section>`;
    box.focus();
  }

  root.querySelector('#summary')!.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('[data-focus]');
    if (!a) return;
    e.preventDefault();
    const el = root.querySelector<HTMLElement>(`#${a.dataset.focus}`);
    el?.scrollIntoView({ block: 'center' });
    el?.focus();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const now = new Date().toISOString();
    const programs = d.programs.map((g) => ({ ...g, name: g.name.trim() }));
    const release = await buildRelease(p, { student: d.student.name, programs, scope: d.scope, waive: d.waive, date: day }, d.signature, d.consent, now);
    const packet: RequestPacket = {
      v: 1,
      id: newId(),
      createdAt: now,
      student: { ...d.student, name: d.student.name.trim(), email: d.student.email.trim() },
      programs,
      courses: d.courses,
      highlights: d.highlights,
      answers: d.answers,
      attachments: files.map((f) => ({ ...f })),
      release,
      questions: p.questions,
    };
    const issues = checkRequest(p, packet, day);
    if (hasErrors(issues) || (issues.length && !warnedOnce)) {
      warnedOnce = !hasErrors(issues);
      showSummary(issues);
      return;
    }
    showSummary([]);
    const btn = root.querySelector<HTMLButtonElement>('#make')!;
    btn.disabled = true;
    btn.textContent = 'Sealing...';
    try {
      const sealed = await sealPacket(p.publicKey, packet);
      const name = packetFileName(packet);
      download(name, sealed, 'application/octet-stream');
      const first = programs.map((g) => g.deadline).sort()[0]!;
      const email = {
        to: p.email,
        subject: `Letter of recommendation request: ${packet.student.name}`,
        body: `Dear ${who},\n\nI would be grateful if you would write a letter of recommendation for me. My request file (${name}) is attached; it lists ${plural(programs.length, 'program')}, my documents and my signed FERPA release. The first deadline is ${prettyDay(first)}.\n\nThank you,\n${packet.student.name}`,
      };
      root.querySelector('#done')!.innerHTML = `<section class="card ok-box" tabindex="-1" id="done-card">
        <h2>Your request file is ready</h2>
        <p>Your browser downloaded <b>${esc(name)}</b> (${size(sealed.length)}). It is encrypted so only ${esc(who)} can open it.</p>
        <ol>
          <li>${p.email ? `Email it to <b>${esc(p.email)}</b>. <a class="button primary" href="${esc(mailto(email))}">Open an email draft</a> (then attach the file; browsers cannot attach it for you).` : 'Email it to your professor as an attachment.'}</li>
          <li>Keep the file until you hear back. If it gets lost, press the button below to download it again.</li>
        </ol>
        <p class="row"><button type="button" id="again">Download the file again</button></p>
        <p class="small muted">You listed ${plural(programs.length, 'program')}, the first due ${prettyDay(first)}, and ${plural(files.length, 'document')}. You will get status updates by email from ${esc(who)}.</p>
      </section>`;
      root.querySelector('#again')!.addEventListener('click', () => download(name, sealed, 'application/octet-stream'));
      root.querySelector<HTMLElement>('#done-card')!.focus();
    } catch (err) {
      showSummary([{ level: 'error', field: 'release', message: `Could not seal the file: ${(err as Error).message}` }]);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Create my request file';
    }
  });

  renderCourses();
  renderPrograms();
  renderFiles();
  renderRelease();
}

function field(id: string, label: string, control: string, hint = ''): string {
  return `<div class="field"><label for="f-${id}">${esc(label)}</label>${control}${hint || control.includes(`h-${id}`) ? `<p class="hint" id="h-${id}">${esc(hint)}</p>` : ''}</div>`;
}
