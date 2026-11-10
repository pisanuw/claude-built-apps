import type { Product } from '../core/model';
import { newProduct } from '../core/model';
import { categoryById, categoryGroups } from '../core/categories';
import { formatCode, isFullCode, type HtsLine } from '../core/hts';
import { importCsv, unitFactor, type Mapping } from '../core/importer';
import { gbp, pct, readNumber, usd } from '../core/money';
import { priceProduct, statusLabel, type PriceResult } from '../core/pricing';
import { parseRate, describeRate } from '../core/rates';
import { sampleCatalog } from '../core/sample';
import { h, field, readText } from './dom';
import type { Ctx } from './ctx';

let searchQuery = '';
let pendingImport: { text: string; mapping: Mapping | null } | null = null;

export function productsView(ctx: Ctx): HTMLElement {
  const { catalog } = ctx;
  const wrap = h('section', null, h('h2', null, 'Your products'));

  if (ctx.importing) {
    wrap.append(importPanel(ctx));
    return wrap;
  }
  const editing = ctx.editing ? catalog.products.find((p) => p.id === ctx.editing) : undefined;
  if (editing) {
    wrap.append(editor(ctx, editing));
    return wrap;
  }

  wrap.append(h('div', { class: 'actions' },
    h('button', { onclick: () => {
      const p = newProduct();
      catalog.products.push(p);
      ctx.editing = p.id;
      searchQuery = '';
      ctx.commit('');
    } }, 'Add a product'),
    h('button', { class: 'secondary', onclick: () => { ctx.importing = true; pendingImport = null; ctx.render(); } }, 'Import a product CSV'),
    !catalog.products.length && h('button', { class: 'secondary', onclick: () => {
      ctx.catalog = sampleCatalog(ctx.index, ctx.today);
      ctx.commit('Loaded a sample shop with ten products. Edit or clear it whenever you like.');
    } }, 'Try a sample shop'),
    catalog.products.length > 0 && h('button', { class: 'secondary danger', onclick: () => {
      if (typeof confirm === 'function' && !confirm('Remove every product from this browser? Download a backup first if you may want them back.')) return;
      catalog.products = [];
      catalog.snapshot = null;
      ctx.commit('All products removed.');
    } }, 'Remove all'),
  ));

  if (!catalog.products.length) {
    wrap.append(h('div', { class: 'empty' },
      h('p', null, 'Start by adding your products: a name, your UK price and the weight. Then pick a US code for each one. Common handmade product types come with suggested codes and their official wording, so you only have to confirm the right one.'),
      h('p', null, 'Already sell on Shopify, or keep a spreadsheet? Import a CSV with names, prices and weights.'),
    ));
    return wrap;
  }

  const rows = catalog.products.map((p) => ({ p, r: priceProduct(p, catalog.settings, ctx.index) }));
  const need = rows.filter(({ r }) => r.status !== 'ok').length;
  const unconfirmed = rows.filter(({ p }) => p.code && !p.confirmed).length;
  wrap.append(h('p', { class: 'hint' },
    `${rows.length} product${rows.length === 1 ? '' : 's'}. `,
    need ? `${need} still need${need === 1 ? 's' : ''} a code or rate. ` : 'Every product has a duty rate. ',
    unconfirmed ? `${unconfirmed} code${unconfirmed === 1 ? '' : 's'} not confirmed yet.` : ''));

  wrap.append(h('div', { class: 'tablewrap' }, h('table', null,
    h('thead', null, h('tr', null,
      h('th', { scope: 'col' }, 'Product'), h('th', { scope: 'col' }, 'US code'), h('th', { scope: 'col', class: 'num' }, 'Duty'),
      h('th', { scope: 'col', class: 'num' }, 'UK price'), h('th', { scope: 'col' }, 'Status'), h('th', { scope: 'col' }, h('span', { class: 'sr' }, 'Actions')))),
    h('tbody', null, rows.map(({ p, r }) => h('tr', null,
      h('th', { scope: 'row' }, p.title || h('em', null, 'Untitled'), p.sku ? h('span', { class: 'hint block' }, p.sku) : null),
      h('td', { class: 'code' }, p.code ? formatCode(p.code) : '–', p.confirmed ? h('span', { class: 'tick', title: 'Confirmed' }, ' ✓') : null),
      h('td', { class: 'num' }, r.dutyPercent === null ? '–' : pct(r.dutyPercent), r.specificDuty ? h('span', { class: 'hint block' }, `+ ${gbp(r.specificDuty)}`) : null),
      h('td', { class: 'num' }, gbp(p.price)),
      h('td', null, statusPill(r)),
      h('td', { class: 'rowactions' },
        h('button', { class: 'small', 'aria-label': `Edit ${p.title || 'product'}`, onclick: () => { ctx.editing = p.id; searchQuery = ''; ctx.render(); } }, 'Edit'),
        h('button', { class: 'small secondary', 'aria-label': `Delete ${p.title || 'product'}`, onclick: () => {
          catalog.products = catalog.products.filter((x) => x.id !== p.id);
          ctx.commit(`Removed ${p.title || 'the product'}.`);
        } }, 'Delete')),
    ))),
  )));
  return wrap;
}

