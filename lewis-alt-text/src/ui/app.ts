/**
 * The page: choose how to run the model, give an image and what is known
 * about it, get alt text. Every outside dependency is passed in, so the whole
 * page runs under jsdom in the tests; src/main.ts passes the real ones.
 */
import { writeAltText, type Generate, type Result } from '../core/alt-text';
import { prepareImage, type PreparedImage } from '../core/image';
import { INSTRUCTIONS_URL } from '../core/remote';
import { InputError } from '../core/request';
import { CapReached, GatewayError, getByokKey, getMode, LlmUnavailable, setByokKey, setMode, type LlmMode } from '../lib/llm';
import { allowanceText, capMessage, formatReset, type Allowance } from './allowance';

export interface AppDeps {
  skill: string;
  generate: Generate;
  /** True when Supabase env is set, so the HintWise key can be used. */
  live: boolean;
  mountSignIn?: (el: HTMLElement) => void;
  /** Called on sign-in changes so the allowance line can refresh. */
  onAuth?: (cb: () => void) => void;
  checkAllowance?: () => Promise<Allowance | null>;
  prepare?: (file: Blob) => Promise<PreparedImage>;
  storage?: Storage;
  clipboard?: Pick<Clipboard, 'writeText'>;
  formatTime?: (iso: string) => string;
  createObjectURL?: (b: Blob) => string;
}

const SHELL = `
  <header>
    <div class="top-bar">
      <h1>Lewis Structure Alt Text</h1>
      <div id="signin" role="region" aria-label="Account"></div>
    </div>
    <p class="lede">Give it an image of a Lewis structure or a related chemistry figure. It writes alt text for screen reader users that describes what is drawn, without giving away answers students are meant to work out.</p>
  </header>

  <section class="card" aria-labelledby="key-h">
    <h2 id="key-h">How to run it</h2>
    <fieldset>
      <legend class="visually-hidden">Which key pays for the model</legend>
      <label><input type="radio" name="mode" value="gateway"> The HintWise key: sign in, free daily allowance</label>
      <label><input type="radio" name="mode" value="byok"> Your own Anthropic API key</label>
    </fieldset>
    <div data-part="gateway">
      <p id="signin-note" class="muted small"></p>
      <p id="allowance" class="muted" aria-live="polite"></p>
    </div>
    <div data-part="byok" hidden>
      <label for="byok-key">Anthropic API key</label>
      <input id="byok-key" type="password" autocomplete="off" spellcheck="false" placeholder="sk-ant-...">
      <div class="row">
        <button type="button" id="byok-save" class="secondary">Save in this browser</button>
        <button type="button" id="byok-forget" class="secondary">Forget key</button>
      </div>
      <p class="muted small" id="byok-note">Your key stays in this browser and goes only to api.anthropic.com. Anthropic bills you for each call.</p>
    </div>
  </section>

  <form id="form" novalidate>
    <section class="card" aria-labelledby="img-h">
      <h2 id="img-h">1. Image</h2>
      <div id="drop" class="drop" tabindex="0" role="button" aria-describedby="drop-help">
        <img id="preview" alt="" hidden>
        <p id="drop-help">Drop an image here, paste one, or <span class="link">choose a file</span>. PNG, JPEG, GIF or WebP.</p>
      </div>
      <input id="file" type="file" accept="image/png,image/jpeg,image/gif,image/webp" class="visually-hidden" tabindex="-1" aria-hidden="true">
      <p id="file-name" class="muted" aria-live="polite"></p>
    </section>

    <section class="card" aria-labelledby="about-h">
      <h2 id="about-h">2. About the figure <span class="muted">(optional, improves the result)</span></h2>
      <fieldset>
        <legend>Figure purpose</legend>
        <label><input type="radio" name="purpose" value="unknown" checked> Not sure (treated as a question)</label>
        <label><input type="radio" name="purpose" value="question"> Question: students must work it out</label>
        <label><input type="radio" name="purpose" value="answer-key"> Answer key: describe every answer shown</label>
      </fieldset>
      <label for="focus">Instructional focus</label>
      <select id="focus">
        <option value="unknown">Not specified (moderate detail)</option>
        <option value="lewis">Lewis structures (exact lone pair positions)</option>
        <option value="resonance">Resonance</option>
        <option value="formal-charge">Formal charges</option>
        <option value="geometry">Molecular geometry</option>
        <option value="polarity">Bond polarity</option>
        <option value="other">Other (describe below)</option>
      </select>
      <label for="context">Context</label>
      <textarea id="context" rows="3" maxlength="2000" placeholder="Caption, question text or lesson topic. Example: Homework 3, question 2: assign formal charges."></textarea>
      <label class="inline"><input type="checkbox" id="audit"> Also show the verification audit (atom-by-atom count)</label>
    </section>

    <div class="actions">
      <button id="go" type="submit">Write alt text</button>
      <p id="status" class="muted" role="status" aria-live="polite"></p>
    </div>
  </form>

  <section id="result" class="card" hidden aria-labelledby="result-h">
    <h2 id="result-h" tabindex="-1">Alt text</h2>
    <div id="question" class="notice" hidden></div>
    <div id="error" class="notice error" role="alert" hidden></div>
    <div id="alt-block" hidden>
      <textarea id="alt" rows="8" readonly aria-labelledby="result-h"></textarea>
      <div class="row">
        <button type="button" id="copy">Copy</button>
        <span id="counts" class="muted"></span>
      </div>
      <div id="warnings" class="notice warn" hidden>
        <h3>Check these</h3>
        <ul id="warn-list"></ul>
      </div>
      <details id="audit-block" hidden>
        <summary>Verification audit</summary>
        <pre id="audit-text"></pre>
      </details>
    </div>
    <p class="muted small">Check the alt text against the image before you publish it. The model can miscount bonds, dots or charges.</p>
  </section>

  <p class="muted small" id="cli-note">Many figures? The <a href="/terminal/">command-line tool</a> writes alt text for a whole folder at once. <a href="${INSTRUCTIONS_URL}">How to install and use it</a>.</p>
  <p class="muted small" id="credit">This app was built by HintWise for Scott Rayermann &lt;<a href="mailto:scottpr@uw.edu">scottpr@uw.edu</a>&gt; who created the initial skill for generating alt-text descriptions from images.</p>
`;

