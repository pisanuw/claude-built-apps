/**
 * The professor's side: dashboard, requests, students and notes, the request
 * link, and data. State lives in this browser (localStorage for the ledger,
 * policy and key; IndexedDB for attachments) and leaves it only as files the
 * professor downloads.
 */

import { readBackup, writeBackup } from '../core/backup';
import { fromBase64 } from '../core/codec';
import { prettyDay, relative, today } from '../core/dates';
import { demoLedger, demoPolicy } from '../core/demo';
import { buildIcs } from '../core/ics';
import {
  addNote,
  addPacket,
  addStudent,
  attachmentKey,
  coursesFor,
  deadlines,
  deadlinesCsv,
  deleteNote,
  deleteRequest,
  deleteStudent,
  emptyLedger,
  isOpen,
  markNotified,
  matchStudent,
  needsNotice,
  parseLedger,
  parseQuickNote,
  setAllStatus,
  setProgramNotes,
  setStatus,
  stats,
  student as findStudent,
  updateStudent,
  type DeadlineRow,
} from '../core/ledger';
import { mailto, statusEmail } from '../core/notify';
import { factOutline } from '../core/outline';
import { defaultPolicy, policyProblems, requestLink } from '../core/policy';
import { releaseProblems } from '../core/release';
import { checkRequest, earliestDeadline, openPacket } from '../core/request';
import { fingerprint, generateKeyPair, isSealedPacket } from '../core/seal';
import type { DocKind, Ledger, LedgerRequest, NoteTag, Policy, ProgramStatus, RequestPacket } from '../core/types';
import { DOC_LABELS, STATUS_LABELS, TAG_LABELS } from '../core/types';
import { copy, download, esc, fileBytes, plural, size, slug, store } from './dom';
import { allFiles, clearFiles, deleteFiles, getFile, putFile } from './files';
import { GUIDE_HTML } from './guide';

type Tab = 'guide' | 'dashboard' | 'requests' | 'students' | 'link' | 'data';

const K_LEDGER = 'letter-ledger';
const K_POLICY = 'letter-ledger-policy';
const K_KEY = 'letter-ledger-key';
const STATUSES: ProgramStatus[] = ['new', 'accepted', 'drafting', 'submitted', 'declined'];
const TAGS = Object.keys(TAG_LABELS) as NoteTag[];
const DOCS = Object.keys(DOC_LABELS) as DocKind[];

