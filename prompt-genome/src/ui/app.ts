import type { Gene, GeneType, Mutation } from '../core/types';
import { GENE_META, GENE_TYPES, isGeneType } from '../core/types';
import { segmentPrompt, makeGene } from '../core/segment';
import { mutations } from '../core/mutate';
import { lintGenome, healthScore } from '../core/lint';
import { diffWords } from '../core/diff';
import { assemble, toMarkdown, toJSON } from '../core/assemble';
import { encodeShare, decodeShare } from '../core/share';
import { GeneLibrary, parseTags } from '../core/library';
import { EXAMPLES, getExample } from '../core/examples';

interface State {
  input: string;
  original: string;
  genes: Gene[];
  mutatingId: string | null;
  editingId: string | null;
  savingId: string | null;
  diffOpen: boolean;
  librarySearch: string;
  libraryTag: string | null;
}

const state: State = {
  input: '',
  original: '',
  genes: [],
  mutatingId: null,
  editingId: null,
  savingId: null,
  diffOpen: false,
  librarySearch: '',
  libraryTag: null,
};

const library = new GeneLibrary(window.localStorage);

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
  for (const child of children) node.append(child);
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

let rootEl: HTMLElement | null = null;

function render(): void {
  if (rootEl) mountInto(rootEl);
}

function badge(type: GeneType): HTMLElement {
  const meta = GENE_META[type];
  return el('span', { class: `badge badge-${type}`, title: meta.blurb }, [meta.label]);
}

function typeSelect(gene: Gene): HTMLElement {
  const select = el('select', { class: 'type-select', title: 'Reclassify this gene' });
  for (const t of GENE_TYPES) {
    const opt = el('option', { value: t }, [GENE_META[t].label]);
    if (t === gene.type) opt.selected = true;
    select.append(opt);
  }
  select.addEventListener('change', () => {
    if (isGeneType(select.value)) {
      gene.type = select.value;
      gene.cues = ['reclassified by hand'];
      render();
    }
  });
  return select;
}

