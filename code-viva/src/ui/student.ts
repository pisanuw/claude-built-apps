import { encodeResponse, vivaId } from '../core/pack';
import { Session, type Step } from '../core/session';
import type { Viva } from '../core/types';
import { clock, codeBlock, copy, download, esc, prose, store } from './dom';

const KIND_LABEL: Record<string, string> = {
  trace: 'Walk-through',
  edge: 'Edge case',
  design: 'Design choice',
  recursion: 'Recursion',
  naming: 'Naming',
  commit: 'How you built it',
  scale: 'Running time',
  spec: 'Requirement',
};

interface Saved {
  started?: number;
  restarts?: number;
  response?: string;
}

export function mountStudent(root: HTMLElement, viva: Viva | null): void {
  if (!viva) {
    root.innerHTML = `<main class="student card"><header class="top"><div class="title-row"><h1>Code Viva</h1><hw-theme-toggle></hw-theme-toggle></div></header><p class="notice bad" role="alert">This link is damaged or incomplete. Ask your instructor for a fresh link, and copy the whole thing.</p></main>`;
    return;
  }
  const id = vivaId(viva);
  const key = `code-viva-session-${id}`;
  const saved: Saved = store<Saved>(key) ?? {};
  const limit = viva.minutes * Math.max(1, viva.timeMultiplier);

  const finished = (code: string) => {
    store<Saved>(key, { ...saved, response: code });
    window.onbeforeunload = null;
    root.innerHTML = `
      <main class="student">
        <header class="top"><hw-theme-toggle></hw-theme-toggle></header>
        <section class="card">
          <h1 tabindex="-1" id="done-h">Finished. Send this code to your instructor.</h1>
          <p>Your answers are in the response code below. Nothing has been sent anywhere yet: paste it into the assignment's submission box or an email, as your instructor asked. You can also download it as a file.</p>
          <label for="code">Response code</label>
          <textarea id="code" rows="6" readonly>${esc(code)}</textarea>
          <div class="row" style="margin-top:8px">
            <button class="primary" id="copy">Copy code</button>
            <button id="dl">Download as .txt</button>
            <span id="copied" class="muted small" role="status"></span>
          </div>
          <p class="hint">This page remembers the code in this browser, so reopening your link shows it again.</p>
        </section>
      </main>`;
    root.querySelector<HTMLHeadingElement>('#done-h')!.focus();
    root.querySelector('#copy')!.addEventListener('click', async () => {
      const ok = await copy(code);
      root.querySelector('#copied')!.textContent = ok ? 'Copied.' : 'Copy failed: select the text and copy it by hand.';
      if (!ok) root.querySelector<HTMLTextAreaElement>('#code')!.select();
    });
    root.querySelector('#dl')!.addEventListener('click', () => download(`code-viva-${viva.submissionId}.txt`, `${code}\n`));
  };

  if (saved.response) {
    finished(saved.response);
    return;
  }

  root.innerHTML = `
    <main class="student">
      <header class="top"><div class="title-row"><h1>Code Viva</h1><hw-theme-toggle></hw-theme-toggle></div><span class="muted">${esc(viva.course)} ${viva.course && viva.assignment ? '·' : ''} ${esc(viva.assignment)}</span></header>
      <section class="card">
        <h2>Hi ${esc(viva.student)}</h2>
        <p>This is a short written check that you understand the code you submitted. There are <b>${viva.questions.length} questions</b>, each about your own functions, variable names or commits. Your code is shown next to each question.</p>
        <ul>
          <li>You have <b>${Math.round(limit)} minutes</b> in total${viva.timeMultiplier > 1 ? ` (includes your extended time of ${viva.timeMultiplier}x)` : ''}. The timer starts when you press Start.</li>
          <li>Answer in your own words, as you would out loud. Short, specific answers that name your variables and lines are better than long general ones.</li>
          <li>If an answer is vague you may get up to ${viva.maxFollowUps} follow-up question${viva.maxFollowUps === 1 ? '' : 's'}. You cannot go back to an earlier question.</li>
          <li>Pasted text, time per answer and switching away from this window are recorded for your instructor. Your instructor reviews every answer; nothing is graded automatically.</li>
        </ul>
        ${saved.started ? `<p class="notice bad" role="alert">You started this session on ${esc(new Date(saved.started).toLocaleString())} and it was interrupted. Starting again gives you a fresh timer, and your instructor will see that the session was restarted.</p>` : ''}
        <button class="primary" id="start">Start (${Math.round(limit)} minutes)</button>
      </section>
    </main>`;
  root.querySelector('#start')!.addEventListener('click', () => run());

  function run() {
    const restarts = (saved.restarts ?? 0) + (saved.started ? 1 : 0);
    store<Saved>(key, { started: Date.now(), restarts });
    const s = new Session(viva!, () => Date.now(), restarts);
    let pasted = 0;
    window.onbeforeunload = () => 'Leaving restarts your session.';
    const onBlur = () => s.blur();
    window.addEventListener('blur', onBlur);

    root.innerHTML = `
      <main class="student">
        <header class="top"><hw-theme-toggle></hw-theme-toggle></header>
        <section class="card">
          <div class="row" style="justify-content:space-between">
            <span id="where" class="muted"></span>
            <span><span class="sr-only">Time left</span><span class="timer" id="timer" aria-hidden="true"></span></span>
          </div>
          <div class="progress" aria-hidden="true"><span id="bar"></span></div>
          <p id="timer-sr" class="sr-only" role="status"></p>
          <div id="q" style="margin-top:12px"></div>
          <label for="answer" style="margin-top:12px">Your answer</label>
          <textarea id="answer" rows="7" aria-describedby="answer-hint"></textarea>
          <p class="hint" id="answer-hint">Ctrl+Enter (or Cmd+Enter) submits. Name the functions, variables and lines you mean.</p>
          <div class="row" style="margin-top:8px">
            <button class="primary" id="submit">Submit answer</button>
            <button id="skip">Skip this question</button>
            <span style="flex:1"></span>
            <button id="finish">Finish now</button>
          </div>
        </section>
      </main>`;
    const answer = root.querySelector<HTMLTextAreaElement>('#answer')!;
    answer.addEventListener('paste', (e) => {
      pasted += e.clipboardData?.getData('text').length ?? 0;
    });

    const end = () => {
      clearInterval(timer);
      window.removeEventListener('blur', onBlur);
      finished(encodeResponse(s.transcript()));
    };

    const show = (step: Step) => {
      if (step.kind === 'done') return end();
      const q = step.question;
      root.querySelector('#where')!.textContent = `Question ${step.index + 1} of ${viva!.questions.length}${step.kind === 'followup' ? `, follow-up ${step.followUps}` : ''}`;
      root.querySelector<HTMLElement>('#bar')!.style.width = `${(100 * step.index) / viva!.questions.length}%`;
      root.querySelector('#q')!.innerHTML = `
        <span class="badge kind">${esc(KIND_LABEL[q.kind] ?? q.kind)}</span>
        <h2 tabindex="-1" id="prompt" style="margin-top:6px">${prose(step.kind === 'followup' ? q.prompt : step.prompt)}</h2>
        ${step.kind === 'followup' ? `<p class="notice" role="status"><b>Follow-up:</b> ${prose(step.prompt)}</p>` : ''}
        ${q.anchor ? codeBlock(q.anchor) : ''}`;
      answer.value = '';
      pasted = 0;
      if (step.kind === 'followup') answer.focus();
      else root.querySelector<HTMLElement>('#prompt')!.focus();
    };

    const submit = () => {
      if (!answer.value.trim()) {
        answer.focus();
        return;
      }
      show(s.answer(answer.value, pasted));
    };
    root.querySelector('#submit')!.addEventListener('click', submit);
    answer.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        submit();
      }
    });
    root.querySelector('#skip')!.addEventListener('click', () => {
      if (answer.value.trim()) s.answer(answer.value, pasted);
      show(s.done ? { kind: 'done' } : s.skip());
    });
    root.querySelector('#finish')!.addEventListener('click', () => {
      if (!confirm('Finish now? Unanswered questions stay unanswered.')) return;
      if (answer.value.trim()) s.answer(answer.value, pasted);
      s.finish();
      end();
    });

    let lastMinute = -1;
    const paint = () => {
      if (s.tick()) return end();
      const left = s.remainingMs();
      const el = root.querySelector('#timer')!;
      el.textContent = clock(left);
      el.classList.toggle('low', left < 120_000);
      const minute = Math.ceil(left / 60_000);
      if (minute !== lastMinute && (minute <= 5 || minute % 5 === 0)) {
        lastMinute = minute;
        root.querySelector('#timer-sr')!.textContent = `${minute} minute${minute === 1 ? '' : 's'} left.`;
      }
    };
    const timer = setInterval(paint, 500);
    paint();
    show(s.current());
  }
}