export function statusPill(r: PriceResult): HTMLElement {
  const label = statusLabel(r);
  const cls = label === 'Ready' ? 'good' : label === 'Check' ? 'warn' : 'bad';
  return h('span', { class: `pill ${cls}` }, label);
}

function numberInput(value: number | null, onChange: (n: number | null) => void, attrs: Record<string, string> = {}): HTMLInputElement {
  const input = h('input', { type: 'text', inputmode: 'decimal', value: value === null ? '' : String(value), ...attrs });
  input.addEventListener('change', () => onChange(readNumber(input.value)));
  return input;
}

function editor(ctx: Ctx, p: Product): HTMLElement {
  const save = () => ctx.commit();
  const title = h('input', { type: 'text', value: p.title, autocomplete: 'off' });
  title.addEventListener('change', () => { p.title = title.value.trim(); save(); });
  const sku = h('input', { type: 'text', value: p.sku, autocomplete: 'off' });
  sku.addEventListener('change', () => { p.sku = sku.value.trim(); save(); });
  const notes = h('textarea', { rows: '2' }, p.notes);
  notes.addEventListener('change', () => { p.notes = notes.value; save(); });
  const ukMade = h('input', { type: 'checkbox', checked: p.ukMade });
  ukMade.addEventListener('change', () => { p.ukMade = ukMade.checked; save(); });
  const exempt = h('input', { type: 'checkbox', checked: p.layerExempt });
  exempt.addEventListener('change', () => { p.layerExempt = exempt.checked; save(); });

  const r = priceProduct(p, ctx.catalog.settings, ctx.index);
  return h('div', { class: 'editor' },
    h('div', { class: 'editorhead' },
      h('h3', null, p.title ? `Editing: ${p.title}` : 'New product'),
      h('button', { onclick: () => { ctx.editing = null; ctx.flash = p.title ? `Saved ${p.title}.` : ''; ctx.render(); } }, 'Done')),
    h('div', { class: 'grid2' },
      h('div', null,
        field('Product name', title),
        field('SKU (optional)', sku),
        field('UK selling price (£)', numberInput(p.price, (n) => { p.price = n ?? 0; save(); })),
        field('Weight of the item (grams)', numberInput(p.grams, (n) => { p.grams = Math.max(0, Math.round(n ?? 0)); save(); }), `Packaging (${ctx.catalog.settings.packagingGrams} g) is added from Settings.`),
        h('div', { class: 'check' }, ukMade, h('label', { for: (ukMade.id = 'uk-made') }, 'Made in the UK')),
        h('div', { class: 'check' }, exempt, h('label', { for: (exempt.id = 'layer-exempt') }, 'I have confirmed this product is exempt from the UK duty layer')),
        field('General rate set by hand (%, optional)', numberInput(p.manualRate, (n) => { p.manualRate = n; save(); }),
          'Only if the code\'s rate can\'t be worked out here, or you have a ruling. The UK layer is still added.'),
        field('Notes', notes),
      ),
      h('div', null, preview(ctx, p, r)),
    ),
    codeFinder(ctx, p),
  );
}

function preview(ctx: Ctx, p: Product, r: PriceResult): HTMLElement {
  const s = ctx.catalog.settings;
  return h('div', { class: 'preview', 'aria-live': 'polite' },
    h('h4', null, 'For this product'),
    h('dl', null,
      h('dt', null, 'US duty'), h('dd', null, r.dutyPercent === null ? '–' : `${pct(r.dutyPercent)} (${r.generalPercent === null ? '–' : pct(r.generalPercent)} + ${pct(r.layerPercent)} UK layer)`, r.specificDuty ? ` + ${gbp(r.specificDuty)}` : ''),
      h('dt', null, 'Duty on one at your UK price'), h('dd', null, gbp(r.dutyAtUkPrice)),
      h('dt', null, 'Postage band'), h('dd', null, r.band ? `${r.band.name} (${gbp(r.band.price)})` : '–', h('span', { class: 'hint block' }, `Parcel ${r.parcelGrams} g`)),
      h('dt', null, 'US postage with duty'), h('dd', null, gbp(r.usPostage), r.extraItemPostage !== null ? h('span', { class: 'hint block' }, `each extra item ${gbp(r.extraItemPostage)}`) : null),
      h('dt', null, 'Or a US price with duty in it'), h('dd', null, `${gbp(r.usPrice)} / ${usd(r.usPriceUsd)}`, h('span', { class: 'hint block' }, `postage then ${gbp(r.band?.price)}`)),
    ),
    warningsList(r),
    p.price <= 0 ? h('p', { class: 'hint bad' }, 'Enter your UK price to see figures.') : null,
    s.bandsAreExample ? h('p', { class: 'hint' }, 'Postage uses example prices until you enter yours in Settings.') : null,
  );
}