function geneStrand(): HTMLElement {
  const strand = el('div', { class: 'strand', title: 'The genome at a glance' });
  const total = state.genes.reduce((n, g) => n + g.text.length, 0) || 1;
  for (const g of state.genes) {
    const seg = el('span', {
      class: `strand-seg badge-${g.type}`,
      title: `${GENE_META[g.type].label}: ${g.text.slice(0, 60)}`,
    });
    seg.style.flexGrow = String(Math.max(g.text.length / total, 0.04));
    seg.addEventListener('click', () => {
      document.getElementById(`gene-${g.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    strand.append(seg);
  }
  return strand;
}

function mutationPanel(gene: Gene): HTMLElement {
  const panel = el('div', { class: 'mutations' });
  for (const m of mutations(gene)) {
    panel.append(mutationCard(gene, m));
  }
  return panel;
}

function mutationCard(gene: Gene, m: Mutation): HTMLElement {
  const apply = el('button', { class: 'small primary' }, ['Apply']);
  apply.addEventListener('click', () => {
    gene.text = m.text;
    gene.cues = [...gene.cues, `mutated: ${m.label.toLowerCase()}`];
    state.mutatingId = null;
    render();
  });
  const diffLine = el('p', { class: 'mutation-preview' });
  for (const token of diffWords(gene.text, m.text)) {
    if (token.kind === 'removed') continue;
    const span = el('span', { class: token.kind === 'added' ? 'tok-added' : '' }, [token.text]);
    diffLine.append(span, ' ');
  }
  return el('div', { class: 'mutation' }, [
    el('div', { class: 'mutation-head' }, [el('strong', {}, [m.label]), apply]),
    el('p', { class: 'muted small-text' }, [m.rationale]),
    diffLine,
  ]);
}

function savePanel(gene: Gene): HTMLElement {
  const tagInput = el('input', {
    type: 'text',
    placeholder: 'tags, comma-separated (optional)',
    class: 'tag-input',
  });
  const save = el('button', { class: 'small primary' }, ['Save']);
  save.addEventListener('click', () => {
    library.save({ type: gene.type, text: gene.text }, parseTags(tagInput.value));
    state.savingId = null;
    render();
  });
  const cancel = el('button', { class: 'small' }, ['Cancel']);
  cancel.addEventListener('click', () => {
    state.savingId = null;
    render();
  });
  return el('div', { class: 'save-panel' }, [tagInput, save, cancel]);
}

function geneCard(gene: Gene, index: number): HTMLElement {
  const actions = el('div', { class: 'gene-actions' });
  const btn = (label: string, title: string, onClick: () => void, cls = 'small'): void => {
    const b = el('button', { class: cls, title }, [label]);
    b.addEventListener('click', onClick);
    actions.append(b);
  };

  btn(state.editingId === gene.id ? 'Done' : 'Edit', 'Edit this gene in place', () => {
    state.editingId = state.editingId === gene.id ? null : gene.id;
    state.mutatingId = null;
    render();
  });
  btn(state.mutatingId === gene.id ? 'Close' : 'Mutate', 'Three deterministic rewrites', () => {
    state.mutatingId = state.mutatingId === gene.id ? null : gene.id;
    state.editingId = null;
    render();
  });
  btn('Duplicate', 'Copy this gene below', () => {
    state.genes.splice(index + 1, 0, makeGene(gene.type, gene.text, [...gene.cues]));
    render();
  });
  btn('Save', 'Save to your gene library', () => {
    state.savingId = state.savingId === gene.id ? null : gene.id;
    render();
  });
  if (index > 0) {
    btn('↑', 'Move up', () => {
      [state.genes[index - 1], state.genes[index]] = [state.genes[index], state.genes[index - 1]];
      render();
    });
  }
  if (index < state.genes.length - 1) {
    btn('↓', 'Move down', () => {
      [state.genes[index + 1], state.genes[index]] = [state.genes[index], state.genes[index + 1]];
      render();
    });
  }
  btn('✕', 'Delete this gene', () => {
    state.genes.splice(index, 1);
    render();
  }, 'small danger');

  const body: (Node | string)[] = [];
  if (state.editingId === gene.id) {
    const textarea = el('textarea', { class: 'gene-edit', 'aria-label': `Edit the ${GENE_META[gene.type].label} gene` }, [gene.text]);
    textarea.value = gene.text;
    textarea.addEventListener('input', () => {
      gene.text = textarea.value;
    });
    textarea.addEventListener('blur', () => {
      gene.cues = [...gene.cues.filter((c) => c !== 'edited by hand'), 'edited by hand'];
    });
    body.push(textarea);
  } else {
    body.push(el('p', { class: 'gene-text' }, [gene.text]));
  }

  const card = el('div', { class: `gene card edge-${gene.type}`, id: `gene-${gene.id}` }, [
    el('div', { class: 'gene-head' }, [badge(gene.type), typeSelect(gene), actions]),
    ...body,
    el('p', { class: 'muted small-text' }, [`why: ${gene.cues.join('; ')}`]),
  ]);
  if (state.mutatingId === gene.id) card.append(mutationPanel(gene));
  if (state.savingId === gene.id) card.append(savePanel(gene));
  return card;
}

function healthPanel(): HTMLElement {
  const findings = lintGenome(state.genes);
  const score = healthScore(findings);
  const list = el('ul', { class: 'findings' });
  for (const f of findings) {
    const item = el('li', { class: `finding sev-${f.severity}` }, [
      el('span', { class: 'sev-tag' }, [f.severity]),
      ` ${f.message}`,
    ]);
    if (f.geneIds.length > 0) {
      const jump = el('button', { class: 'link' }, ['show']);
      jump.addEventListener('click', () => {
        document
          .getElementById(`gene-${f.geneIds[0]}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      item.append(' ', jump);
    }
    list.append(item);
  }
  if (findings.length === 0) {
    list.append(el('li', { class: 'finding sev-clean' }, ['No findings: this genome is tight.']));
  }
  return el('div', { class: 'card' }, [
    el('h2', {}, [`Genome health: ${score}/100`]),
    el('div', { class: 'meter' }, [
      (() => {
        const bar = el('div', { class: 'meter-fill' });
        bar.style.width = `${score}%`;
        bar.style.background = score >= 80 ? 'var(--ok)' : score >= 50 ? 'var(--warn)' : 'var(--bad)';
        return bar;
      })(),
    ]),
    list,
  ]);
}

function diffPanel(): HTMLElement {
  const current = assemble(state.genes);
  const tokens = diffWords(state.original, current);
  const removedView = el('p', { class: 'diff-col' });
  const addedView = el('p', { class: 'diff-col' });
  for (const t of tokens) {
    if (t.kind !== 'added') {
      removedView.append(el('span', { class: t.kind === 'removed' ? 'tok-removed' : '' }, [t.text]), ' ');
    }
    if (t.kind !== 'removed') {
      addedView.append(el('span', { class: t.kind === 'added' ? 'tok-added' : '' }, [t.text]), ' ');
    }
  }
  return el('div', { class: 'card' }, [
    el('h2', {}, ['Original vs current']),
    el('div', { class: 'diff-grid' }, [
      el('div', {}, [el('h3', {}, ['As pasted']), removedView]),
      el('div', {}, [el('h3', {}, ['As edited']), addedView]),
    ]),
  ]);
}

function libraryPanel(): HTMLElement {
  const search = el('input', {
    type: 'search',
    placeholder: 'Search saved genes…',
    value: state.librarySearch,
  });
  search.addEventListener('input', () => {
    state.librarySearch = search.value;
    render();
  });

  const tagRow = el('div', { class: 'tag-row' });
  for (const tag of library.allTags()) {
    const b = el('button', { class: `chip ${state.libraryTag === tag ? 'chip-on' : ''}` }, [tag]);
    b.addEventListener('click', () => {
      state.libraryTag = state.libraryTag === tag ? null : tag;
      render();
    });
    tagRow.append(b);
  }

  const entries = library.search(state.librarySearch, state.libraryTag ? { tag: state.libraryTag } : {});
  const list = el('div', { class: 'lib-list' });
  for (const entry of entries) {
    const insert = el('button', { class: 'small primary' }, ['Insert']);
    insert.addEventListener('click', () => {
      state.genes.push(makeGene(entry.type, entry.text, ['from library']));
      render();
    });
    const del = el('button', { class: 'small danger' }, ['✕']);
    del.addEventListener('click', () => {
      library.remove(entry.id);
      render();
    });
    list.append(
      el('div', { class: 'lib-entry' }, [
        el('div', { class: 'lib-head' }, [
          badge(entry.type),
          el('span', { class: 'muted small-text' }, [entry.tags.map((t) => `#${t}`).join(' ')]),
          insert,
          del,
        ]),
        el('p', { class: 'small-text' }, [entry.text.length > 180 ? `${entry.text.slice(0, 180)}…` : entry.text]),
      ]),
    );
  }
  if (entries.length === 0) {
    list.append(el('p', { class: 'muted' }, ['Nothing saved yet. Use "Save" on any gene card.']));
  }
  return el('div', { class: 'card' }, [el('h2', {}, ['Gene library']), search, tagRow, list]);
}

function exportRow(): HTMLElement {
  const row = el('div', { class: 'export-row' });
  const make = (label: string, title: string, getText: () => string): void => {
    const b = el('button', { class: 'small', title }, [label]);
    b.addEventListener('click', () => copyToClipboard(getText(), b));
    row.append(b);
  };
  make('Copy prompt', 'The assembled prompt, ready to paste anywhere', () => assemble(state.genes));
  make('Copy Markdown', 'Genes grouped by type with headings', () => toMarkdown(state.genes));
  make('Copy JSON', 'Machine-readable genome for programmatic use', () => toJSON(state.genes));
  const share = el('button', { class: 'small', title: 'Read-only link; the genome travels in the URL itself' }, ['Share link']);
  share.addEventListener('click', () => {
    const url = `${location.origin}${location.pathname}${encodeShare(state.genes)}`;
    copyToClipboard(url, share);
  });
  row.append(share);
  const diffToggle = el('button', { class: `small ${state.diffOpen ? 'primary' : ''}` }, [
    state.diffOpen ? 'Hide diff' : 'Show diff',
  ]);
  diffToggle.addEventListener('click', () => {
    state.diffOpen = !state.diffOpen;
    render();
  });
  row.append(diffToggle);
  return row;
}

function legend(): HTMLElement {
  const row = el('div', { class: 'legend' });
  for (const t of GENE_TYPES) {
    row.append(el('span', { class: `chip badge-${t}`, title: GENE_META[t].blurb }, [GENE_META[t].label]));
  }
  return row;
}

function editorView(): HTMLElement {
  const wrap = el('div', {});

  const textarea = el('textarea', {
    class: 'prompt-input',
    placeholder: 'Paste a prompt here, or pick an example…',
  });
  textarea.value = state.input;
  textarea.addEventListener('input', () => {
    state.input = textarea.value;
  });

  const exampleSelect = el('select', { 'aria-label': 'Load an example' });
  exampleSelect.append(el('option', { value: '' }, ['Load an example…']));
  for (const ex of EXAMPLES) {
    exampleSelect.append(el('option', { value: ex.id }, [ex.label]));
  }
  exampleSelect.addEventListener('change', () => {
    const ex = getExample(exampleSelect.value);
    if (ex) {
      state.input = ex.text;
      sequence();
    }
  });

  const go = el('button', { class: 'primary' }, ['Sequence it']);
  const sequence = (): void => {
    state.original = state.input;
    state.genes = segmentPrompt(state.input);
    state.mutatingId = null;
    state.editingId = null;
    state.diffOpen = false;
    render();
  };
  go.addEventListener('click', sequence);

  wrap.append(
    el('div', { class: 'card' }, [
      textarea,
      el('div', { class: 'input-row' }, [go, exampleSelect]),
    ]),
  );

  if (state.genes.length > 0) {
    wrap.append(geneStrand());
    const cards = el('div', {});
    state.genes.forEach((g, i) => cards.append(geneCard(g, i)));
    wrap.append(exportRow(), cards);
    if (state.diffOpen) wrap.append(diffPanel());
    wrap.append(healthPanel());
  } else if (state.original !== '') {
    wrap.append(el('p', { class: 'muted' }, ['Nothing to sequence: the prompt is empty.']));
  }
  wrap.append(libraryPanel());
  return wrap;
}

function sharedView(genes: Gene[]): HTMLElement {
  const open = el('button', { class: 'primary' }, ['Open in editor']);
  open.addEventListener('click', () => {
    state.genes = genes;
    state.original = assemble(genes);
    state.input = state.original;
    history.replaceState(null, '', location.pathname);
    render();
  });
  const cards = el('div', {});
  for (const g of genes) {
    cards.append(
      el('div', { class: `gene card edge-${g.type}` }, [
        el('div', { class: 'gene-head' }, [badge(g.type)]),
        el('p', { class: 'gene-text' }, [g.text]),
      ]),
    );
  }
  return el('div', {}, [
    el('p', { class: 'muted' }, ['A shared genome, read-only. Nothing was fetched: it travelled inside the link.']),
    open,
    cards,
  ]);
}

function mountInto(root: HTMLElement): void {
  rootEl = root;
  root.replaceChildren();
  const header = el('header', {}, [
    el('div', { class: 'title-row' }, [el('h1', {}, ['🧬 Prompt Genome']), el('hw-theme-toggle', {}, [])]),
    el('p', { class: 'tagline' }, [
      'Every prompt is a strand of typed genes. Paste one, see its anatomy, lint it, mutate it, and keep the genes worth reusing. Deterministic and fully client-side: nothing leaves your browser.',
    ]),
    legend(),
  ]);
  root.append(header);

  const shared = decodeShare(location.hash);
  root.append(shared ? sharedView(shared) : editorView());

  root.append(
    el('footer', {}, [
      el('p', { class: 'muted small-text' }, [
        'Rule-based segmentation, template mutations, word-level LCS diff, localStorage library. No accounts, no API keys. ',
        el('a', { href: 'https://github.com/pisanuw/Claude-capstone/tree/main/prompt-genome' }, ['Source on GitHub']),
      ]),
    ]),
  );
}

export function mountApp(root: HTMLElement): void {
  mountInto(root);
}
