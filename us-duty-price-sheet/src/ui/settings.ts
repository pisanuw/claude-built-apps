import { newId, exampleBands, type PriceEnding } from '../core/model';
import { readNumber } from '../core/money';
import { backupJson } from '../core/exports';
import { parseCatalog } from '../core/storage';
import { h, add, field, download, readText } from './dom';
import type { Ctx } from './ctx';

export function settingsView(ctx: Ctx): HTMLElement {
  const s = ctx.catalog.settings;
  const wrap = h('section', null, h('h2', null, 'Postage and settings'));

  // Postage bands.
  add(wrap, h('h3', null, 'Your US postage prices'),
    h('p', null, 'Enter what Royal Mail charges you for a duty-paid parcel to the US in each weight step. The quickest way is to price a test parcel in Click & Drop. Weights are for the whole parcel, packaging included.'),
    s.bandsAreExample ? h('p', { class: 'banner warn' }, 'The prices below are made-up examples so the sheet has something to show. They are not Royal Mail’s prices.') : null);

  const markEdited = () => { s.bandsAreExample = false; ctx.commit(); };
  const table = h('table', { class: 'bands' },
    h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Name'), h('th', { scope: 'col', class: 'num' }, 'Up to (g)'), h('th', { scope: 'col', class: 'num' }, 'Label price (£)'), h('th', { scope: 'col' }, h('span', { class: 'sr' }, 'Remove')))),
    h('tbody', null, s.bands.map((b, i) => {
      const name = h('input', { type: 'text', value: b.name, 'aria-label': `Band ${i + 1} name` });
      name.addEventListener('change', () => { b.name = name.value; markEdited(); });
      const grams = h('input', { type: 'text', inputmode: 'numeric', value: String(b.maxGrams), 'aria-label': `Band ${i + 1} weight limit in grams` });
      grams.addEventListener('change', () => { b.maxGrams = Math.max(0, Math.round(readNumber(grams.value) ?? 0)); markEdited(); });
      const price = h('input', { type: 'text', inputmode: 'decimal', value: b.price.toFixed(2), 'aria-label': `Band ${i + 1} price in pounds` });
      price.addEventListener('change', () => { b.price = Math.max(0, readNumber(price.value) ?? 0); markEdited(); });
      return h('tr', null, h('td', null, name), h('td', { class: 'num' }, grams), h('td', { class: 'num' }, price),
        h('td', null, h('button', { class: 'small secondary', 'aria-label': `Remove ${b.name}`, onclick: () => { s.bands = s.bands.filter((x) => x.id !== b.id); markEdited(); } }, 'Remove')));
    })));
  wrap.append(h('div', { class: 'tablewrap' }, table), h('div', { class: 'actions' },
    h('button', { class: 'secondary', onclick: () => {
      const last = [...s.bands].sort((a, b) => a.maxGrams - b.maxGrams).pop();
      s.bands.push({ id: newId('b'), name: 'New band', maxGrams: (last?.maxGrams ?? 0) + 250, price: last?.price ?? 0 });
      markEdited();
    } }, 'Add a band'),
    s.bandsAreExample ? h('button', { class: 'secondary', onclick: () => { s.bandsAreExample = false; ctx.commit('Marked as your own prices.'); } }, 'These are my real prices') : null,
    !s.bandsAreExample ? h('button', { class: 'secondary', onclick: () => { s.bands = exampleBands(); s.bandsAreExample = true; ctx.commit('Example bands restored.'); } }, 'Start again from examples') : null,
  ));

  // Other settings.
  const num = (label: string, value: number, set: (n: number) => void, hint?: string) => {
    const input = h('input', { type: 'text', inputmode: 'decimal', value: String(value) });
    input.addEventListener('change', () => { const n = readNumber(input.value); if (n !== null && n >= 0) { set(n); ctx.commit(); } else ctx.render(); });
    return field(label, input, hint);
  };
  const shop = h('input', { type: 'text', value: s.shopName });
  shop.addEventListener('change', () => { s.shopName = shop.value.trim(); ctx.commit(); });
  const ending = h('select', null, ([['0.00', 'Whole pounds (£24.00)'], ['0.99', 'Ending in .99 (£23.99)'], ['0.95', 'Ending in .95'], ['0.50', 'Ending in .50'], ['none', 'To the penny']] as [PriceEnding, string][])
    .map(([v, l]) => h('option', { value: v, selected: s.priceEnding === v ? 'selected' : null }, l)));
  ending.addEventListener('change', () => { s.priceEnding = ending.value as PriceEnding; ctx.commit(); });
  const step = h('select', null, ([[0, 'To the penny'], [0.1, 'Next 10p'], [0.5, 'Next 50p'], [1, 'Next whole pound']] as [number, string][])
    .map(([v, l]) => h('option', { value: String(v), selected: s.postageStep === v ? 'selected' : null }, l)));
  step.addEventListener('change', () => { s.postageStep = Number(step.value); ctx.commit(); });

  wrap.append(h('h3', null, 'Other settings'), h('div', { class: 'grid3' },
    field('Shop name (optional)', shop),
    num('Royal Mail handling fee per parcel (£)', s.handlingFee, (n) => { s.handlingFee = n; }, 'Royal Mail publishes 50p for duty-paid US parcels. Check your account.'),
    num('Packaging weight (g)', s.packagingGrams, (n) => { s.packagingGrams = Math.round(n); }, 'Added to every product to pick the postage band.'),
    num('US dollars per pound', s.usdPerGbp, (n) => { if (n > 0) s.usdPerGbp = n; }, 'For dollar prices and weight-based duties. Use the rate your shop or bank uses.'),
    field('Round US prices up to', ending),
    field('Round US postage up to', step),
  ));

  // Backup.
  const restore = h('input', { type: 'file', accept: '.json,application/json' });
  restore.addEventListener('change', async () => {
    const f = restore.files?.[0];
    if (!f) return;
    try {
      ctx.catalog = parseCatalog(await readText(f));
      ctx.commit(`Restored ${ctx.catalog.products.length} products from ${f.name}.`);
    } catch (e) {
      ctx.flash = `Could not restore: ${(e as Error).message}`;
      ctx.render();
    }
  });
  wrap.append(h('h3', null, 'Backup'),
    h('p', null, 'Your catalogue lives in this browser only. Download a backup now and then, and to move to another computer.'),
    h('div', { class: 'actions' },
      h('button', { onclick: () => {
        const ok = download(`us-duty-price-sheet-${ctx.today}.json`, backupJson(ctx.catalog), 'application/json');
        ctx.flash = ok ? 'Backup downloaded.' : 'This browser could not start the download.';
        ctx.render();
      } }, 'Download a backup')),
    field('Restore from a backup', restore));
  return wrap;
}