export function warningsList(r: PriceResult): HTMLElement | null {
  if (!r.warnings.length) return null;
  return h('ul', { class: 'warnings' }, r.warnings.map((w) => h('li', { class: w.level }, w.text)));
}

function codeFinder(ctx: Ctx, p: Product): HTMLElement {
  const box = h('section', { class: 'finder', 'aria-labelledby': 'finder-h' }, h('h3', { id: 'finder-h' }, 'US code'));
  const current = p.code && isFullCode(p.code) ? ctx.index.get(p.code) : null;

  if (current) {
    const confirmed = p.confirmed && p.confirmed.code === current.code;
    box.append(h('div', { class: `chosen${confirmed ? ' ok' : ''}` },
      h('p', null, h('strong', { class: 'code' }, current.code), ` · general rate ${current.general || '(blank)'}`),
      legal(current),
      confirmed
        ? h('p', { class: 'good' }, `Confirmed on ${p.confirmed!.on}. `, h('button', { class: 'linkish', onclick: () => { p.confirmed = null; ctx.commit(); } }, 'Undo'))
        : h('p', null, h('button', { onclick: () => {
          p.confirmed = { code: current.code, general: current.general, revision: ctx.index.data.revision, on: ctx.today };
          ctx.commit('Code confirmed.');
        } }, 'I’ve read the wording and it describes my product')),
      h('button', { class: 'secondary small', onclick: () => { p.code = ''; p.confirmed = null; ctx.commit(); } }, 'Clear the code'),
    ));
  } else if (p.code) {
    box.append(h('p', { class: 'hint bad' }, `${p.code} is not a code in the bundled data. Pick one below, or keep it and set the general rate by hand.`));
  }

  // Typed code.
  const typed = h('input', { type: 'text', value: p.code && !current ? p.code : '', placeholder: 'e.g. 6912.00.44.00', autocomplete: 'off', inputmode: 'numeric' });
  typed.addEventListener('change', () => {
    const v = typed.value.trim();
    p.code = isFullCode(v) ? formatCode(v) : v;
    p.confirmed = null;
    ctx.commit();
  });
  box.append(field('Know your code? Type all 10 digits', typed));

  // Category suggestions.
  const select = h('select', null,
    h('option', { value: '' }, '– choose what you make –'),
    categoryGroups().map((g) => h('optgroup', { label: g.group }, g.items.map((c) => h('option', { value: c.id, selected: c.id === p.categoryId ? 'selected' : null }, c.name)))));
  select.addEventListener('change', () => { p.categoryId = select.value; ctx.commit(); });
  box.append(field('Or choose what you make for suggested codes', select));
  const cat = categoryById(p.categoryId);
  if (cat) {
    box.append(h('ul', { class: 'candidates' }, cat.candidates.map((c) => {
      const line = ctx.index.get(c.code);
      return line ? candidateCard(ctx, p, line, c.when) : null;
    })));
  }

  // Free search.
  const search = h('input', { type: 'search', value: searchQuery, placeholder: 'e.g. candle, wool scarf, 6913', autocomplete: 'off' });
  const results = h('div');
  const run = () => {
    searchQuery = search.value;
    const hits = ctx.index.search(searchQuery, 25);
    results.replaceChildren(
      searchQuery.trim() ? h('p', { class: 'hint', role: 'status' }, hits.length ? `${hits.length === 25 ? 'First 25' : hits.length} matching line${hits.length === 1 ? '' : 's'}` : 'No lines match. Try a simpler word, such as "bag" or "ceramic".') : '',
      h('ul', { class: 'candidates' }, hits.map((line) => candidateCard(ctx, p, line, ''))));
  };
  search.addEventListener('change', run);
  search.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') { e.preventDefault(); run(); } });
  box.append(h('div', { class: 'searchrow' }, field('Or search the US tariff wording', search, `${ctx.index.size.toLocaleString('en-GB')} lines from the chapters handmade goods fall into.`),
    h('button', { class: 'secondary', onclick: run }, 'Search')), results);
  if (searchQuery) run();
  return box;
}

function legal(line: HtsLine): HTMLElement {
  return h('ol', { class: 'legal', 'aria-label': 'Official wording, from the heading down' }, line.chain.map((t) => h('li', null, t)));
}

