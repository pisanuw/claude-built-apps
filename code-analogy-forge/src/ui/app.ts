import type { Analogy, Audience, Detection } from '../core/types';
import { AUDIENCES, AUDIENCE_LABELS } from '../core/types';
import { CONCEPT_GROUPS, getAnalogy, getConcept } from '../core/corpus/index';
import { detectConcepts } from '../core/detect';
import { encodeShare, decodeShare } from '../core/share';
import { Library, parseTags } from '../core/library';
import { analogyToMarkdown } from '../core/markdown';
import { EXAMPLES } from '../core/examples';

interface State {
  audience: Audience;
  input: string;
  detections: Detection[];
  activeConceptId: string | null;
  librarySearch: string;
  libraryTag: string | null;
}

const state: State = {
  audience: 'undergrad',
  input: '',
  detections: [],
  activeConceptId: null,
  librarySearch: '',
  libraryTag: null,
};

const library = new Library(window.localStorage);

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  for (const child of children) {
    node.append(child);
  }
  return node;
}

async function copyToClipboard(text: string, button: HTMLButtonElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    const original = button.textContent;
    button.textContent = 'Copied!';
    setTimeout(() => {
      button.textContent = original;
    }, 1200);
  } catch {
    window.prompt('Copy this:', text);
  }
}

function shareUrl(analogyId: string, audience: Audience, note?: string): string {
  const base = `${location.origin}${location.pathname}`;
  return `${base}#${encodeShare({ analogyId, audience, note })}`;
}

function audiencePicker(onChange: () => void): HTMLElement {
  const group = el('div', { class: 'audience-group', role: 'group', 'aria-label': 'Audience' });
  const buttons = new Map<Audience, HTMLButtonElement>();
  for (const a of AUDIENCES) {
    const btn = el('button', { type: 'button', 'aria-pressed': String(a === state.audience) }, [AUDIENCE_LABELS[a]]);
    btn.addEventListener('click', () => {
      state.audience = a;
      // The picker outlives renderResults(), so move the highlight here.
      for (const [audience, b] of buttons) {
        b.setAttribute('aria-pressed', String(audience === a));
      }
      onChange();
    });
    buttons.set(a, btn);
    group.append(btn);
  }
  return group;
}

function mapsTable(analogy: Analogy): HTMLElement {
  const table = el('table', { class: 'maps' });
  const head = el('tr', {}, [el('th', {}, ['In the code']), el('th', {}, ['In the analogy'])]);
  table.append(head);
  for (const m of analogy.maps) {
    table.append(el('tr', {}, [el('td', {}, [m.code]), el('td', {}, [m.analog])]));
  }
  return table;
}

function analogyCard(analogy: Analogy, opts: { readOnly?: boolean; note?: string } = {}): HTMLElement {
  const card = el('article', { class: 'card' });
  card.append(el('span', { class: 'domain' }, [analogy.domainLabel]));
  card.append(el('h3', {}, [analogy.title]));
  card.append(el('p', { class: 'body' }, [analogy.text[state.audience]]));
  card.append(mapsTable(analogy));
  if (opts.note) {
    card.append(el('p', { class: 'note' }, [opts.note]));
  }

  const actions = el('div', { class: 'card-actions' });
  const copyBtn = el('button', {}, ['Copy text']);
  copyBtn.addEventListener('click', () => void copyToClipboard(analogy.text[state.audience], copyBtn));
  const mdBtn = el('button', {}, ['Copy Markdown']);
  mdBtn.addEventListener('click', () => {
    const md = analogyToMarkdown(analogy.id, state.audience, opts.note);
    if (md) void copyToClipboard(md, mdBtn);
  });
  const linkBtn = el('button', {}, ['Copy share link']);
  linkBtn.addEventListener('click', () => void copyToClipboard(shareUrl(analogy.id, state.audience, opts.note), linkBtn));
  actions.append(copyBtn, mdBtn, linkBtn);

  if (!opts.readOnly) {
    const saveBtn = el('button', {}, ['Save to library']);
    actions.append(saveBtn);
    saveBtn.addEventListener('click', () => {
      if (card.querySelector('.save-form')) return;
      const form = el('div', { class: 'save-form' });
      const tagsInput = el('input', { placeholder: 'tags, comma separated (e.g. cs1, lecture-3)' });
      const noteInput = el('input', { placeholder: 'personal note (optional)' });
      const confirm = el('button', { class: 'primary' }, ['Save']);
      const cancel = el('button', {}, ['Cancel']);
      const row = el('div', { class: 'row' }, [confirm, cancel]);
      form.append(tagsInput, noteInput, row);
      card.append(form);
      confirm.addEventListener('click', () => {
        library.save({
          analogyId: analogy.id,
          audience: state.audience,
          tags: parseTags(tagsInput.value),
          note: noteInput.value,
        });
        form.replaceChildren(el('span', { class: 'flash' }, ['Saved to your library below.']));
        setTimeout(() => {
          form.remove();
          renderLibrary();
        }, 900);
      });
      cancel.addEventListener('click', () => form.remove());
    });
  }
  card.append(actions);
  return card;
}

