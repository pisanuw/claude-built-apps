import { emptyCatalog } from '../core/model';
import type { HtsIndex, RateChange } from '../core/hts';
import { load, save, type Store } from '../core/storage';
import { revisionNotice } from '../core/changes';
import { UK_LAYER } from '../core/layer';
import { layerPercent } from '../core/pricing';
import { ukDate } from '../core/money';
import { h } from './dom';
import type { Ctx, Tab } from './ctx';
import { productsView } from './products';
import { sheetView } from './sheet';
import { changesView } from './changesView';
import { settingsView } from './settings';
import { aboutView } from './about';

export interface MountOptions {
  index: HtsIndex;
  history: RateChange[];
  store: Store | null;
  today?: string;
}

const TABS: [Tab, string][] = [
  ['products', 'Your products'],
  ['sheet', 'US price sheet'],
  ['changes', 'What changed'],
  ['settings', 'Postage and settings'],
  ['about', 'How it works'],
];

export function mount(root: HTMLElement, opts: MountOptions): Ctx {
  const loaded = load(opts.store);
  const catalog = loaded.catalog ?? emptyCatalog();
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  // Work out the "tariff data changed" notice before recording this visit.
  const notice = revisionNotice(catalog, opts.index, opts.history);

  const ctx: Ctx = {
    catalog,
    index: opts.index,
    history: opts.history,
    store: opts.store,
    today,
    tab: 'products',
    editing: null,
    importing: false,
    flash: loaded.error ? `Your saved catalogue could not be read (${loaded.error}). Restore a backup from Postage and settings.` : '',
    saveFailed: false,
    commit(message) {
      if (!ctx.catalog.lastSeenRevision) ctx.catalog.lastSeenRevision = ctx.index.data.revision;
      ctx.saveFailed = !save(ctx.store, ctx.catalog);
      if (message !== undefined) ctx.flash = message;
      ctx.render();
    },
    render() {
      draw();
    },
    go(tab) {
      ctx.tab = tab;
      ctx.editing = null;
      ctx.importing = false;
      ctx.flash = '';
      draw();
      root.querySelector<HTMLElement>('main')?.focus();
    },
  };

  if (catalog.products.length && catalog.lastSeenRevision !== opts.index.data.revision) {
    catalog.lastSeenRevision = opts.index.data.revision;
    save(opts.store, catalog);
  }

  function header(): HTMLElement {
    const d = opts.index.data;
    return h('header', null,
      h('h1', null, 'US Duty Price Sheet'),
      h('p', { class: 'lede' }, 'For UK makers who post to US customers with Royal Mail, duty paid. Keep a US code for every product, get a US price and postage table you can copy into your shop, and see which prices need changing when US duty changes.'),
      h('p', { class: 'privacy' }, 'Your catalogue stays in this browser. Nothing is uploaded.'),
      h('p', { class: 'datastamp' },
        `US tariff data: ${d.revisionTitle}, in force from ${ukDate(d.revisionStart)}. `,
        `UK duty layer: ${layerPercent(ctx.catalog.settings)}%${ctx.catalog.settings.layerOverride !== null ? ' (your what-if figure)' : ` (heading ${UK_LAYER.heading}, since ${ukDate(UK_LAYER.since)})`}.`),
    );
  }

  function banners(): HTMLElement[] {
    const out: HTMLElement[] = [];
    if (notice && ctx.tab !== 'changes') {
      const n = notice.affected.length;
      out.push(h('div', { class: 'banner warn', role: 'status' },
        h('strong', null, 'The US tariff data has been updated. '),
        n ? `${n} rate change${n === 1 ? '' : 's'} touch your products. ` : 'None of your saved codes changed rate. ',
        h('button', { class: 'linkish', onclick: () => ctx.go('changes') }, 'See what changed'),
      ));
    }
    if (ctx.catalog.settings.bandsAreExample && ctx.catalog.products.length) {
      out.push(h('div', { class: 'banner warn' },
        h('strong', null, 'Postage prices are examples, not Royal Mail’s. '),
        'Enter what Click & Drop charges you for US duty-paid parcels before you copy any postage into your shop. ',
        h('button', { class: 'linkish', onclick: () => ctx.go('settings') }, 'Enter your postage prices'),
      ));
    }
    if (ctx.saveFailed || !opts.store) {
      out.push(h('div', { class: 'banner bad', role: 'alert' }, 'This browser is not saving your catalogue (private window or storage blocked). Download a backup from Postage and settings before you close the page.'));
    }
    return out;
  }

  function nav(): HTMLElement {
    return h('nav', { 'aria-label': 'Sections' }, h('ol', null, TABS.map(([id, label]) =>
      h('li', null, h('button', {
        class: `tab${ctx.tab === id ? ' on' : ''}`,
        'aria-current': ctx.tab === id ? 'page' : null,
        onclick: () => ctx.go(id),
      }, label)))));
  }

  function body(): HTMLElement {
    switch (ctx.tab) {
      case 'sheet': return sheetView(ctx);
      case 'changes': return changesView(ctx, notice);
      case 'settings': return settingsView(ctx);
      case 'about': return aboutView(ctx);
      default: return productsView(ctx);
    }
  }

  function draw(): void {
    const scrollY = typeof window !== 'undefined' ? window.scrollY : 0;
    root.replaceChildren(
      header(),
      ...banners(),
      nav(),
      ctx.flash ? h('p', { class: 'flash', role: 'status' }, ctx.flash) : h('p', { class: 'flash', role: 'status' }),
      h('main', { tabindex: '-1' }, body()),
      h('p', { class: 'disclaimer' }, 'Estimates only, not a customs ruling. As the sender of a duty-paid parcel you are responsible for the code and value you declare. Check codes on hts.usitc.gov.'),
    );
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function' && scrollY) {
      try { window.scrollTo(0, scrollY); } catch { /* jsdom */ }
    }
  }

  draw();
  return ctx;
}
