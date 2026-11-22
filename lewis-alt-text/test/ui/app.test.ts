// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Generate } from '../../src/core/alt-text';
import { InputError } from '../../src/core/request';
import { BYOK_KEY, CapReached, GatewayError, LlmUnavailable, memoryStorage, MODE_KEY } from '../../src/lib/llm';
import { errorMessage, mountApp, type AppDeps } from '../../src/ui/app';

const prepared = { base64: 'QUJD', mediaType: 'image/png' as const, width: 10, height: 10, bytes: 3, resized: false };

function setup(over: Partial<AppDeps> = {}) {
  document.body.innerHTML = '<main id="app"></main>';
  const root = document.getElementById('app') as HTMLElement;
  const storage = over.storage ?? memoryStorage();
  const generate: Generate = over.generate ?? vi.fn(async () => ({ text: 'A Lewis structure shows N.', model: 'm' }));
  const deps: AppDeps = {
    skill: '# Skill',
    generate,
    live: false,
    storage,
    prepare: vi.fn(async () => prepared),
    createObjectURL: () => 'blob:x',
    clipboard: { writeText: vi.fn(async () => {}) },
    formatTime: (iso) => `T(${iso})`,
    ...over,
  };
  const app = mountApp(root, deps);
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector(`#${id}`) as T;
  return { root, app, deps, storage, generate, $ };
}

function choose(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
}
const png = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'a.png', { type: 'image/png' });

