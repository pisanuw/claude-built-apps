import { compareWithSnapshot, historyForCodes, takeSnapshot } from '../core/changes';
import type { RateChange } from '../core/hts';
import { UK_LAYER, UK_LAYER_HISTORY } from '../core/layer';
import { gbp, pct, ukDate } from '../core/money';
import { reminderIcs } from '../core/exports';
import { h, download } from './dom';
import type { Ctx } from './ctx';

const APP_URL = 'https://us-duty-price-sheet.hintwise.org';

export function changesView(ctx: Ctx, notice: { from: string; affected: RateChange[] } | null): HTMLElement {
  const { catalog } = ctx;
  const wrap = h('section', null, h('h2', null, 'What changed'));

  if (notice) {
    wrap.append(h('div', { class: 'banner warn' },
      h('strong', null, `Tariff data updated from ${notice.from} to ${ctx.index.data.revision}. `),
      notice.affected.length ? `${notice.affected.length} rate change${notice.affected.length === 1 ? '' : 's'} touch your codes (listed below).` : 'None of your saved codes changed rate.'));
  }

  const report = compareWithSnapshot(catalog, ctx.index);
  if (!report) {
    wrap.append(
      h('p', null, 'This page tells you which prices in your shop are out of date. To use it, first copy your US price sheet into your shop, then save today’s figures.'),
      catalog.products.length
        ? h('button', { onclick: () => { catalog.snapshot = takeSnapshot(catalog, ctx.index, ctx.today); ctx.commit(`Saved today’s figures (${ctx.today}).`); } }, 'My shop shows the current sheet: save it')
        : h('button', { onclick: () => ctx.go('products') }, 'Add your products first'));
  } else {
    const mode = catalog.settings.mode;
    wrap.append(h('p', null, `Compared with what your shop showed on ${report.since.on} (${report.since.revision}, UK layer ${report.since.layer}%).`));
    if (!report.changes.length) {
      wrap.append(h('p', { class: 'good strong' }, `Nothing to update: all ${report.unchanged} product${report.unchanged === 1 ? '' : 's'} still match your shop.`));
    } else {
      wrap.append(h('p', { class: 'strong' }, `${report.changes.length} product${report.changes.length === 1 ? '' : 's'} to update in your shop${report.unchanged ? `, ${report.unchanged} unchanged` : ''}.`));
      wrap.append(h('div', { class: 'tablewrap' }, h('table', null,
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Product'), h('th', { scope: 'col' }, 'Why'),
          h('th', { scope: 'col', class: 'num' }, mode === 'postage' ? 'US postage was' : 'US price was'),
          h('th', { scope: 'col', class: 'num' }, 'Now'))),
        h('tbody', null, report.changes.map((c) => {
          const pick = (i: typeof c.before) => (i ? (mode === 'postage' ? i.usPostage : i.usPrice) : null);
          const was = pick(c.before);
          const now = pick(c.after);
          const diff = was !== null && now !== null ? now - was : null;
          return h('tr', null,
            h('th', { scope: 'row' }, c.title || 'Untitled', c.kind !== 'changed' ? h('span', { class: `pill ${c.kind === 'new' ? 'good' : 'warn'}` }, c.kind === 'new' ? 'New' : 'Removed') : null),
            h('td', null, h('ul', { class: 'plain' }, c.reasons.map((r) => h('li', null, r)))),
            h('td', { class: 'num' }, gbp(was), c.before ? h('span', { class: 'hint block' }, `duty ${pct(c.before.dutyPercent)}`) : null),
            h('td', { class: 'num strong' }, gbp(now), diff !== null && Math.abs(diff) > 0.004 ? h('span', { class: `block ${diff > 0 ? 'bad' : 'good'}` }, `${diff > 0 ? '+' : '−'}${gbp(Math.abs(diff))}`) : null,
              c.after ? h('span', { class: 'hint block' }, `duty ${pct(c.after.dutyPercent)}`) : null));
        })))));
      wrap.append(h('button', { onclick: () => { catalog.snapshot = takeSnapshot(catalog, ctx.index, ctx.today); ctx.commit('Saved: your shop now matches the sheet.'); } }, 'I’ve updated these in my shop'));
    }
  }

  // Bundled rate history for the maker's codes.
  const hist = historyForCodes(ctx.history, catalog.products.map((p) => p.code));
  wrap.append(h('h3', null, 'Rate changes for your codes'),
    hist.length
      ? h('ul', null, hist.map((x) => h('li', null, `${x.code}: ${x.before || 'blank'} → ${x.after || 'blank'} (${x.revision}, from ${ukDate(x.date)})`)))
      : h('p', { class: 'hint' }, `No general-rate changes recorded for your codes since this app started tracking (${ctx.index.data.revisionTitle}).`));

  wrap.append(h('h3', null, 'The UK duty layer'),
    h('p', null, `Goods made in the UK pay an extra ${UK_LAYER.percent}% on top of each code's general rate (heading ${UK_LAYER.heading}, ${UK_LAYER.authority}, since ${ukDate(UK_LAYER.since)}). ${UK_LAYER.exemptions}`),
    h('div', { class: 'tablewrap' }, h('table', null,
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'From'), h('th', { scope: 'col' }, 'To'), h('th', { scope: 'col', class: 'num' }, 'Extra duty'), h('th', { scope: 'col' }, 'Under'))),
      h('tbody', null, UK_LAYER_HISTORY.map((p) => h('tr', null, h('td', null, ukDate(p.from)), h('td', null, p.to ? ukDate(p.to) : 'now'), h('td', { class: 'num' }, `${p.percent}%`), h('td', null, p.authority)))))),
    h('p', { class: 'hint' }, `Checked on ${UK_LAYER.checked} against the official US tariff schedule.`));

  wrap.append(h('h3', null, 'A monthly reminder'),
    h('p', null, 'Add a monthly reminder to your calendar to open this page and check for changes.'),
    h('button', { class: 'secondary', onclick: () => {
      const ok = download('us-duty-check.ics', reminderIcs(ctx.today, APP_URL), 'text/calendar');
      ctx.flash = ok ? 'Downloaded a monthly calendar reminder.' : 'This browser could not start the download.';
      ctx.render();
    } }, 'Download calendar reminder'));
  return wrap;
}