function renderResults(): void {
  const host = document.getElementById('results');
  if (!host) return;
  host.replaceChildren();

  const chips = el('div', { class: 'chips' });
  for (const d of state.detections.slice(0, 6)) {
    const concept = getConcept(d.conceptId);
    if (!concept) continue;
    const chip = el(
      'button',
      { class: 'chip', 'aria-pressed': String(d.conceptId === state.activeConceptId) },
      [concept.name, el('span', { class: 'score' }, [`(${String(d.score)})`])],
    );
    chip.addEventListener('click', () => {
      state.activeConceptId = d.conceptId;
      renderResults();
    });
    chips.append(chip);
  }
  if (state.detections.length > 0) host.append(chips);

  const concept = state.activeConceptId ? getConcept(state.activeConceptId) : undefined;
  if (!concept) {
    if (state.input.trim() !== '') {
      host.append(
        el('p', { class: 'empty' }, [
          'No known concept detected. Try naming one directly ("recursion", "hash map") or pick one from the browse menu.',
        ]),
      );
    }
    return;
  }

  const active = state.detections.find((d) => d.conceptId === concept.id);
  if (active && active.evidence.length > 0) {
    host.append(el('p', { class: 'evidence' }, [`Why this concept: ${active.evidence.join('; ')}.`]));
  }

  const head = el('div', { class: 'concept-head' });
  head.append(el('h2', {}, [concept.name]));
  head.append(el('p', { class: 'tagline' }, [concept.tagline]));
  host.append(head);

  const cards = el('div', { class: 'cards' });
  for (const analogy of concept.analogies) {
    cards.append(analogyCard(analogy));
  }
  host.append(cards);
}

function renderLibrary(): void {
  const host = document.getElementById('library-body');
  if (!host) return;
  host.replaceChildren();

  const controls = el('div', { class: 'library-controls' });
  const search = el('input', { placeholder: 'Search saved analogies...', value: state.librarySearch });
  search.addEventListener('input', () => {
    state.librarySearch = search.value;
    renderList();
  });
  controls.append(search);
  for (const tag of library.allTags()) {
    const chip = el('button', { class: 'tag-chip', 'aria-pressed': String(tag === state.libraryTag) }, [`#${tag}`]);
    chip.addEventListener('click', () => {
      state.libraryTag = state.libraryTag === tag ? null : tag;
      renderLibrary();
    });
    controls.append(chip);
  }
  host.append(controls);

  const listHost = el('div', {});
  host.append(listHost);

  function renderList(): void {
    listHost.replaceChildren();
    const entries = library.search(state.librarySearch, state.libraryTag ?? undefined);
    if (entries.length === 0) {
      listHost.append(
        el('p', { class: 'empty' }, [
          library.list().length === 0
            ? 'Nothing saved yet. Forge an analogy above and press "Save to library".'
            : 'No saved analogies match this search.',
        ]),
      );
      return;
    }
    const cards = el('div', { class: 'cards' });
    for (const entry of entries) {
      const found = getAnalogy(entry.analogyId);
      if (!found) continue;
      const card = el('article', { class: 'card' });
      card.append(el('span', { class: 'domain' }, [found.analogy.domainLabel]));
      card.append(el('h3', {}, [`${found.concept.name}: ${found.analogy.title}`]));
      card.append(el('p', { class: 'body' }, [found.analogy.text[entry.audience]]));
      if (entry.note) card.append(el('p', { class: 'note' }, [entry.note]));
      const metaParts = [AUDIENCE_LABELS[entry.audience], new Date(entry.savedAt).toLocaleDateString()];
      if (entry.tags.length > 0) metaParts.push(entry.tags.map((t) => `#${t}`).join(' '));
      card.append(el('p', { class: 'saved-meta' }, [metaParts.join(' | ')]));
      const actions = el('div', { class: 'card-actions' });
      const copyBtn = el('button', {}, ['Copy text']);
      copyBtn.addEventListener('click', () => void copyToClipboard(found.analogy.text[entry.audience], copyBtn));
      const mdBtn = el('button', {}, ['Copy Markdown']);
      mdBtn.addEventListener('click', () => {
        const md = analogyToMarkdown(entry.analogyId, entry.audience, entry.note);
        if (md) void copyToClipboard(md, mdBtn);
      });
      const linkBtn = el('button', {}, ['Copy share link']);
      linkBtn.addEventListener('click', () =>
        void copyToClipboard(shareUrl(entry.analogyId, entry.audience, entry.note || undefined), linkBtn),
      );
      const delBtn = el('button', {}, ['Remove']);
      delBtn.addEventListener('click', () => {
        library.remove(entry.id);
        renderLibrary();
      });
      actions.append(copyBtn, mdBtn, linkBtn, delBtn);
      card.append(actions);
      cards.append(card);
    }
    listHost.append(cards);
  }

  renderList();
}

function runDetection(): void {
  state.detections = detectConcepts(state.input);
  state.activeConceptId = state.detections.length > 0 ? state.detections[0].conceptId : null;
  renderResults();
}