async function submit(t: ReturnType<typeof setup>) {
  t.$<HTMLFormElement>('form').dispatchEvent(new Event('submit', { cancelable: true }));
  await t.app.idle();
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('the page', () => {
  it('links to the command-line tool and its instructions', () => {
    const t = setup();
    const links = [...t.$('cli-note').querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')]);
    expect(links).toEqual([
      ['command-line tool', '/terminal/'],
      ['How to install and use it', 'https://github.com/pisanuw/claude-built-apps/blob/main/lewis-alt-text/cli/INSTRUCTIONS.md'],
    ]);
  });
  it('ends with the credit to the skill author, after the command-line link', () => {
    const t = setup();
    const credit = t.$('credit');
    expect(credit.textContent).toBe(
      'This app was built by HintWise for Scott Rayermann <scottpr@uw.edu> who created the initial skill for generating alt-text descriptions from images.',
    );
    expect(credit.querySelector('a')?.getAttribute('href')).toBe('mailto:scottpr@uw.edu');
    expect(t.root.lastElementChild).toBe(credit);
  });
});

describe('choosing a key', () => {
  it('starts on your own key when sign-in is not set up', () => {
    const t = setup();
    expect(t.storage.getItem(MODE_KEY)).toBe('byok');
    expect(t.root.querySelector<HTMLElement>('[data-part=byok]')!.hidden).toBe(false);
    expect(t.$('signin-note').textContent).toMatch(/not set up/);
    expect(t.$('signin').hidden).toBe(true);
  });

  it('starts on the HintWise key when live, mounts sign-in and shows the allowance', async () => {
    const mountSignIn = vi.fn();
    let authCb: () => void = () => {};
    const checkAllowance = vi.fn(async () => ({ allowed: true, callsLeft: 5 }));
    const t = setup({ live: true, mountSignIn, checkAllowance, onAuth: (cb) => (authCb = cb) });
    expect(t.storage.getItem(MODE_KEY)).toBe('gateway');
    expect(mountSignIn).toHaveBeenCalledWith(t.$('signin'));
    expect(t.$('signin').closest('header .top-bar')).toBeTruthy(); // at the right of the top bar
    expect(t.$('signin-note').textContent).toMatch(/Sign-in is at the top of the page/);
    await vi.waitFor(() => expect(t.$('allowance').textContent).toBe('5 alt texts left on the HintWise key.'));
    authCb();
    expect(checkAllowance).toHaveBeenCalledTimes(2);
  });

  it('switches modes and saves or forgets a key', () => {
    const t = setup({ live: true, mountSignIn: () => {} });
    const byok = t.root.querySelector<HTMLInputElement>('input[value=byok]')!;
    byok.checked = true;
    byok.dispatchEvent(new Event('change'));
    expect(t.storage.getItem(MODE_KEY)).toBe('byok');
    t.$('byok-save').click();
    expect(t.$('byok-note').textContent).toMatch(/Paste a key first/);
    t.$<HTMLInputElement>('byok-key').value = ' sk-ant-1 ';
    t.$('byok-save').click();
    expect(t.storage.getItem(BYOK_KEY)).toBe('sk-ant-1');
    expect(t.$<HTMLInputElement>('byok-key').value).toBe('');
    expect(t.$('byok-key').getAttribute('placeholder')).toMatch(/saved/);
    t.$('byok-forget').click();
    expect(t.storage.getItem(BYOK_KEY)).toBeNull();
    expect(t.$('byok-note').textContent).toMatch(/removed/);
  });

  it('keeps a mode chosen earlier', () => {
    const storage = memoryStorage();
    storage.setItem(MODE_KEY, 'byok');
    setup({ live: true, storage, mountSignIn: () => {} });
    expect(storage.getItem(MODE_KEY)).toBe('byok');
  });
});

describe('giving an image', () => {
  it('asks for an image before sending', async () => {
    const t = setup();
    await submit(t);
    expect(t.$('status').textContent).toBe('Choose an image first.');
    expect(t.generate).not.toHaveBeenCalled();
  });

  it('accepts a chosen, dropped or pasted image and refuses other files', () => {
    const t = setup();
    choose(t.$<HTMLInputElement>('file'), new File(['x'], 'a.txt', { type: 'text/plain' }));
    expect(t.$('file-name').textContent).toMatch(/not a PNG/);
    choose(t.$<HTMLInputElement>('file'), png());
    expect(t.$('file-name').textContent).toMatch(/Selected: a.png/);
    expect(t.$<HTMLImageElement>('preview').hidden).toBe(false);

    const drop = t.$('drop');
    drop.dispatchEvent(new Event('dragover'));
    expect(drop.classList.contains('over')).toBe(true);
    drop.dispatchEvent(new Event('dragleave'));
    expect(drop.classList.contains('over')).toBe(false);
    const dropped = Object.assign(new Event('drop'), { dataTransfer: { files: [new File(['y'], 'b.gif', { type: 'image/gif' })] } });
    drop.dispatchEvent(dropped);
    expect(t.$('file-name').textContent).toMatch(/b.gif/);

    const blob = new Blob(['z'], { type: 'image/jpeg' });
    const paste = Object.assign(new Event('paste'), { clipboardData: { items: [{ type: 'image/jpeg', getAsFile: () => blob }] } });
    document.dispatchEvent(paste);
    expect(t.$('file-name').textContent).toMatch(/pasted image/);
  });

  it('opens the file picker from the keyboard', () => {
    const t = setup();
    const click = vi.spyOn(t.$<HTMLInputElement>('file'), 'click').mockImplementation(() => {});
    t.$('drop').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    t.$('drop').dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    t.$('drop').dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    t.$('drop').click();
    expect(click).toHaveBeenCalledTimes(3);
  });
});

describe('writing alt text', () => {
  it('sends the options and shows the alt text, warnings and audit', async () => {
    const generate = vi.fn<Generate>(async () => ({ text: 'Audit\nS1\nAlt text\nA double bond joins Cl.', model: 'm' }));
    const t = setup({ generate });
    choose(t.$<HTMLInputElement>('file'), png());
    t.root.querySelector<HTMLInputElement>('input[value=answer-key]')!.checked = true;
    t.$<HTMLSelectElement>('focus').value = 'geometry';
    t.$<HTMLTextAreaElement>('context').value = 'HW 3';
    t.$<HTMLInputElement>('audit').checked = true;
    await submit(t);
    const text = generate.mock.calls[0][0].messages[0].content[1].text;
    expect(text).toMatch(/answer key[\s\S]*molecular geometry[\s\S]*HW 3[\s\S]*audit/);
    expect(t.$<HTMLTextAreaElement>('alt').value).toBe('A double bond joins Cl.');
    expect(t.$('warn-list').children).toHaveLength(2);
    expect(t.$('audit-block').hidden).toBe(false);
    expect(t.$('counts').textContent).toMatch(/23 characters, 5 words/);
    expect(t.$('status').textContent).toMatch(/^Done in/);
    expect(document.activeElement).toBe(t.$('result-h'));
    expect(t.$<HTMLButtonElement>('go').disabled).toBe(false);
  });

  it('shows a question from the model', async () => {
    const t = setup({ generate: async () => ({ text: 'QUESTION: Is this an answer key?' }) });
    choose(t.$<HTMLInputElement>('file'), png());
    await submit(t);
    expect(t.$('question').hidden).toBe(false);
    expect(t.$('question').textContent).toMatch(/Is this an answer key\? Add the answer under Context/);
    expect(t.$('alt-block').hidden).toBe(true);
  });

  it('shows failures in plain words', async () => {
    const t = setup({ generate: async () => Promise.reject(new CapReached('user-day', 'R')) });
    choose(t.$<HTMLInputElement>('file'), png());
    await submit(t);
    expect(t.$('error').hidden).toBe(false);
    expect(t.$('error').textContent).toBe('Your daily HintWise allowance is used up. It renews at T(R). You can use your own Anthropic key in the meantime.');
    expect(t.$('status').textContent).toBe('');
  });

  it('copies the result, or selects it when the clipboard is blocked', async () => {
    const t = setup();
    choose(t.$<HTMLInputElement>('file'), png());
    await submit(t);
    t.$('copy').click();
    await vi.waitFor(() => expect(t.$('status').textContent).toBe('Alt text copied.'));
    expect(t.deps.clipboard!.writeText).toHaveBeenCalledWith('A Lewis structure shows N.');

    const blocked = setup({ clipboard: { writeText: async () => Promise.reject(new Error('no')) } });
    choose(blocked.$<HTMLInputElement>('file'), png());
    await submit(blocked);
    blocked.$('copy').click();
    await vi.waitFor(() => expect(blocked.$('status').textContent).toMatch(/Ctrl\+C/));
  });
});

describe('errorMessage', () => {
  it('covers every kind of failure', () => {
    const f = (s: string) => `T(${s})`;
    expect(errorMessage(new CapReached('app-day', 'R'), f)).toMatch(/shared allowance[\s\S]*T\(R\)/);
    expect(errorMessage(new InputError('Bad image.'))).toBe('Bad image.');
    expect(errorMessage(new LlmUnavailable('Sign in first.'))).toBe('Sign in first.');
    expect(errorMessage(new GatewayError(401, { message: 'Session ended.' }))).toBe('The HintWise key could not be used: Session ended.');
    expect(errorMessage(Object.assign(new Error('x'), { status: 401 }))).toMatch(/did not accept that API key/);
    expect(errorMessage(Object.assign(new Error('x'), { status: 429 }))).toMatch(/limiting requests/);
    expect(errorMessage(new Error('boom'))).toBe('Something went wrong: boom');
    expect(errorMessage('weird')).toBe('Something went wrong: weird');
  });
});