function linkBase(): string {
  return location.href.replace(/[?#].*$/, '');
}

function urgencyBadge(r: DeadlineRow): string {
  if (r.urgency === 'closed') return `<span class="badge">${esc(STATUS_LABELS[r.state.status])}</span>`;
  const cls = r.urgency === 'overdue' ? 'bad' : r.urgency === 'due-soon' ? 'warn' : 'ok';
  return `<span class="badge ${cls}">${esc(r.urgency === 'overdue' ? `overdue ${-r.daysLeft}d` : relative(today(), r.program.deadline))}</span>`;
}

function statusSelect(requestId: string, programId: string, status: ProgramStatus, label: string): string {
  return `<label class="sr-only" for="st-${esc(requestId)}-${esc(programId)}">${esc(label)}</label><select id="st-${esc(requestId)}-${esc(programId)}" data-status="${esc(requestId)}|${esc(programId)}">${STATUSES.map((s) => `<option value="${s}" ${s === status ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}</select>`;
}

/** Copies the attachment bytes out of a packet into IndexedDB and returns the packet without them. */
async function stashFiles(p: RequestPacket): Promise<RequestPacket> {
  for (const a of p.attachments) if (a.data) await putFile(attachmentKey(p.id, a.id), a.data);
  return { ...p, attachments: p.attachments.map(({ data: _data, ...rest }) => rest) };
}

export async function mountProfessor(root: HTMLElement): Promise<void> {
  let ledger: Ledger = parseLedger(JSON.stringify(store<Ledger>(K_LEDGER) ?? '')) ?? emptyLedger();
  let privateKey = store<JsonWebKey>(K_KEY);
  let policy: Policy = store<Policy>(K_POLICY) ?? defaultPolicy();
  if (!privateKey || !policy.publicKey) {
    const k = await generateKeyPair();
    privateKey = k.privateKey;
    policy = { ...policy, publicKey: k.publicKey };
    store(K_KEY, privateKey);
    store(K_POLICY, policy);
  }
  const fp = await fingerprint(policy.publicKey);
  let tab: Tab = ledger.requests.length || ledger.students.length ? 'dashboard' : 'guide';
  let selReq: string | null = null;
  let selStudent: string | null = null;
  let showClosed = false;
  let outlineFor: string | null = null;
  let message = '';
  let error = '';

  const save = (l: Ledger) => {
    ledger = l;
    store(K_LEDGER, l);
  };
  const savePolicy = (p: Policy) => {
    policy = p;
    store(K_POLICY, p);
  };
  const say = (msg: string, isError = false) => {
    message = isError ? '' : msg;
    error = isError ? msg : '';
  };
  const day = () => today();
  const req = (id: string | null) => ledger.requests.find((r) => r.packet.id === id);

  root.innerHTML = `
    <header class="top">
      <div class="title-row"><h1>Letter Ledger</h1><hw-theme-toggle></hw-theme-toggle></div>
      <p class="lede">Recommendation letters without the inbox: one request link with your policy and a FERPA release, a deadline dashboard, notes you keep on students during the term, and a fact outline when it is time to write. Everything stays in this browser.</p>
    </header>
    <section class="card demo-bar" aria-labelledby="demo-h">
      <div>
        <h2 id="demo-h">New here? Load the demo ledger</h2>
        <p class="small muted">Six invented students for Prof. Jordan Rivera: an overdue letter, two due this week, one declined, one submitted, and a student with notes but no request yet.</p>
      </div>
      <button class="primary" id="demo">Load demo</button>
    </section>
    <nav class="tabs" role="tablist" aria-label="Sections">
      <button role="tab" data-tab="guide">How it works</button>
      <button role="tab" data-tab="dashboard">Dashboard</button>
      <button role="tab" data-tab="requests">Requests</button>
      <button role="tab" data-tab="students">Students and notes</button>
      <button role="tab" data-tab="link">Your request link</button>
      <button role="tab" data-tab="data">Data and backup</button>
    </nav>
    <div id="msg" role="status" aria-live="polite"></div>
    <div id="panel"></div>`;
  const panel = root.querySelector<HTMLElement>('#panel')!;

  root.querySelector('.tabs')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-tab]');
    if (!b) return;
    go(b.dataset.tab as Tab);
  });

  function go(t: Tab, msg = '') {
    tab = t;
    say(msg);
    render();
  }

  root.querySelector('#demo')!.addEventListener('click', async () => {
    if ((ledger.requests.length || ledger.students.length) && !confirm('Replace your ledger with the demo? Download a backup first (Data and backup) if you want to keep it.')) return;
    const keepPolicy = !!policy.professor.trim();
    const pol = keepPolicy ? policy : demoPolicy(policy.publicKey);
    const demo = await demoLedger(demoPolicy(policy.publicKey), day());
    await clearFiles();
    const requests: LedgerRequest[] = [];
    for (const r of demo.requests) requests.push({ ...r, packet: await stashFiles(r.packet) });
    save({ ...demo, requests });
    if (!keepPolicy) savePolicy(pol);
    selReq = null;
    selStudent = null;
    go('dashboard', `Demo loaded: ${plural(demo.students.length, 'student')}, ${plural(demo.requests.length, 'request')}.${keepPolicy ? ' Your own request link settings were kept.' : ' The request link now uses Prof. Rivera\'s demo policy; edit it under "Your request link".'} Open "How it works" for a tour.`);
  });

  function render() {
    for (const b of root.querySelectorAll<HTMLButtonElement>('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    root.querySelector('#msg')!.innerHTML = error ? `<p class="notice bad">${esc(error)}</p>` : message ? `<p class="notice">${esc(message)}</p>` : '';
    if (tab === 'guide') renderGuide();
    else if (tab === 'dashboard') renderDashboard();
    else if (tab === 'requests') renderRequests();
    else if (tab === 'students') renderStudents();
    else if (tab === 'link') renderLink();
    else renderData();
  }

  // ---------- Guide ----------

  function renderGuide() {
    panel.innerHTML = GUIDE_HTML;
  }

  // Guide buttons are the only [data-goto] and #guide-demo elements, so one listener covers every render.
  panel.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-goto]');
    if (b) go(b.dataset.goto as Tab);
    if ((e.target as HTMLElement).closest('#guide-demo')) root.querySelector<HTMLButtonElement>('#demo')!.click();
  });

  // ---------- Packet import ----------

  async function importFiles(list: FileList | File[]) {
    const added: string[] = [];
    const problems: string[] = [];
    for (const f of list) {
      try {
        const bytes = await fileBytes(f);
        if (!isSealedPacket(bytes)) throw new Error('not a request file (.ledger)');
        const opened = await openPacket(privateKey!, bytes);
        const res = addPacket(ledger, await stashFiles(opened), day());
        if (res.status === 'duplicate') {
          problems.push(`${f.name}: already filed (${opened.student.name}).`);
          continue;
        }
        save(res.ledger);
        selReq = opened.id;
        const first = earliestDeadline(opened);
        added.push(`${opened.student.name} (${plural(opened.programs.length, 'program')}${first ? `, first due ${prettyDay(first)}` : ''})`);
      } catch (err) {
        problems.push(`${f.name}: ${(err as Error).message}`);
      }
    }
    say([added.length ? `Filed ${added.join('; ')}.` : '', ...problems].filter(Boolean).join(' '), !added.length);
    if (added.length === 1) tab = 'requests';
    render();
  }

  function importBox(): string {
    return `<section class="card drop" id="drop" aria-labelledby="imp-h">
      <h2 id="imp-h">Add request files</h2>
      <p class="small muted">Students email you a <code>.ledger</code> file from your request link. Drop the files here or pick them; each opens with the key in this browser (fingerprint <code>${esc(fp)}</code>).</p>
      <label for="packets" class="sr-only">Request files</label>
      <input id="packets" type="file" multiple accept=".ledger,application/octet-stream">
    </section>`;
  }

  function bindImport() {
    const drop = panel.querySelector<HTMLElement>('#drop');
    if (!drop) return;
    panel.querySelector<HTMLInputElement>('#packets')!.addEventListener('change', (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files?.length) void importFiles([...files]);
    });
    drop.addEventListener('dragover', (e) => {
      e.preventDefault();
      drop.classList.add('over');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('over');
      if (e.dataTransfer?.files.length) void importFiles([...e.dataTransfer.files]);
    });
  }

  function bindStatusSelects() {
    for (const sel of panel.querySelectorAll<HTMLSelectElement>('[data-status]')) {
      sel.addEventListener('change', () => {
        const [rid, pid] = sel.dataset.status!.split('|') as [string, string];
        save(setStatus(ledger, rid, pid, sel.value as ProgramStatus, day()));
        const r = req(rid)!;
        say(`${r.packet.student.name}, ${r.packet.programs.find((p) => p.id === pid)?.name}: ${STATUS_LABELS[sel.value as ProgramStatus]}. Send a status update from the request when you are ready.`);
        render();
      });
    }
    for (const b of panel.querySelectorAll<HTMLButtonElement>('[data-open]')) {
      b.addEventListener('click', () => {
        selReq = b.dataset.open!;
        outlineFor = null;
        go('requests');
      });
    }
  }

  // ---------- Dashboard ----------

  function renderDashboard() {
    const t = day();
    const s = stats(ledger, t);
    const rows = deadlines(ledger, t).filter((r) => showClosed || r.urgency !== 'closed');
    const notice = ledger.requests.filter(needsNotice);
    const tile = (n: number, label: string, cls = '') => `<div class="tile ${cls}"><b>${n}</b><span>${esc(label)}</span></div>`;
    panel.innerHTML = `
      <section class="tiles" aria-label="Summary">
        ${tile(s.open, 'open letters')}
        ${tile(s.dueSoon, 'due in 7 days', s.dueSoon ? 'warn' : '')}
        ${tile(s.overdue, 'overdue', s.overdue ? 'bad' : '')}
        ${tile(s.newRequests, 'requests to decide', s.newRequests ? 'warn' : '')}
        ${tile(s.submitted, 'submitted')}
      </section>
      ${importBox()}
      ${notice.length ? `<section class="card"><h2>Students waiting for a status update</h2><ul>${notice.map((r) => `<li><button class="linkish" data-open="${esc(r.packet.id)}">${esc(r.packet.student.name)}</button></li>`).join('')}</ul></section>` : ''}
      <section class="card">
        <div class="row between">
          <h2>Deadlines</h2>
          <div class="row">
            <label class="check"><input type="checkbox" id="closed" ${showClosed ? 'checked' : ''}> Show submitted and declined</label>
            <button id="ics" ${s.open ? '' : 'disabled'}>Calendar reminders (.ics)</button>
            <button id="csv" ${ledger.requests.length ? '' : 'disabled'}>Spreadsheet (.csv)</button>
          </div>
        </div>
        ${
          rows.length
            ? `<div class="table-wrap"><table>
          <thead><tr><th scope="col">Due</th><th scope="col">Student</th><th scope="col">Program</th><th scope="col">Submit via</th><th scope="col">Status</th></tr></thead>
          <tbody>${rows
            .map(
              (r) => `<tr class="u-${r.urgency}">
            <td><span class="nowrap">${esc(prettyDay(r.program.deadline))}</span> ${urgencyBadge(r)}</td>
            <td><button class="linkish" data-open="${esc(r.request.packet.id)}">${esc(r.student?.name ?? r.request.packet.student.name)}</button></td>
            <td>${esc(r.program.name)}${r.program.kind ? ` <span class="muted small">${esc(r.program.kind)}</span>` : ''}</td>
            <td class="small">${r.program.url ? `<a href="${esc(r.program.url)}" target="_blank" rel="noopener noreferrer">${esc(r.program.method || 'link')}</a>` : esc(r.program.method)}</td>
            <td>${statusSelect(r.request.packet.id, r.program.id, r.state.status, `Status for ${r.request.packet.student.name}, ${r.program.name}`)}</td>
          </tr>`,
            )
            .join('')}</tbody></table></div>`
            : `<p class="muted">${ledger.requests.length ? 'No open letters. Tick "Show submitted and declined" to see the rest.' : 'No requests yet. Share your request link (see "Your request link"), or load the demo.'}</p>`
        }
        <p class="small muted">The calendar file has one all-day event per open letter with alarms 7 days, 2 days and the day before at 9am. Import it again after changes; events update in place.</p>
      </section>`;
    bindImport();
    bindStatusSelects();
    panel.querySelector('#closed')!.addEventListener('change', (e) => {
      showClosed = (e.target as HTMLInputElement).checked;
      render();
    });
    panel.querySelector('#ics')!.addEventListener('click', () => download(`letter-deadlines-${t}.ics`, buildIcs(deadlines(ledger, t), new Date()), 'text/calendar'));
    panel.querySelector('#csv')!.addEventListener('click', () => download(`letter-deadlines-${t}.csv`, deadlinesCsv(ledger, t), 'text/csv'));
  }

  // ---------- Requests ----------

  function requestSummary(r: LedgerRequest): string {
    const counts = STATUSES.map((s) => [s, Object.values(r.programs).filter((p) => p.status === s).length] as const).filter(([, n]) => n);
    return counts.map(([s, n]) => `${n} ${STATUS_LABELS[s].toLowerCase()}`).join(', ');
  }

  function renderRequests() {
    const list = [...ledger.requests].sort((a, b) => (earliestOpen(a) ?? '9999') < (earliestOpen(b) ?? '9999') ? -1 : 1);
    if (!selReq || !req(selReq)) selReq = list[0]?.packet.id ?? null;
    panel.innerHTML = `
      ${list.length ? '' : importBox()}
      <div class="split">
        <section class="card list" aria-labelledby="rl-h">
          <h2 id="rl-h">Requests (${list.length})</h2>
          ${list.length ? `<ul class="picklist">${list.map((r) => `<li><button class="pick ${r.packet.id === selReq ? 'on' : ''}" data-pick="${esc(r.packet.id)}" aria-current="${r.packet.id === selReq}"><b>${esc(r.packet.student.name)}</b><span class="small muted">${esc(requestSummary(r))}${earliestOpen(r) ? ` · next ${esc(prettyDay(earliestOpen(r)!))}` : ''}</span></button></li>`).join('')}</ul>` : '<p class="muted">None yet.</p>'}
        </section>
        <div id="detail">${selReq ? requestDetail(req(selReq)!) : ''}</div>
      </div>`;
    bindImport();
    for (const b of panel.querySelectorAll<HTMLButtonElement>('[data-pick]')) {
      b.addEventListener('click', () => {
        selReq = b.dataset.pick!;
        outlineFor = null;
        render();
        panel.querySelector<HTMLElement>('#detail h2')?.focus();
      });
    }
    if (selReq) bindRequest(req(selReq)!);
  }

  function earliestOpen(r: LedgerRequest): string | null {
    return r.packet.programs.filter((p) => isOpen(r.programs[p.id]?.status ?? 'new')).map((p) => p.deadline).sort()[0] ?? null;
  }

  function requestDetail(r: LedgerRequest): string {
    const pk = r.packet;
    const s = findStudent(ledger, r.studentId);
    const issues = checkRequest(policy, pk, r.receivedOn);
    const t = day();
    return `<section class="card">
      <h2 tabindex="-1">${esc(pk.student.name)}</h2>
      <p class="small muted">${esc(pk.student.email)}${pk.student.pronouns ? ` · ${esc(pk.student.pronouns)}` : ''}${pk.student.studentId ? ` · #${esc(pk.student.studentId)}` : ''} · requested ${esc(prettyDay(pk.createdAt.slice(0, 10)))}, filed ${esc(prettyDay(r.receivedOn))}</p>
      <div class="row">
        <button data-all="accepted">Accept all</button>
        <button data-all="declined">Decline all</button>
        <button class="primary" id="notify">${needsNotice(r) ? 'Email status update' : 'Email status'}</button>
        <button id="outline">Fact outline</button>
        <button id="to-student">Notes on ${esc(pk.student.name.split(' ')[0] ?? '')} (${s?.notes.length ?? 0})</button>
      </div>
      <div id="email-box"></div>
      ${issues.length ? `<div class="notice warn"><b>Against your policy (as of the request date):</b><ul>${issues.map((i) => `<li>${esc(i.message)}</li>`).join('')}</ul></div>` : '<p><span class="badge ok">meets your policy</span></p>'}
      <div id="release-check"><p class="small muted">Checking the FERPA release...</p></div>

      <h3>Programs</h3>
      <div class="table-wrap"><table>
        <thead><tr><th scope="col">Program</th><th scope="col">Due</th><th scope="col">Status</th></tr></thead>
        <tbody>${pk.programs
          .map((p) => {
            const st = r.programs[p.id] ?? { status: 'new' as const, notes: '' };
            return `<tr><td><b>${esc(p.name)}</b>${p.kind ? ` <span class="muted small">${esc(p.kind)}</span>` : ''}
              <div class="small">${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.method || 'link')}</a>` : esc(p.method)}</div>
              ${p.tailoring ? `<div class="small"><span class="muted">Student:</span> ${esc(p.tailoring)}</div>` : ''}
              <label class="small" for="pn-${esc(p.id)}">Your notes for this program</label>
              <textarea id="pn-${esc(p.id)}" rows="1" data-pnote="${esc(p.id)}">${esc(st.notes)}</textarea></td>
              <td class="nowrap">${esc(prettyDay(p.deadline))}<br><span class="small muted">${esc(relative(t, p.deadline))}</span>${st.submittedOn ? `<br><span class="small">sent ${esc(prettyDay(st.submittedOn))}</span>` : ''}</td>
              <td>${statusSelect(pk.id, p.id, st.status, `Status for ${p.name}`)}</td></tr>`;
          })
          .join('')}</tbody>
      </table></div>

      <div class="two">
        <div>
          <h3>How they know you</h3>
          <p>${esc(pk.student.howKnown) || '<span class="muted">(not given)</span>'}</p>
          <h3>Courses</h3>
          <ul>${pk.courses.map((c) => `<li>${esc([c.code, c.title].filter(Boolean).join(' '))}, ${esc(c.term)}${c.role && c.role !== 'student' ? `, ${esc(c.role)}` : ''}${c.grade ? `, <b>${esc(c.grade)}</b>` : ''}</li>`).join('')}</ul>
        </div>
        <div>
          <h3>Documents</h3>
          <ul class="files">${pk.attachments.map((a) => `<li><span class="badge">${esc(DOC_LABELS[a.kind])}</span> <button class="linkish" data-file="${esc(a.id)}">${esc(a.name)}</button> <span class="small muted">${size(a.size)}</span></li>`).join('') || '<li class="muted">None attached.</li>'}</ul>
        </div>
      </div>
      <h3>What they want the letter to say</h3>
      ${pk.questions.map((q, i) => (q.trim() ? `<p><b>${esc(q)}</b><br>${esc(pk.answers[i] ?? '') || '<span class="muted">(blank)</span>'}</p>` : '')).join('')}
      ${pk.highlights ? `<p><b>Also highlight:</b> ${esc(pk.highlights)}</p>` : ''}
      <div id="outline-box"></div>
      <p class="row"><button class="danger" id="del-req">Delete this request</button></p>
    </section>`;
  }

  function bindRequest(r: LedgerRequest) {
    const pk = r.packet;
    bindStatusSelects();
    void releaseProblems(pk).then((probs) => {
      const box = panel.querySelector('#release-check');
      if (!box) return;
      const rel = pk.release;
      box.innerHTML = `<details class="${probs.length ? 'notice bad' : ''}"><summary>${probs.length ? `<b>FERPA release: ${plural(probs.length, 'problem')}</b>` : '<span class="badge ok">FERPA release signed</span>'} ${esc(rel.signature)}, ${esc(prettyDay(rel.signedAt.slice(0, 10)))}; ${rel.waive ? 'right to read waived' : '<b>right to read not waived</b>'}${rel.scope.includes('grades') ? '' : '; <b>grades not released</b>'}</summary>
        ${probs.length ? `<ul>${probs.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
        <pre class="release">${esc(rel.text)}</pre><p class="small muted">SHA-256 ${esc(rel.textHash)}</p></details>`;
    });
    for (const b of panel.querySelectorAll<HTMLButtonElement>('[data-all]')) {
      b.addEventListener('click', () => {
        save(setAllStatus(ledger, pk.id, b.dataset.all as ProgramStatus, day()));
        say(`${pk.student.name}: every open program set to ${STATUS_LABELS[b.dataset.all as ProgramStatus].toLowerCase()}. Send the status update next.`);
        render();
      });
    }
    for (const ta of panel.querySelectorAll<HTMLTextAreaElement>('[data-pnote]')) {
      ta.addEventListener('change', () => save(setProgramNotes(ledger, pk.id, ta.dataset.pnote!, ta.value)));
    }
    panel.querySelector('#to-student')!.addEventListener('click', () => {
      selStudent = r.studentId;
      go('students');
    });
    panel.querySelector('#notify')!.addEventListener('click', () => {
      const e = statusEmail(policy, req(pk.id)!);
      panel.querySelector('#email-box')!.innerHTML = `<div class="notice">
        <p><b>To:</b> ${esc(e.to)}<br><b>Subject:</b> ${esc(e.subject)}</p>
        <pre class="release">${esc(e.body)}</pre>
        <div class="row"><a class="button primary" id="mail" href="${esc(mailto(e))}">Open in your mail app</a><button id="copy-mail">Copy text</button></div>
        <p class="small muted">Opening or copying marks the student as told, so they leave the "waiting for an update" list.</p></div>`;
      const done = () => {
        save(markNotified(ledger, pk.id));
        say(`Marked ${pk.student.name} as told.`);
        root.querySelector('#msg')!.innerHTML = `<p class="notice">${esc(message)}</p>`;
      };
      panel.querySelector('#mail')!.addEventListener('click', done);
      panel.querySelector('#copy-mail')!.addEventListener('click', async () => {
        if (await copy(`To: ${e.to}\nSubject: ${e.subject}\n\n${e.body}`)) done();
      });
    });
    panel.querySelector('#outline')!.addEventListener('click', () => {
      outlineFor = pk.id;
      void showOutline(pk, pk.programs.map((p) => p.id));
    });
    if (outlineFor === pk.id) void showOutline(pk, pk.programs.map((p) => p.id));
    for (const b of panel.querySelectorAll<HTMLButtonElement>('[data-file]')) {
      b.addEventListener('click', async () => {
        const a = pk.attachments.find((x) => x.id === b.dataset.file)!;
        const data = (await getFile(attachmentKey(pk.id, a.id))) ?? a.data;
        if (!data) return say(`${a.name} is missing from this browser's file store. Restore a backup or ask the student to resend.`, true), render();
        download(a.name, fromBase64(data), a.type || 'application/octet-stream');
      });
    }
    panel.querySelector('#del-req')!.addEventListener('click', async () => {
      if (!confirm(`Delete ${pk.student.name}'s request and its documents? Your notes on the student are kept.`)) return;
      await deleteFiles(pk.attachments.map((a) => attachmentKey(pk.id, a.id)));
      save(deleteRequest(ledger, pk.id));
      selReq = null;
      go('requests', `Deleted the request from ${pk.student.name}.`);
    });
  }

  async function showOutline(pk: RequestPacket, ids: string[]) {
    const box = panel.querySelector<HTMLElement>('#outline-box');
    if (!box) return;
    const md = factOutline(ledger, pk.id, { programIds: ids, today: day(), releaseProblems: await releaseProblems(pk) });
    box.innerHTML = `<section class="outline" aria-labelledby="ol-h">
      <h3 id="ol-h">Fact outline</h3>
      <fieldset class="plain"><legend class="label">Programs in this letter</legend>
        ${pk.programs.map((p) => `<label class="check"><input type="checkbox" data-olp="${esc(p.id)}" ${ids.includes(p.id) ? 'checked' : ''}> ${esc(p.name)}</label>`).join('')}
      </fieldset>
      <pre class="md" tabindex="0" aria-label="Outline in Markdown">${esc(md)}</pre>
      <div class="row"><button class="primary" id="ol-dl">Download .md</button><button id="ol-copy">Copy</button></div>
      <p class="small muted">Built only from what you and the student recorded; no text is generated and none of it is sent anywhere. Grades appear only when the release covers them.</p>
    </section>`;
    for (const c of box.querySelectorAll<HTMLInputElement>('[data-olp]')) {
      c.addEventListener('change', () => {
        const next = [...box.querySelectorAll<HTMLInputElement>('[data-olp]')].filter((x) => x.checked).map((x) => x.dataset.olp!);
        void showOutline(pk, next);
      });
    }
    box.querySelector('#ol-dl')!.addEventListener('click', () => download(`letter-outline-${slug(pk.student.name)}.md`, md, 'text/markdown'));
    box.querySelector('#ol-copy')!.addEventListener('click', async () => {
      const ok = await copy(md);
      box.querySelector<HTMLButtonElement>('#ol-copy')!.textContent = ok ? 'Copied' : 'Copy failed';
    });
    box.scrollIntoView({ block: 'nearest' });
  }

  // ---------- Students ----------

  function renderStudents() {
    const students = [...ledger.students].sort((a, b) => a.name.localeCompare(b.name));
    if (selStudent && !findStudent(ledger, selStudent)) selStudent = null;
    panel.innerHTML = `
      <section class="card">
        <h2>Quick note</h2>
        <form id="quick" class="row">
          <label for="q" class="sr-only">Quick note</label>
          <input id="q" class="grow" placeholder="Maya Okafor: great question in office hours on hashing #oh" autocomplete="off">
          <button class="primary" type="submit">Add note</button>
        </form>
        <p class="small muted">Name or email, a colon, then the note. Optional tag: #class, #oh, #project, #research, #ta. Dated today. Capture it while you remember it; the outline uses it months later.</p>
        <div id="quick-msg" role="status"></div>
      </section>
      <div class="split">
        <section class="card list" aria-labelledby="sl-h">
          <h2 id="sl-h">Students (${students.length})</h2>
          <label for="filter" class="sr-only">Filter students</label>
          <input id="filter" placeholder="Filter by name or email" autocomplete="off">
          <ul class="picklist" id="slist">${students
            .map((s) => {
              const n = ledger.requests.filter((r) => r.studentId === s.id).length;
              return `<li data-name="${esc(`${s.name} ${s.email}`.toLowerCase())}"><button class="pick ${s.id === selStudent ? 'on' : ''}" data-stu="${esc(s.id)}" aria-current="${s.id === selStudent}"><b>${esc(s.name)}</b><span class="small muted">${plural(s.notes.length, 'note')}${n ? `, ${plural(n, 'request')}` : ''}</span></button></li>`;
            })
            .join('')}</ul>
          <form id="add-stu">
            <h3>Add a student</h3>
            <div class="field"><label for="ns-name">Name</label><input id="ns-name" required autocomplete="off"></div>
            <div class="field"><label for="ns-email">Email (matches their future request)</label><input id="ns-email" type="email" autocomplete="off"></div>
            <button type="submit">Add</button>
          </form>
        </section>
        <div id="sdetail">${selStudent ? studentDetail(selStudent) : '<section class="card"><p class="muted">Pick a student, or add one. Students who send a request are added automatically and matched by email.</p></section>'}</div>
      </div>`;
    panel.querySelector('#filter')!.addEventListener('input', (e) => {
      const q = (e.target as HTMLInputElement).value.trim().toLowerCase();
      for (const li of panel.querySelectorAll<HTMLElement>('#slist li')) li.hidden = !!q && !li.dataset.name!.includes(q);
    });
    for (const b of panel.querySelectorAll<HTMLButtonElement>('[data-stu]')) {
      b.addEventListener('click', () => {
        selStudent = b.dataset.stu!;
        render();
        panel.querySelector<HTMLElement>('#sdetail h2')?.focus();
      });
    }
    panel.querySelector('#add-stu')!.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = panel.querySelector<HTMLInputElement>('#ns-name')!.value.trim();
      if (!name) return;
      const res = addStudent(ledger, name, panel.querySelector<HTMLInputElement>('#ns-email')!.value);
      save(res.ledger);
      selStudent = res.student.id;
      say(res.student.name === name ? `Added ${name}.` : `That email already belongs to ${res.student.name}.`);
      render();
    });
    panel.querySelector('#quick')!.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = panel.querySelector<HTMLInputElement>('#q')!;
      const out = panel.querySelector<HTMLElement>('#quick-msg')!;
      const parsed = parseQuickNote(input.value);
      if (!parsed) {
        out.innerHTML = '<p class="small bad">Write it as <code>Name: note</code>.</p>';
        return;
      }
      const s = matchStudent(ledger, parsed.who);
      const add = (sid: string, name: string) => {
        save(addNote(ledger, sid, { date: day(), tag: parsed.tag ?? 'class', course: '', text: parsed.text }));
        selStudent = sid;
        say(`Note added for ${name}.`);
        render();
        panel.querySelector<HTMLInputElement>('#q')!.focus();
      };
      if (s) return add(s.id, s.name);
      out.innerHTML = `<p class="small">No single student matches "${esc(parsed.who)}". <button type="button" class="linkish" id="q-new">Add ${esc(parsed.who)} as a new student with this note</button></p>`;
      out.querySelector('#q-new')!.addEventListener('click', () => {
        const email = parsed.who.includes('@') ? parsed.who : '';
        const res = addStudent(ledger, email ? parsed.who.split('@')[0]! : parsed.who, email);
        save(res.ledger);
        add(res.student.id, res.student.name);
      });
    });
    if (selStudent) bindStudent(selStudent);
  }

  function studentDetail(id: string): string {
    const s = findStudent(ledger, id)!;
    const reqs = ledger.requests.filter((r) => r.studentId === id);
    const courses = coursesFor(ledger, id);
    return `<section class="card">
      <h2 tabindex="-1">${esc(s.name)}</h2>
      <div class="grid">
        <div class="field"><label for="sd-name">Name</label><input id="sd-name" value="${esc(s.name)}"></div>
        <div class="field"><label for="sd-email">Email</label><input id="sd-email" type="email" value="${esc(s.email)}"></div>
      </div>
      <h3>Notes (${s.notes.length})</h3>
      ${s.notes.length ? `<ol class="timeline">${[...s.notes].reverse().map((n) => `<li><span class="when">${esc(prettyDay(n.date))}</span> <span class="badge">${esc(TAG_LABELS[n.tag])}</span>${n.course ? ` <span class="small muted">${esc(n.course)}</span>` : ''}<p>${esc(n.text)}</p><button class="linkish small" data-del-note="${esc(n.id)}" aria-label="Delete note from ${esc(prettyDay(n.date))}">Delete</button></li>`).join('')}</ol>` : '<p class="muted">No notes yet.</p>'}
      <form id="add-note" class="noteform">
        <div class="field"><label for="nn-date">Date</label><input id="nn-date" type="date" value="${day()}" required></div>
        <div class="field"><label for="nn-tag">Where</label><select id="nn-tag">${TAGS.map((t) => `<option value="${t}">${esc(TAG_LABELS[t])}</option>`).join('')}</select></div>
        <div class="field"><label for="nn-course">Course (optional)</label><input id="nn-course" list="course-list" placeholder="CS 143"></div>
        <div class="field wide"><label for="nn-text">What happened</label><textarea id="nn-text" rows="2" required placeholder="Specific is better: what they asked, built or explained, and why it stood out."></textarea></div>
        <button class="primary" type="submit">Add note</button>
      </form>
      <datalist id="course-list">${[...new Set(courses.map((c) => c.code).filter(Boolean))].map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
      <h3>Courses</h3>
      ${courses.length ? `<ul>${courses.map((c) => `<li>${esc([c.code, c.title].filter(Boolean).join(' '))}, ${esc(c.term)}${c.role && c.role !== 'student' ? `, ${esc(c.role)}` : ''}${c.grade ? `, ${esc(c.grade)}` : ''}</li>`).join('')}</ul>` : '<p class="muted">None recorded.</p>'}
      <form id="add-course" class="noteform">
        <div class="field"><label for="nc-code">Course</label><input id="nc-code" required placeholder="CS 143"></div>
        <div class="field"><label for="nc-term">Term</label><input id="nc-term" required placeholder="Fall 2026"></div>
        <div class="field"><label for="nc-grade">Grade (optional)</label><input id="nc-grade"></div>
        <div class="field"><label for="nc-role">Role</label><select id="nc-role">${['student', 'TA', 'research assistant', 'grader'].map((r) => `<option>${r}</option>`).join('')}</select></div>
        <button type="submit">Add course</button>
      </form>
      <h3>Requests</h3>
      ${reqs.length ? `<ul>${reqs.map((r) => `<li><button class="linkish" data-open="${esc(r.packet.id)}">${esc(prettyDay(r.packet.createdAt.slice(0, 10)))}: ${esc(r.packet.programs.map((p) => p.name).join('; '))}</button></li>`).join('')}</ul>` : '<p class="muted">No request yet. When they use your link with this email, it is filed here with these notes.</p>'}
      <p class="row"><button class="danger" id="del-stu">Delete ${esc(s.name)} and all their data</button></p>
      <p class="small muted">Use this for a deletion request: it removes the student, every note, every request and its documents from this browser. Backups you downloaded earlier are not affected.</p>
    </section>`;
  }

  function bindStudent(id: string) {
    bindStatusSelects();
    const s = findStudent(ledger, id)!;
    panel.querySelector('#sd-name')!.addEventListener('change', (e) => {
      const v = (e.target as HTMLInputElement).value.trim();
      if (v) save(updateStudent(ledger, id, { name: v }));
      render();
    });
    panel.querySelector('#sd-email')!.addEventListener('change', (e) => {
      save(updateStudent(ledger, id, { email: (e.target as HTMLInputElement).value.trim() }));
    });
    panel.querySelector('#add-note')!.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = (sel: string) => panel.querySelector<HTMLInputElement>(sel)!.value;
      save(addNote(ledger, id, { date: v('#nn-date') || day(), tag: v('#nn-tag') as NoteTag, course: v('#nn-course').trim(), text: v('#nn-text') }));
      say(`Note added for ${s.name}.`);
      render();
      panel.querySelector<HTMLTextAreaElement>('#nn-text')!.focus();
    });
    panel.querySelector('#add-course')!.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = (sel: string) => panel.querySelector<HTMLInputElement>(sel)!.value.trim();
      save(updateStudent(ledger, id, { courses: [...s.courses, { code: v('#nc-code'), title: '', term: v('#nc-term'), grade: v('#nc-grade'), role: v('#nc-role') }] }));
      render();
    });
    for (const b of panel.querySelectorAll<HTMLButtonElement>('[data-del-note]')) {
      b.addEventListener('click', () => {
        save(deleteNote(ledger, id, b.dataset.delNote!));
        render();
      });
    }
    panel.querySelector('#del-stu')!.addEventListener('click', async () => {
      if (!confirm(`Delete ${s.name}, ${plural(s.notes.length, 'note')} and every request and document from them? This cannot be undone.`)) return;
      const res = deleteStudent(ledger, id);
      await deleteFiles(res.attachmentKeys);
      save(res.ledger);
      selStudent = null;
      go('students', `Deleted ${s.name} and all their data from this browser.`);
    });
  }

  // ---------- Request link ----------

  function renderLink() {
    const p = policy;
    const problems = policyProblems(p);
    const link = requestLink(linkBase(), p);
    panel.innerHTML = `
      <section class="card">
        <h2>Your request link</h2>
        ${problems.length ? `<div class="notice warn"><ul>${problems.map((x) => `<li>${esc(x.message)}</li>`).join('')}</ul></div>` : ''}
        <label for="link">Share this on your web page, syllabus or in a reply to request emails</label>
        <div class="row"><input id="link" class="grow mono" readonly value="${esc(link)}"><button class="primary" id="copy-link">Copy</button><a class="button" href="${esc(link)}" target="_blank" rel="noopener">Preview as a student</a></div>
        <p class="small muted">The policy below travels inside the link (after <code>#</code>, which browsers never send to a server), together with your public key (fingerprint <code>${esc(fp)}</code>). Students' files are encrypted to that key, so only this browser, or one you restore a backup into, can open them. Links you shared before an edit keep working with the old wording.</p>
      </section>
      <form class="card" id="policy">
        <h2>Policy</h2>
        <div class="grid">
          <div class="field"><label for="pp-professor">Your name, as students see it</label><input id="pp-professor" value="${esc(p.professor)}" placeholder="Prof. Jordan Rivera"></div>
          <div class="field"><label for="pp-title">Title (optional)</label><input id="pp-title" value="${esc(p.title)}"></div>
          <div class="field"><label for="pp-institution">Institution</label><input id="pp-institution" value="${esc(p.institution)}"></div>
          <div class="field"><label for="pp-email">Email for request files</label><input id="pp-email" type="email" value="${esc(p.email)}"></div>
          <div class="field"><label for="pp-leadDays">Notice required (days before first deadline)</label><input id="pp-leadDays" type="number" min="0" max="120" value="${p.leadDays}"></div>
          <div class="field"><label for="pp-maxPrograms">Most programs per request</label><input id="pp-maxPrograms" type="number" min="1" max="40" value="${p.maxPrograms}"></div>
          <div class="field"><label for="pp-minGrade">Minimum grade (optional)</label><input id="pp-minGrade" value="${esc(p.minGrade)}" placeholder="A- or 3.7"></div>
          <div class="field"><label for="pp-minCourses">Courses at that grade</label><input id="pp-minCourses" type="number" min="0" max="10" value="${p.minCourses}"></div>
        </div>
        <fieldset class="plain"><legend class="label">Required documents</legend>
          ${DOCS.map((k) => `<label class="check"><input type="checkbox" data-doc="${k}" ${p.requiredDocs.includes(k) ? 'checked' : ''}> ${esc(DOC_LABELS[k])}</label>`).join('')}
        </fieldset>
        <div class="field"><label for="pp-conditions">Your conditions, shown before the form</label><textarea id="pp-conditions" rows="3" placeholder="I write for students who took at least one course with me...">${esc(p.conditions)}</textarea></div>
        <div class="field"><label for="pp-questions">Questions for the student, one per line</label><textarea id="pp-questions" rows="3" aria-describedby="pp-q-h">${esc(p.questions.join('\n'))}</textarea><p class="hint" id="pp-q-h">Each line becomes a required box; end a line with "(optional)" to make it optional.</p></div>
        <button class="primary" type="submit">Save policy and update link</button>
      </form>`;
    panel.querySelector('#copy-link')!.addEventListener('click', async () => {
      const ok = await copy(link);
      panel.querySelector<HTMLButtonElement>('#copy-link')!.textContent = ok ? 'Copied' : 'Select and copy';
    });
    panel.querySelector('#policy')!.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = (id: string) => panel.querySelector<HTMLInputElement>(`#pp-${id}`)!.value;
      const next: Policy = {
        ...policy,
        professor: v('professor').trim(),
        title: v('title').trim(),
        institution: v('institution').trim(),
        email: v('email').trim(),
        leadDays: Number(v('leadDays')),
        maxPrograms: Number(v('maxPrograms')),
        minGrade: v('minGrade').trim(),
        minCourses: Number(v('minCourses')),
        requiredDocs: DOCS.filter((k) => panel.querySelector<HTMLInputElement>(`[data-doc="${k}"]`)!.checked),
        conditions: v('conditions').trim(),
        questions: v('questions').split('\n').map((q) => q.trim()).filter(Boolean),
      };
      const probs = policyProblems(next);
      if (probs.length) return say(probs.map((x) => x.message).join(' '), true), render();
      savePolicy(next);
      go('link', 'Policy saved; the link above now carries it.');
    });
  }

  // ---------- Data ----------

  function renderData() {
    const nFiles = ledger.requests.reduce((n, r) => n + r.packet.attachments.length, 0);
    panel.innerHTML = `
      <section class="card">
        <h2>What is stored here</h2>
        <p>${plural(ledger.students.length, 'student')}, ${plural(ledger.students.reduce((n, s) => n + s.notes.length, 0), 'note')}, ${plural(ledger.requests.length, 'request')} and ${plural(nFiles, 'document')}, plus your policy and private key, all in this browser's storage for this site. Nothing is on a server. Clearing site data erases it, so keep a backup.</p>
      </section>
      <form class="card" id="backup">
        <h2>Download a backup</h2>
        <p class="small muted">One file with everything, including the private key that opens request files. With a passphrase it is encrypted (AES-256-GCM, key from PBKDF2 with 600,000 rounds); without one it is plain JSON.</p>
        <div class="grid">
          <div class="field"><label for="bp1">Passphrase (recommended)</label><input id="bp1" type="password" autocomplete="new-password"></div>
          <div class="field"><label for="bp2">Repeat passphrase</label><input id="bp2" type="password" autocomplete="new-password"></div>
        </div>
        <button class="primary" type="submit">Download backup</button>
      </form>
      <form class="card" id="restore">
        <h2>Restore a backup</h2>
        <p class="small muted">Replaces everything in this browser, including the key, so request links you shared from the backed-up browser work here.</p>
        <div class="grid">
          <div class="field"><label for="rf">Backup file</label><input id="rf" type="file" required accept=".json,.llbackup,application/json,application/octet-stream"></div>
          <div class="field"><label for="rp">Passphrase (if it has one)</label><input id="rp" type="password" autocomplete="current-password"></div>
        </div>
        <button type="submit">Restore</button>
      </form>
      <section class="card">
        <h2>Start over</h2>
        <p class="small muted">Erases students, notes, requests and documents. Your policy and key stay, so your request link keeps working.</p>
        <button class="danger" id="erase">Erase the ledger</button>
      </section>`;
    panel.querySelector('#backup')!.addEventListener('submit', async (e) => {
      e.preventDefault();
      const a = panel.querySelector<HTMLInputElement>('#bp1')!.value;
      if (a !== panel.querySelector<HTMLInputElement>('#bp2')!.value) return say('The passphrases do not match.', true), render();
      if (!a && !confirm('Download without a passphrase? Anyone with the file can read every request and open new ones sent to your link.')) return;
      const btn = panel.querySelector<HTMLButtonElement>('#backup button')!;
      btn.disabled = true;
      btn.textContent = 'Preparing...';
      const bytes = await writeBackup({ exportedAt: new Date().toISOString(), policy, privateKey, ledger, files: await allFiles() }, a);
      download(`letter-ledger-backup-${day()}.${a ? 'llbackup' : 'json'}`, bytes, a ? 'application/octet-stream' : 'application/json');
      go('data', `Backup downloaded (${size(bytes.length)}${a ? ', encrypted' : ', not encrypted'}).`);
    });
    panel.querySelector('#restore')!.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = panel.querySelector<HTMLInputElement>('#rf')!.files?.[0];
      if (!f) return;
      try {
        const b = await readBackup(await fileBytes(f), panel.querySelector<HTMLInputElement>('#rp')!.value);
        if (!confirm(`Replace everything here with the backup from ${prettyDay(b.exportedAt.slice(0, 10))} (${plural(b.ledger.requests.length, 'request')}, ${plural(b.ledger.students.length, 'student')})?`)) return;
        await clearFiles();
        for (const [k, v] of Object.entries(b.files)) await putFile(k, v);
        save(b.ledger);
        if (b.privateKey) store(K_KEY, b.privateKey);
        savePolicy(b.policy);
        location.reload();
      } catch (err) {
        say((err as Error).message, true);
        render();
      }
    });
    panel.querySelector('#erase')!.addEventListener('click', async () => {
      if (!confirm('Erase every student, note, request and document in this browser?')) return;
      await clearFiles();
      save(emptyLedger());
      selReq = selStudent = null;
      go('data', 'Ledger erased.');
    });
  }

  render();
}
