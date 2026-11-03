// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, type App, type MountOptions } from '../src/ui/app';
import { serializeProject } from '../src/core/project';
import { sampleProject } from '../src/core/sample';

const flush = () => new Promise((r) => setTimeout(r, 0));
const text = (el: ParentNode) => el.textContent ?? '';
const byText = (el: ParentNode, label: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.textContent === label);
const click = (el: ParentNode, label: string, i = 0) => {
  const b = byText(el, label)[i];
  if (!b) throw new Error(`no button "${label}"`);
  b.click();
};
const $ = <T extends Element = HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;
function setValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, v: string, ev = 'change'): void {
  el.value = v;
  el.dispatchEvent(new Event(ev));
}
function setFile(input: HTMLInputElement, name: string, body: string): void {
  const file = { name, text: () => Promise.resolve(body) } as unknown as File;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
}

describe('ui', () => {
  let root: HTMLElement;
  let opts: MountOptions;
  let app: App;
  let confirmAnswer: boolean;
  let copied: string[];
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app') as HTMLElement;
    confirmAnswer = true;
    copied = [];
    opts = {
      now: () => new Date('2026-11-03T12:00:00Z'),
      confirm: () => confirmAnswer,
      copy: async (t) => void copied.push(t),
      makeDocx: async () => new Blob(['docx']),
    };
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    app = mount(root, opts);
  });

  const status = () => text($(root, '.status'));

  it('starts on Comments with five tabs and points empty tabs back', () => {
    expect($(root, 'h1').textContent).toBe('Dossier Comment Reflector');
    expect([...root.querySelectorAll('[role="tab"]')].map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false', 'false']);
    expect(text(root)).toContain('No comments yet');
    for (const id of ['themes', 'changes', 'quotes', 'reflection'] as const) {
      app.openTab(id);
      expect(text($(root, '#panel'))).toContain('Add comments on the Comments tab first');
    }
    click(root, 'Go to Comments');
    expect($(root, '#tab-comments').getAttribute('aria-selected')).toBe('true');
  });

  it('moves between tabs with the arrow keys', () => {
    const key = (k: string) => $(root, '[aria-selected="true"]').dispatchEvent(new KeyboardEvent('keydown', { key: k }));
    key('ArrowRight');
    expect($(root, '#tab-themes').getAttribute('aria-selected')).toBe('true');
    key('ArrowLeft');
    key('ArrowLeft');
    expect($(root, '#tab-reflection').getAttribute('aria-selected')).toBe('true');
    key('Home');
    expect($(root, '#tab-comments').getAttribute('aria-selected')).toBe('true');
    key('End');
    expect($(root, '#tab-reflection').getAttribute('aria-selected')).toBe('true');
    key('x');
    $(root, '#tab-quotes').click();
    expect($(root, '#tab-quotes').getAttribute('aria-selected')).toBe('true');
  });

  it('adds pasted comments for a course and term, and removes them', () => {
    click(root, 'Add these comments');
    expect(status()).toContain('Fill in the course and the term');
    setValue($(root, '#paste-course'), 'BIO 101');
    setValue($(root, '#paste-term'), 'Fall 2024');
    setValue($(root, '#paste-text'), 'N/A');
    click(root, 'Add these comments');
    expect(status()).toBe('No comments found to add.');
    setValue($(root, '#paste-course'), 'BIO 101');
    setValue($(root, '#paste-term'), 'Fall 2024');
    setValue($(root, '#paste-text'), '1. The exams were unfair\n2. Great labs, really fun\n3. N/A');
    click(root, 'Add these comments');
    expect(status()).toBe('Added 2 comments from BIO 101, Fall 2024 (skipped 1 empty answer like "N/A").');
    expect(text($(root, '#batches'))).toContain('Pasted text');
    expect(app.project().comments).toHaveLength(2);
    click(root, 'Remove');
    expect(app.project().comments).toHaveLength(0);
    expect(status()).toContain('Removed 2 comments');
  });

  it('maps CSV columns and imports a file', async () => {
    setFile($(root, '#csv-file'), 'empty.csv', 'Only a header\n');
    await flush();
    expect(status()).toContain('has no rows');
    setFile($(root, '#csv-file'), 'evals.csv', 'Course,Term,Rating,What helped you learn?\nCS 1,Fall 2024,5,The quizzes were fair and kept me on track\nCS 1,,4,Office hours were great and very helpful\n');
    await flush();
    expect(status()).toContain('Read 2 rows from evals.csv');
    const mapping = $(root, '#csv-mapping');
    expect(($(mapping, '#col-3') as HTMLInputElement).checked).toBe(true);
    expect(($(mapping, '#csv-course-col') as HTMLSelectElement).value).toBe('0');
    ($(mapping, '#col-3') as HTMLInputElement).checked = false;
    click(mapping, 'Add comments from this file');
    expect(status()).toBe('Tick at least one column of comments.');
    ($(mapping, '#col-3') as HTMLInputElement).checked = true;
    click(mapping, 'Add comments from this file');
    expect(status()).toBe('Added 1 comment from evals.csv (1 without a course or term).');
    expect(app.project().comments).toHaveLength(1);
  });

  it('imports a CSV using the fallback term and can cancel a mapping', async () => {
    setFile($(root, '#csv-file'), 'a.csv', 'Course,Comment\nCS 1,The quizzes were fair and kept me on track\n');
    await flush();
    click(root, 'Cancel');
    expect(root.querySelector('#csv-mapping')).toBeNull();
    setFile($(root, '#csv-file'), 'a.csv', 'Course,Comment\nCS 1,The quizzes were fair and kept me on track\nCS 1,-\n');
    await flush();
    setValue($(root, '#csv-term'), 'Spring 2025');
    setValue($(root, '#csv-term-col'), '');
    click(root, 'Add comments from this file');
    expect(status()).toBe('Added 1 comment from a.csv (skipped 1 empty answer like "N/A").');
    expect(app.project().comments[0]).toMatchObject({ course: 'CS 1', term: 'Spring 2025', source: 'a.csv' });
  });

  it('sets names to keep out of quotes', () => {
    setValue($(root, '#names'), 'Rivera, Sam Lee ,');
    expect(app.project().settings.names).toEqual(['Rivera', 'Sam Lee']);
    expect(status()).toContain('[name] for Rivera, Sam Lee');
    setValue($(root, '#names'), '');
    expect(status()).toBe('No extra names will be removed.');
  });

  it('loads the sample, shows the heatmap and the comments for a theme', () => {
    click(root, 'Try it with sample comments');
    expect(status()).toContain('Loaded the sample');
    expect($(root, '#tab-themes').getAttribute('aria-selected')).toBe('true');
    const heat = $(root, '#heatmap');
    expect(text(heat)).toContain('Exams & quizzes');
    expect(text(heat)).toContain('Spring 2025');
    click(heat, 'Exams & quizzes');
    const list = $(root, '#theme-comments');
    expect(text(list)).toMatch(/Exams & quizzes: \d+ comments/);
    expect(text(list)).not.toContain('Rivera');
    click($(root, '#theme-comments'), 'Pin as quote');
    expect(status()).toContain('Pinned');
    expect(app.project().pinned).toHaveLength(1);
    click($(root, '#theme-comments'), 'Unpin');
    expect(app.project().pinned).toHaveLength(0);
    click($(root, '#theme-comments'), 'Never quote');
    expect(app.project().excluded).toHaveLength(1);
    expect(text($(root, '#theme-comments'))).toContain('never quoted');
    click($(root, '#theme-comments'), 'Allow quoting');
    expect(app.project().excluded).toHaveLength(0);
    click(heat, 'Exams & quizzes');
    expect(root.querySelector('#theme-comments')).toBeNull();
    setValue($(root, '#theme-course'), 'CS 342');
    expect(text($(root, '#heatmap'))).toContain('CS 342: theme mentions by term');
    expect(text(root)).toContain('Words students used often');
  });

  it('confirms before replacing work with the sample or starting over', () => {
    click(root, 'Try it with sample comments');
    const n = app.project().comments.length;
    confirmAnswer = false;
    click(root, 'Try it with sample comments');
    click(root, 'Start over');
    expect(app.project().comments).toHaveLength(n);
    confirmAnswer = true;
    click(root, 'Start over');
    expect(app.project().comments).toHaveLength(0);
    expect(status()).toBe('Started over.');
  });

  it('adds and removes a custom theme', () => {
    app.setProject(sampleProject());
    app.openTab('themes');
    click(root, 'Add theme');
    expect(status()).toContain('Give the theme a name');
    setValue($(root, '#ct-label'), 'Recursion');
    setValue($(root, '#ct-words'), 'recursion, recursive*');
    click(root, 'Add theme');
    expect(status()).toMatch(/Added the theme "Recursion": \d+ comments mention it./);
    expect(text($(root, '#heatmap'))).toContain('Recursion');
    const id = app.project().settings.customThemes[0].id;
    app.project().changes[0].themes.push(id);
    $(root, 'button[aria-label="Remove theme Recursion"]').click();
    expect(app.project().settings.customThemes).toHaveLength(0);
    expect(app.project().changes[0].themes).not.toContain(id);
  });

  it('lists comments with no theme', () => {
    app.setProject({ ...sampleProject(), comments: [{ id: 'z', course: 'A', term: 'Fall 2024', text: 'Recursion recursion', source: 's' }], changes: [] });
    app.openTab('themes');
    expect(text(root)).toContain('None of these comments matched a theme');
    expect(text(root)).toContain('1 comment with no theme');
  });

  it('records, edits and removes a change, ticking themes from the words', () => {
    app.setProject(sampleProject());
    app.openTab('changes');
    expect(root.querySelectorAll('.change')).toHaveLength(2);
    expect(text($(root, '.impact'))).toContain('Critical share down');
    click(root, 'Add change');
    expect(status()).toContain('Say what you changed');
    setValue($(root, '#ch-course'), 'CS 342');
    setValue($(root, '#ch-term'), 'Fall 2024');
    setValue($(root, '#ch-what'), 'I cut one project to ease the workload', 'input');
    expect(($(root, '#ch-theme-pace') as HTMLInputElement).checked).toBe(true);
    setValue($(root, '#ch-why'), 'students said the pace was too fast', 'input');
    click(root, 'Add change');
    expect(status()).toBe('Added the change for CS 342, Fall 2024.');
    expect(app.project().changes[2]).toMatchObject({ course: 'CS 342', term: 'Fall 2024', themes: expect.arrayContaining(['pace']) });
    expect(text(root)).toContain('I cut one project to ease the workload.');
    expect(text(root)).toContain('About the same');
    click(root, 'Edit', 2);
    expect(text($(root, '#change-form'))).toContain('Edit this change');
    expect(($(root, '#ch-what') as HTMLTextAreaElement).value).toBe('I cut one project to ease the workload');
    click(root, 'Cancel');
    click(root, 'Edit', 2);
    const box = $(root, '#ch-theme-exams') as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    setValue($(root, '#ch-what'), 'cut one project', 'input');
    click(root, 'Save change');
    expect(status()).toBe('Updated the change.');
    expect(app.project().changes[2].themes).toContain('exams');
    click(root, 'Remove', 2);
    expect(app.project().changes).toHaveLength(2);
  });

  it('shows a change without themes and a rise in criticism', () => {
    const p = sampleProject();
    p.changes = [{ id: 'x', course: 'CS 342', term: 'Spring 2024', what: 'did a thing', why: '', themes: [] }, { id: 'y', course: 'CS 342', term: 'Fall 2022', what: 'x', why: '', themes: ['pace'] }];
    app.setProject(p);
    app.openTab('changes');
    expect(text(root)).toContain('No themes linked');
    p.changes = [];
    app.setProject(p);
    app.openTab('changes');
    expect(text(root)).toContain('No changes recorded yet.');
  });

  it('picks quotes per theme, copies them and lists excluded comments', async () => {
    app.setProject(sampleProject());
    app.openTab('quotes');
    expect(text(root)).toMatch(/: 4 quotes/);
    setValue($(root, '#q-count'), '2');
    expect(root.querySelectorAll('#quotes li')).toHaveLength(2);
    setValue($(root, '#q-theme'), 'exams');
    expect(text(root)).toContain('Exams & quizzes: 2 quotes');
    setValue($(root, '#q-course'), 'CS 142');
    click(root, 'Copy these quotes');
    await flush();
    expect(copied[0]).toMatch(/^“.+” \(CS 142, .+\)/);
    expect(status()).toBe('Copied 2 quotes.');
    click($(root, '#quotes'), 'Never quote');
    expect(text(root)).toContain('1 comment you chose never to quote');
    opts.copy = async () => {
      throw new Error('no');
    };
    app = mount(root, opts);
    app.setProject(sampleProject());
    app.openTab('quotes');
    click(root, 'Copy these quotes');
    await flush();
    expect(status()).toContain('Could not copy');
  });

  it('says when a theme has nothing to quote', () => {
    app.setProject({ ...sampleProject(), comments: [{ id: 'z', course: 'A', term: 'Fall 2024', text: 'The exam', source: 's' }], changes: [] });
    app.openTab('quotes');
    expect(text(root)).toContain('No clearly positive or critical comments on this theme.');
    app.setProject({ ...sampleProject(), comments: [{ id: 'z', course: 'A', term: 'Fall 2024', text: 'Recursion', source: 's' }], changes: [] });
    app.openTab('quotes');
    expect(text(root)).toContain('No themes to quote yet.');
  });

  it('drafts the reflection, follows the data until edited, and exports', async () => {
    app.setProject(sampleProject());
    app.openTab('reflection');
    const area = () => $(root, '#r-text') as HTMLTextAreaElement;
    expect(area().value).toMatch(/^# Reflection on Student Feedback/);
    expect(text($(root, '#r-count'))).toMatch(/of 1000 words/);
    expect(text($(root, '#r-todo'))).toContain('Still to write in your own words');
    // A tighter limit rewrites an unedited draft.
    setValue($(root, '#r-pages'), '0.5');
    expect(text(root)).toContain('To fit 250 words, the draft leaves out');
    // Edited text is kept, and over-limit is flagged.
    setValue(area(), area().value + ' extra words', 'input');
    setValue($(root, '#r-wpp'), '100');
    expect($(root, '#r-count').classList.contains('over')).toBe(true);
    expect(text($(root, '#r-count'))).toContain('over the limit');
    confirmAnswer = false;
    click(root, 'Rewrite the draft to fit');
    expect(area().value).toContain('extra words');
    confirmAnswer = true;
    click(root, 'Rewrite the draft to fit');
    expect(area().value).not.toContain('extra words');
    expect(status()).toContain('Wrote a new draft');
    click(root, 'Download for Word (.docx)');
    await flush();
    expect(status()).toBe('Downloaded teaching-reflection.docx.');
    click(root, 'Copy text');
    await flush();
    expect(copied[0].startsWith('Reflection on Student Feedback')).toBe(true);
    click(root, 'Download coded comments (CSV)');
    expect(status()).toContain('coded-comments.csv');
  });

  it('reports export and copy failures', async () => {
    opts.makeDocx = async () => {
      throw new Error('boom');
    };
    opts.copy = async () => {
      throw new Error('no');
    };
    app = mount(root, opts);
    app.setProject(sampleProject());
    app.openTab('reflection');
    setValue($(root, '#r-text') as HTMLTextAreaElement, 'No placeholders here.', 'input');
    expect(text($(root, '#r-todo'))).toBe('');
    click(root, 'Download for Word (.docx)');
    await flush();
    expect(status()).toBe('Could not build the Word file: boom');
    click(root, 'Copy text');
    await flush();
    expect(status()).toContain('Could not copy');
  });

  it('saves and opens project files', async () => {
    app.setProject(sampleProject());
    click(root, 'Save project file');
    expect(status()).toContain('Saved the project file');
    const input = $(root, '#open-file') as HTMLInputElement;
    setFile(input, 'bad.json', '{}');
    await flush();
    expect(status()).toContain('not a saved');
    const p = sampleProject();
    p.comments = p.comments.slice(0, 5);
    setFile(input, 'mine.json', serializeProject(p));
    await flush();
    expect(status()).toBe('Opened mine.json.');
    expect(app.project().comments).toHaveLength(5);
    Object.defineProperty(input, 'files', { value: [], configurable: true });
    input.dispatchEvent(new Event('change'));
    click(root, 'Open a project file');
  });

  it('warns before leaving with unsaved comments', () => {
    app.setProject(sampleProject());
    const ev2 = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev2);
    expect(ev2.defaultPrevented).toBe(true);
  });

  it('walks the Next buttons through every step', () => {
    app.setProject(sampleProject());
    app.openTab('comments');
    click(root, 'Next: see the themes');
    click(root, 'Next: record what you changed');
    click(root, 'Next: choose quotes');
    click(root, 'Next: the reflection draft');
    expect($(root, '#tab-reflection').getAttribute('aria-selected')).toBe('true');
  });
});

describe('dom helpers', () => {
  it('builds elements and downloads text', async () => {
    const { h, download } = await import('../src/ui/dom');
    const el = h('input', { type: 'checkbox', checked: true, disabled: false });
    expect(el.hasAttribute('checked')).toBe(true);
    expect(el.hasAttribute('disabled')).toBe(false);
    URL.createObjectURL = vi.fn(() => 'blob:y');
    URL.revokeObjectURL = vi.fn();
    vi.useFakeTimers();
    download('a.txt', 'hi', 'text/plain');
    vi.runAllTimers();
    vi.useRealTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:y');
  });
});