export interface App {
  /** Resolves when the current request (if any) has finished: for tests. */
  idle(): Promise<void>;
}

export function mountApp(root: HTMLElement, deps: AppDeps): App {
  const storage = deps.storage ?? localStorage;
  const prepare = deps.prepare ?? ((f: Blob) => prepareImage(f));
  const format = deps.formatTime ?? ((iso: string) => formatReset(iso));
  const objectUrl = deps.createObjectURL ?? ((b: Blob) => URL.createObjectURL(b));
  root.innerHTML = SHELL;
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector(`#${id}`) as T;
  const doc = root.ownerDocument;
  let image: Blob | null = null;
  let busy: Promise<void> = Promise.resolve();

  // --- Which key -----------------------------------------------------------
  const modeRadios = [...root.querySelectorAll<HTMLInputElement>('input[name=mode]')];
  const gatewayPart = root.querySelector<HTMLElement>('[data-part=gateway]')!;
  const byokPart = root.querySelector<HTMLElement>('[data-part=byok]')!;
  let mode: LlmMode = getMode(storage);
  if (mode === 'off') mode = deps.live ? 'gateway' : 'byok';
  setMode(mode, storage);

  const refreshAllowance = async (): Promise<void> => {
    if (mode !== 'gateway' || !deps.checkAllowance) return;
    $('allowance').textContent = allowanceText(await deps.checkAllowance(), format);
  };

  const showMode = (): void => {
    for (const r of modeRadios) r.checked = r.value === mode;
    gatewayPart.hidden = mode !== 'gateway';
    byokPart.hidden = mode !== 'byok';
    if (mode === 'byok') $('byok-key').setAttribute('placeholder', getByokKey(storage) ? 'A key is saved in this browser' : 'sk-ant-...');
    void refreshAllowance();
  };
  for (const r of modeRadios) {
    r.addEventListener('change', () => {
      mode = r.value as LlmMode;
      setMode(mode, storage);
      showMode();
    });
  }

  // Sign-in sits at the right of the top bar (UpvoteMe's look); this card only points to it.
  if (deps.live && deps.mountSignIn) {
    deps.mountSignIn($('signin'));
    $('signin-note').textContent = 'Sign-in is at the top of the page: Google, or a magic link by email.';
  } else {
    $('signin').hidden = true;
    $('signin-note').textContent = 'Sign-in is not set up on this copy of the app. Use your own key instead.';
  }
  deps.onAuth?.(() => void refreshAllowance());

  $('byok-save').addEventListener('click', () => {
    const input = $<HTMLInputElement>('byok-key');
    if (!input.value.trim()) {
      $('byok-note').textContent = 'Paste a key first.';
      return;
    }
    setByokKey(input.value, storage);
    input.value = '';
    $('byok-note').textContent = 'Key saved in this browser. It goes only to api.anthropic.com.';
    showMode();
  });
  $('byok-forget').addEventListener('click', () => {
    setByokKey(null, storage);
    $('byok-note').textContent = 'Key removed from this browser.';
    showMode();
  });
  showMode();

  // --- Image ---------------------------------------------------------------
  const drop = $('drop');
  const fileInput = $<HTMLInputElement>('file');
  const setImage = (f: File | Blob | null | undefined): void => {
    if (!f) return;
    if (!/^image\/(png|jpeg|gif|webp)$/.test(f.type)) {
      $('file-name').textContent = `That file is not a PNG, JPEG, GIF or WebP image (${f.type || 'unknown type'}).`;
      return;
    }
    image = f;
    const preview = $<HTMLImageElement>('preview');
    preview.src = objectUrl(f);
    preview.hidden = false;
    const name = f instanceof File && f.name ? f.name : 'pasted image';
    $('file-name').textContent = `Selected: ${name} (${Math.max(1, Math.round(f.size / 1024))} KB).`;
  };
  drop.addEventListener('click', () => fileInput.click());
  drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener('change', () => setImage(fileInput.files?.[0]));
  for (const t of ['dragenter', 'dragover']) {
    drop.addEventListener(t, (e) => {
      e.preventDefault();
      drop.classList.add('over');
    });
  }
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    setImage((e as DragEvent).dataTransfer?.files?.[0]);
  });
  doc.addEventListener('paste', (e) => {
    const item = [...((e as ClipboardEvent).clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
    if (item) setImage(item.getAsFile());
  });

  // --- Request -------------------------------------------------------------
  const form = $<HTMLFormElement>('form');
  const go = $<HTMLButtonElement>('go');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!image) {
      $('status').textContent = 'Choose an image first.';
      drop.focus();
      return;
    }
    busy = run(image);
  });

  async function run(file: Blob): Promise<void> {
    go.disabled = true;
    go.textContent = 'Working...';
    $('status').textContent = 'Writing alt text. This usually takes 10 to 40 seconds.';
    try {
      const img = await prepare(file);
      const options = {
        purpose: root.querySelector<HTMLInputElement>('input[name=purpose]:checked')?.value,
        focus: $<HTMLSelectElement>('focus').value,
        context: $<HTMLTextAreaElement>('context').value,
        audit: $<HTMLInputElement>('audit').checked,
      };
      const result = await writeAltText({ base64: img.base64, mediaType: img.mediaType, options, skill: deps.skill, generate: deps.generate });
      show(result);
      $('status').textContent = result.kind === 'alt' ? `Done in ${Math.round(result.ms / 1000)} s.` : '';
    } catch (err) {
      show({ kind: 'error', message: errorMessage(err, format), warnings: [], ms: 0 });
      $('status').textContent = '';
    } finally {
      go.disabled = false;
      go.textContent = 'Write alt text';
      void refreshAllowance();
    }
  }

  function show(r: Result): void {
    $('result').hidden = false;
    $('question').hidden = r.kind !== 'question';
    $('error').hidden = r.kind !== 'error';
    $('alt-block').hidden = r.kind !== 'alt';
    if (r.kind === 'question') {
      $('question').textContent = `The model needs more information: ${r.question} Add the answer under Context and press Write alt text again.`;
    } else if (r.kind === 'error') {
      $('error').textContent = r.message;
    } else {
      $<HTMLTextAreaElement>('alt').value = r.altText;
      const words = r.altText.split(/\s+/).filter(Boolean).length;
      $('counts').textContent = `${r.altText.length} characters, ${words} words`;
      $('warnings').hidden = r.warnings.length === 0;
      $('warn-list').replaceChildren(...r.warnings.map((w) => Object.assign(doc.createElement('li'), { textContent: w })));
      $('audit-block').hidden = !r.audit;
      $('audit-text').textContent = r.audit ?? '';
    }
    $('result-h').focus();
  }

  $('copy').addEventListener('click', async () => {
    const text = $<HTMLTextAreaElement>('alt').value;
    try {
      await (deps.clipboard ?? navigator.clipboard).writeText(text);
      $('status').textContent = 'Alt text copied.';
    } catch {
      $<HTMLTextAreaElement>('alt').select();
      $('status').textContent = 'Press Ctrl+C (or Command+C) to copy the selected text.';
    }
  });

  return { idle: () => busy };
}

/** Plain words for every failure the page can meet. */
export function errorMessage(err: unknown, format: (iso: string) => string = formatReset): string {
  if (err instanceof CapReached) return capMessage(err.scope, err.resetsAt, format);
  if (err instanceof InputError || err instanceof LlmUnavailable) return err.message;
  if (err instanceof GatewayError) return `The HintWise key could not be used: ${err.message}`;
  const status = (err as { status?: unknown })?.status;
  if (status === 401) return 'Anthropic did not accept that API key. Check it, or switch to the HintWise key.';
  if (status === 429) return 'Anthropic is limiting requests on your key. Wait a minute and try again.';
  const msg = err instanceof Error ? err.message : String(err);
  return `Something went wrong: ${msg}`;
}
