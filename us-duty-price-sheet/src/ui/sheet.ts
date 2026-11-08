import { formatCode } from '../core/hts';
import { gbp, pct, readNumber, usd } from '../core/money';
import { layerPercent, priceAll } from '../core/pricing';
import { postageTableCsv, priceSheetCsv, usPriceListCsv } from '../core/exports';
import { takeSnapshot } from '../core/changes';
import { UK_LAYER } from '../core/layer';
import { h, add, download, field } from './dom';
import { statusPill, warningsList } from './products';
import type { Ctx } from './ctx';

export function sheetView(ctx: Ctx): HTMLElement {
  const { catalog } = ctx;
  const s = catalog.settings;
  const wrap = h('section', null, h('h2', null, 'US price sheet'));
  if (!catalog.products.length) {
    wrap.append(h('p', null, 'Add products first, then come back here for the table.'),
      h('button', { onclick: () => ctx.go('products') }, 'Go to your products'));
    return wrap;
  }

  // How duty is passed on.
  const radios = h('fieldset', { class: 'mode' }, h('legend', null, 'How do you pass US duty on to your customer?'),
    ([['postage', 'Add it to US postage', 'Keep one price for everyone; US postage covers the label, the duty and Royal Mail’s handling fee. Suits Folksy postage profiles.'],
      ['price', 'Build it into a US price', 'Charge US buyers a higher item price that covers the duty; postage is just the label. Suits shops with a separate US price.']] as const)
      .map(([value, label, hint]) => {
        const id = `mode-${value}`;
        const input = h('input', { type: 'radio', name: 'mode', id, value, checked: s.mode === value });
        input.addEventListener('change', () => { s.mode = value; ctx.commit(); });
        return h('div', { class: 'radio' }, input, h('label', { for: id }, h('strong', null, label), h('span', { class: 'hint block' }, hint)));
      }));

  // What-if UK layer.
  const layerInput = h('input', { type: 'text', inputmode: 'decimal', value: String(layerPercent(s)) });
  layerInput.addEventListener('change', () => {
    const n = readNumber(layerInput.value);
    s.layerOverride = n === null || n === UK_LAYER.percent ? null : n;
    ctx.commit(s.layerOverride === null ? 'Back to the current UK layer.' : `Showing your prices if the UK layer were ${s.layerOverride}%.`);
  });
  const whatIf = h('div', { class: 'whatif' },
    field('UK duty layer (%)', layerInput, `Currently ${UK_LAYER.percent}% under heading ${UK_LAYER.heading}. Change it to see what a new rate would do to your prices.`),
    s.layerOverride !== null ? h('button', { class: 'secondary small', onclick: () => { s.layerOverride = null; ctx.commit('Back to the current UK layer.'); } }, `Reset to ${UK_LAYER.percent}%`) : null);

  wrap.append(h('div', { class: 'grid2 controls' }, radios, whatIf));
  if (s.layerOverride !== null) wrap.append(h('div', { class: 'banner warn' }, `What-if: these figures use a ${s.layerOverride}% UK layer, not the current ${UK_LAYER.percent}%.`));

  const rows = priceAll(catalog.products, s, ctx.index);
  const postage = s.mode === 'postage';
  wrap.append(h('div', { class: 'tablewrap' }, h('table', { class: 'sheet' },
    h('caption', null, postage ? 'US postage with duty included' : 'US prices with duty included'),
    h('thead', null, h('tr', null,
      h('th', { scope: 'col' }, 'Product'), h('th', { scope: 'col' }, 'US code'), h('th', { scope: 'col', class: 'num' }, 'Duty'),
      h('th', { scope: 'col', class: 'num' }, 'UK price'), h('th', { scope: 'col' }, 'Band'),
      postage ? [h('th', { scope: 'col', class: 'num' }, 'US postage'), h('th', { scope: 'col', class: 'num' }, 'Each extra item')]
        : [h('th', { scope: 'col', class: 'num' }, 'US price £'), h('th', { scope: 'col', class: 'num' }, 'US price $'), h('th', { scope: 'col', class: 'num' }, 'US postage')],
      h('th', { scope: 'col' }, 'Status'))),
    h('tbody', null, rows.map(({ product: p, result: r }) => {
      const issues = r.warnings.filter((w) => w.level !== 'info');
      return h('tr', null,
        h('th', { scope: 'row' }, p.title || 'Untitled', issues.length ? h('details', { class: 'rowwarn' }, h('summary', null, `${issues.length} note${issues.length === 1 ? '' : 's'}`), warningsList({ ...r, warnings: issues })) : null),
        h('td', { class: 'code' }, p.code ? formatCode(p.code) : '–'),
        h('td', { class: 'num' }, pct(r.dutyPercent), r.specificDuty ? h('span', { class: 'hint block' }, `+ ${gbp(r.specificDuty)}`) : null),
        h('td', { class: 'num' }, gbp(p.price)),
        h('td', { class: 'band' }, r.band?.name ?? h('span', { class: 'bad' }, 'Too heavy')),
        postage ? [h('td', { class: 'num strong' }, gbp(r.usPostage)), h('td', { class: 'num' }, gbp(r.extraItemPostage))]
          : [h('td', { class: 'num strong' }, gbp(r.usPrice)), h('td', { class: 'num' }, usd(r.usPriceUsd)), h('td', { class: 'num' }, gbp(r.band?.price))],
        h('td', null, statusPill(r)));
    })),
  )));

  wrap.append(h('p', { class: 'hint' }, postage
    ? `US postage = your label price for the band + duty on the item at your UK price + Royal Mail's ${gbp(s.handlingFee)} handling fee, rounded up${s.postageStep ? ` to the next ${gbp(s.postageStep)}` : ''}. "Each extra item" adds the duty on one more item; a heavier parcel may also move up a band.`
    : `US price = (UK price + Royal Mail's ${gbp(s.handlingFee)} handling fee) ÷ (1 − duty rate), so that after duty on the higher price you still keep your UK price. Rounded up to end in ${s.priceEnding === 'none' ? 'any pence' : s.priceEnding.slice(1)}. Dollar prices use £1 = $${s.usdPerGbp}.`));

  wrap.append(h('h3', null, 'Copy it into your shop'), h('div', { class: 'actions' },
    h('button', { onclick: () => fileOut(ctx, 'us-postage-table.csv', postageTableCsv(catalog, ctx.index)) }, 'Download postage table (CSV)'),
    h('button', { onclick: () => fileOut(ctx, 'us-price-list.csv', usPriceListCsv(catalog, ctx.index)) }, 'Download US price list (CSV)'),
    h('button', { class: 'secondary', onclick: () => fileOut(ctx, 'us-duty-price-sheet.csv', priceSheetCsv(catalog, ctx.index)) }, 'Download the full sheet (CSV)'),
    h('button', { class: 'secondary', onclick: () => { if (typeof window.print === 'function') window.print(); } }, 'Print'),
  ));

  add(wrap, h('h3', null, 'Done updating your shop?'),
    h('p', null, 'Save today’s figures as what your shop shows. Next time US duty, your postage prices or your products change, What changed will list exactly which prices to update.'),
    h('button', { disabled: s.layerOverride !== null ? true : null, onclick: () => {
      catalog.snapshot = takeSnapshot(catalog, ctx.index, ctx.today);
      ctx.commit(`Saved: your shop matches this sheet as of ${ctx.today}.`);
    } }, 'My shop now shows these prices'),
    s.layerOverride !== null ? h('p', { class: 'hint' }, 'Reset the what-if layer first: the saved figures should be the real ones.') : null,
    catalog.snapshot ? h('p', { class: 'hint' }, `Last saved on ${catalog.snapshot.on}.`) : null);
  return wrap;
}

function fileOut(ctx: Ctx, name: string, text: string): void {
  const ok = download(name, text);
  ctx.flash = ok ? `Downloaded ${name}.` : 'This browser could not start the download.';
  ctx.render();
}