function candidateCard(ctx: Ctx, p: Product, line: HtsLine, when: string): HTMLElement {
  const parsed = parseRate(line.general);
  const isCurrent = formatCode(p.code) === line.code;
  return h('li', { class: `candidate${isCurrent ? ' on' : ''}` },
    h('div', { class: 'cardhead' },
      h('strong', { class: 'code' }, line.code),
      h('span', { class: 'rate' }, parsed ? describeRate(parsed) : line.general || 'rate not shown'),
      isCurrent ? h('span', { class: 'pill good' }, 'Chosen') : h('button', { class: 'small', onclick: () => {
        p.code = line.code;
        p.confirmed = null;
        ctx.commit(`Code ${line.code} chosen. Read the wording and confirm it.`);
      } }, 'Use this code')),
    when ? h('p', { class: 'when' }, when) : null,
    h('details', null, h('summary', null, 'Official wording'), legal(line)),
  );
}

function importPanel(ctx: Ctx): HTMLElement {
  const panel = h('div', { class: 'editor' }, h('div', { class: 'editorhead' },
    h('h3', null, 'Import products from a CSV'),
    h('button', { class: 'secondary', onclick: () => { ctx.importing = false; pendingImport = null; ctx.render(); } }, 'Cancel')));
  panel.append(h('p', null, 'Use a Shopify product export, or any spreadsheet saved as CSV with a column for the product name, the price in pounds, and the weight. A column with US or HS codes and one with country of origin are used if present.'));

  const file = h('input', { type: 'file', accept: '.csv,text/csv' });
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    pendingImport = { text: await readText(f), mapping: null };
    ctx.render();
  });
  const paste = h('textarea', { rows: '4', placeholder: 'Title,Price,Weight (g)\nStoneware mug,28,420' });
  panel.append(field('Choose a CSV file', file), field('Or paste CSV text', paste),
    h('button', { class: 'secondary', onclick: () => { pendingImport = { text: paste.value, mapping: null }; ctx.render(); } }, 'Read pasted text'));

  if (pendingImport) {
    const res = importCsv(pendingImport.text, pendingImport.mapping ?? undefined);
    const m = res.mapping;
    const fields: [keyof Mapping, string][] = [['title', 'Product name'], ['price', 'UK price (£)'], ['weight', 'Weight'], ['sku', 'SKU'], ['code', 'US / HS code'], ['origin', 'Country of origin']];
    panel.append(h('h4', null, 'Columns'), h('div', { class: 'grid3' }, fields.map(([k, label]) => {
      const sel = h('select', null, h('option', { value: '-1' }, '– none –'), res.header.map((col, i) => h('option', { value: String(i), selected: m[k] === i ? 'selected' : null }, col || `Column ${i + 1}`)));
      sel.addEventListener('change', () => {
        const next = { ...m, [k]: Number(sel.value) };
        if (k === 'weight') next.weightToGrams = unitFactor(res.header[Number(sel.value)] ?? '');
        pendingImport = { text: pendingImport!.text, mapping: next };
        ctx.render();
      });
      return field(label, sel);
    })));
    panel.append(h('p', null, `${res.products.length} product${res.products.length === 1 ? '' : 's'} ready to add.`,
      m.weight >= 0 ? ` Weights read as ${m.weightToGrams === 1 ? 'grams' : m.weightToGrams === 1000 ? 'kilograms' : m.weightToGrams > 100 ? 'pounds' : 'ounces'}.` : ' No weight column: add weights after importing.'));
    if (res.skipped.length) panel.append(h('ul', { class: 'warnings' }, res.skipped.slice(0, 8).map((s) => h('li', { class: 'check' }, `Row ${s.row} skipped: ${s.reason}`))));
    if (res.products.length) {
      panel.append(h('div', { class: 'tablewrap' }, h('table', null,
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Product'), h('th', { scope: 'col', class: 'num' }, 'Price'), h('th', { scope: 'col', class: 'num' }, 'Grams'), h('th', { scope: 'col' }, 'Code'))),
        h('tbody', null, res.products.slice(0, 6).map((p) => h('tr', null, h('td', null, p.title), h('td', { class: 'num' }, gbp(p.price)), h('td', { class: 'num' }, p.grams), h('td', null, p.code || '–')))))),
      h('button', { onclick: () => {
        ctx.catalog.products.push(...res.products);
        ctx.importing = false;
        pendingImport = null;
        ctx.commit(`Added ${res.products.length} product${res.products.length === 1 ? '' : 's'}. Next, pick a US code for each one.`);
      } }, `Add ${res.products.length} product${res.products.length === 1 ? '' : 's'}`));
    }
  }
  return panel;
}