function renderShareView(root: HTMLElement, payload: { analogyId: string; audience: Audience; note?: string }): void {
  const found = getAnalogy(payload.analogyId);
  if (!found) return;
  state.audience = payload.audience;
  const wrap = el('div', { class: 'wrap' });
  const hero = el('header', { class: 'hero' });
  hero.append(el('h1', {}, [el('span', { class: 'spark' }, ['⚒ ']), 'Code Analogy Forge']));
  hero.append(el('p', {}, ['Someone shared this analogy with you.']));
  wrap.append(hero);

  const banner = el('div', { class: 'share-banner' });
  banner.append(
    el('span', {}, [
      `${found.concept.name}, explained for a ${AUDIENCE_LABELS[payload.audience].toLowerCase()}.`,
    ]),
  );
  const openBtn = el('button', { class: 'primary' }, ['Open the forge']);
  openBtn.addEventListener('click', () => {
    location.hash = '';
    location.reload();
  });
  banner.append(openBtn);
  wrap.append(banner);

  const cards = el('div', { class: 'cards' });
  cards.append(analogyCard(found.analogy, { readOnly: true, note: payload.note }));
  wrap.append(cards);
  root.replaceChildren(wrap);
}

export function mountApp(root: HTMLElement): void {
  const shared = decodeShare(location.hash);
  if (shared) {
    renderShareView(root, shared);
    return;
  }

  const wrap = el('div', { class: 'wrap' });

  const hero = el('header', { class: 'hero' });
  hero.append(el('h1', {}, [el('span', { class: 'spark' }, ['⚒ ']), 'Code Analogy Forge']));
  hero.append(
    el('p', {}, [
      'Paste code or name a CS concept, pick your audience, and get three analogies from different everyday domains: ready for a lecture slide, a blog post, or a meeting with stakeholders.',
    ]),
  );
  hero.append(
    el('p', { class: 'privacy-note' }, [
      'Deterministic and fully client-side: a hand-written detector and a curated corpus, no AI calls, nothing leaves your browser.',
    ]),
  );
  wrap.append(hero);

  const forge = el('section', { class: 'panel' });
  forge.append(el('label', { class: 'field-label', for: 'input' }, ['Code snippet or concept']));
  const input = el('textarea', { id: 'input', placeholder: 'Paste a snippet, or just type a concept like "recursion" or "hash map"...' });
  forge.append(input);

  const controls = el('div', { class: 'controls' });
  controls.append(audiencePicker(() => renderResults()));

  const picker = el('select', { id: 'concept-picker', 'aria-label': 'Browse a concept' });
  picker.append(el('option', { value: '' }, ['Browse a concept...']));
  for (const group of CONCEPT_GROUPS) {
    const og = el('optgroup', { label: group.label });
    for (const c of group.concepts) {
      og.append(el('option', { value: c.id }, [c.name]));
    }
    picker.append(og);
  }
  picker.addEventListener('change', () => {
    if (picker.value === '') return;
    state.activeConceptId = picker.value;
    state.detections = [];
    renderResults();
    picker.value = '';
  });
  controls.append(picker);

  const forgeBtn = el('button', { class: 'primary' }, ['Forge analogies']);
  forgeBtn.addEventListener('click', () => {
    state.input = input.value;
    runDetection();
  });
  controls.append(forgeBtn);

  const examplePicker = el('select', { id: 'example-picker', 'aria-label': 'Try an example' });
  examplePicker.append(el('option', { value: '' }, ['Try an example...']));
  for (const group of CONCEPT_GROUPS) {
    const conceptIds = new Set(group.concepts.map((c) => c.id));
    const groupExamples = EXAMPLES.filter((ex) => conceptIds.has(ex.highlights));
    if (groupExamples.length === 0) continue;
    const og = el('optgroup', { label: group.label });
    for (const ex of groupExamples) {
      og.append(el('option', { value: ex.id }, [ex.label]));
    }
    examplePicker.append(og);
  }
  examplePicker.addEventListener('change', () => {
    const ex = EXAMPLES.find((e) => e.id === examplePicker.value);
    if (!ex) return;
    input.value = ex.code;
    state.input = ex.code;
    runDetection();
    examplePicker.value = '';
  });
  controls.append(examplePicker);

  forge.append(controls);
  wrap.append(forge);

  input.addEventListener('input', () => {
    state.input = input.value;
    runDetection();
  });

  wrap.append(el('div', { id: 'results' }));

  const librarySection = el('section', { class: 'panel library' });
  librarySection.append(el('h2', {}, ['Your library']));
  librarySection.append(el('div', { id: 'library-body' }));
  wrap.append(librarySection);

  wrap.append(
    el('footer', {}, [
      'Everything is stored in your browser (localStorage). Share links encode the analogy, audience, and your note; they need no server. ',
      el('a', { href: 'https://github.com/pisanuw/Claude-capstone/tree/main/code-analogy-forge' }, ['Source on GitHub']),
    ]),
  );

  root.replaceChildren(wrap);
  renderLibrary();
}
