// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { index, memoryStore, tinyIndex } from './helpers';
import { mount } from '../src/ui/app';
import { STORAGE_KEY, parseCatalog } from '../src/core/storage';
import { sampleCatalog } from '../src/core/sample';
import { emptyCatalog, newProduct } from '../src/core/model';
import { download } from '../src/ui/dom';
import type { RateChange } from '../src/core/hts';

let root: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  root = document.getElementById('app')!;
});

const text = () => root.textContent ?? '';
function button(label: string | RegExp): HTMLButtonElement {
  const all = [...root.querySelectorAll('button')];
  const b = all.find((x) => (typeof label === 'string' ? x.textContent?.trim() === label : label.test(x.textContent ?? '') || label.test(x.getAttribute('aria-label') ?? '')));
  if (!b) throw new Error(`No button ${label}. Have: ${all.map((x) => x.textContent).join(' | ')}`);
  return b;
}
const click = (label: string | RegExp) => button(label).click();
function inputByLabel(label: string | RegExp): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  const l = [...root.querySelectorAll('label')].find((x) => (typeof label === 'string' ? x.textContent?.trim() === label : label.test(x.textContent ?? '')));
  if (!l) throw new Error(`No label ${label}`);
  return document.getElementById(l.htmlFor) as HTMLInputElement;
}
function setValue(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, v: string) {
  el.value = v;
  el.dispatchEvent(new Event('change'));
}
const saved = (store: ReturnType<typeof memoryStore>) => parseCatalog(store.map.get(STORAGE_KEY)!);

function start(store = memoryStore(), opts: { history?: RateChange[]; idx?: typeof index } = {}) {
  const ctx = mount(root, { index: opts.idx ?? index, history: opts.history ?? [], store, today: '2026-11-08' });
  return { store, ctx };
}

describe('first visit', () => {
  it('explains itself and loads a sample shop', () => {
    const { store } = start();
    expect(text()).toMatch(/UK makers who post to US customers/);
    expect(text()).toMatch(/Revision 22 \(2026\)/);
    expect(text()).toMatch(/UK duty layer: 10%/);
    click('Try a sample shop');
    expect(root.querySelectorAll('tbody tr')).toHaveLength(10);
    expect(text()).toMatch(/Postage prices are examples/);
    expect(text()).toMatch(/1 still needs a code/);
    expect(saved(store).products).toHaveLength(10);
  });

  it('warns when the browser will not save', () => {
    mount(root, { index, history: [], store: null, today: '2026-11-08' });
    expect(text()).toMatch(/not saving your catalogue/);
  });

  it('reports a corrupt saved catalogue', () => {
    start(memoryStore({ [STORAGE_KEY]: '{bad json' }));
    expect(text()).toMatch(/could not be read/);
  });
});

describe('products', () => {
  it('adds a product, picks a suggested code and confirms it', () => {
    const { store } = start();
    click('Add a product');
    expect(text()).toMatch(/New product/);
    setValue(inputByLabel('Product name'), 'Blue mug');
    setValue(inputByLabel('UK selling price (£)'), '£28');
    setValue(inputByLabel('Weight of the item (grams)'), '420');
    setValue(inputByLabel('Or choose what you make for suggested codes'), 'mug-stoneware');
    expect(text()).toMatch(/6912\.00\.44\.00/);
    click('Use this code');
    expect(text()).toMatch(/Code 6912\.00\.44\.00 chosen/);
    expect(text()).toMatch(/Code not confirmed yet/);
    click(/I.ve read the wording/);
    expect(text()).toMatch(/Confirmed on 2026-11-08/);
    expect(text()).toMatch(/20%/);
    const p = saved(store).products[0];
    expect(p).toMatchObject({ title: 'Blue mug', price: 28, grams: 420, code: '6912.00.44.00' });
    expect(p.confirmed?.general).toBe('10%');
    click('Undo');
    expect(saved(store).products[0].confirmed).toBeNull();
    click('Done');
    expect(text()).toMatch(/Saved Blue mug/);
    expect(root.querySelector('tbody th')?.textContent).toMatch(/Blue mug/);
  });

  it('searches the tariff wording, types a code and sets other fields', () => {
    const { store } = start();
    click('Add a product');
    const search = inputByLabel('Or search the US tariff wording') as HTMLInputElement;
    search.value = 'candles';
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(text()).toMatch(/3406\.00\.00\.00/);
    search.value = 'zzzzqqq';
    click('Search');
    expect(text()).toMatch(/No lines match/);
    setValue(inputByLabel('Know your code? Type all 10 digits'), '3406000000');
    expect(saved(store).products[0].code).toBe('3406.00.00.00');
    click('Clear the code');
    setValue(inputByLabel('Know your code? Type all 10 digits'), '9999.99.99.99');
    expect(text()).toMatch(/not a code in the bundled data/);
    setValue(inputByLabel(/General rate set by hand/), '4');
    setValue(inputByLabel('SKU (optional)'), 'X1');
    setValue(inputByLabel('Notes'), 'note');
    (inputByLabel('Made in the UK') as HTMLInputElement).checked = false;
    inputByLabel('Made in the UK').dispatchEvent(new Event('change'));
    (inputByLabel(/exempt from the UK duty layer/) as HTMLInputElement).checked = true;
    inputByLabel(/exempt from the UK duty layer/).dispatchEvent(new Event('change'));
    const p = saved(store).products[0];
    expect(p).toMatchObject({ manualRate: 4, sku: 'X1', notes: 'note', ukMade: false, layerExempt: true });
    expect(text()).toMatch(/Not made in the UK/);
  });

  it('edits, deletes and removes all', () => {
    const { store } = start();
    click('Try a sample shop');
    click(/Edit Speckled stoneware mug/);
    expect(text()).toMatch(/Editing: Speckled stoneware mug/);
    expect(text()).toMatch(/Chosen/);
    click('Done');
    click(/Delete Speckled stoneware mug/);
    expect(saved(store).products).toHaveLength(9);
    vi.stubGlobal('confirm', () => false);
    click('Remove all');
    expect(saved(store).products).toHaveLength(9);
    vi.stubGlobal('confirm', () => true);
    click('Remove all');
    expect(saved(store).products).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it('imports pasted CSV with a column change', () => {
    const { store } = start();
    click('Import a product CSV');
    setValue(inputByLabel('Or paste CSV text'), 'Name,Price,Weight (kg),Other\nJug,24,0.5,x\n,3,1,y');
    click('Read pasted text');
    expect(text()).toMatch(/1 product ready to add/);
    expect(text()).toMatch(/Weights read as kilograms/);
    expect(text()).toMatch(/Row 3 skipped/);
    setValue(inputByLabel('Weight'), '-1');
    expect(text()).toMatch(/No weight column/);
    setValue(inputByLabel('Weight'), '2');
    click('Add 1 product');
    expect(saved(store).products[0]).toMatchObject({ title: 'Jug', price: 24, grams: 500 });
    click('Import a product CSV');
    click('Cancel');
    expect(text()).toMatch(/Your products/);
  });

  it('imports a chosen file', async () => {
    const { store } = start();
    click('Import a product CSV');
    const input = inputByLabel('Choose a CSV file') as HTMLInputElement;
    const file = new File(['Title,Price\nBowl,30'], 'p.csv', { type: 'text/csv' });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(text()).toMatch(/1 product ready/));
    click('Add 1 product');
    expect(saved(store).products[0].title).toBe('Bowl');
  });
});

describe('price sheet', () => {
  it('shows postage or prices, a what-if layer, exports and saving the shop state', () => {
    const { store } = start();
    click('US price sheet');
    expect(text()).toMatch(/Add products first/);
    click('Go to your products');
    click('Try a sample shop');
    click('US price sheet');
    expect(text()).toMatch(/US postage with duty included/);
    expect(text()).toMatch(/Too heavy|£/);
    setValue(inputByLabel(/Build it into a US price/) as HTMLInputElement, 'price');
    expect(saved(store).settings.mode).toBe('price');
    expect(text()).toMatch(/US prices with duty included/);
    setValue(inputByLabel('UK duty layer (%)'), '15');
    expect(text()).toMatch(/What-if: these figures use a 15% UK layer/);
    expect(text()).toMatch(/your what-if figure/);
    expect(button('My shop now shows these prices').disabled).toBe(true);
    click('Reset to 10%');
    expect(saved(store).settings.layerOverride).toBeNull();
    click('Download postage table (CSV)');
    expect(text()).toMatch(/could not start the download/);
    click('Download US price list (CSV)');
    click('Download the full sheet (CSV)');
    window.print = vi.fn();
    click('Print');
    expect(window.print).toHaveBeenCalled();
    click('My shop now shows these prices');
    expect(saved(store).snapshot?.on).toBe('2026-11-08');
    expect(text()).toMatch(/Last saved on 2026-11-08/);
  });
});

describe('what changed', () => {
  it('asks for a snapshot, then lists changed products', () => {
    const { store } = start();
    click('What changed');
    expect(text()).toMatch(/Add your products first/);
    click('Add your products first');
    click('Try a sample shop');
    click('What changed');
    click(/save it/);
    expect(text()).toMatch(/Nothing to update/);
    // Change a price and come back.
    click('Your products');
    click(/Edit Speckled stoneware mug/);
    setValue(inputByLabel('UK selling price (£)'), '40');
    click('What changed');
    expect(text()).toMatch(/1 product to update/);
    expect(text()).toMatch(/price, weight, postage bands or settings/);
    click('I’ve updated these in my shop');
    expect(text()).toMatch(/Nothing to update/);
    expect(saved(store).snapshot).not.toBeNull();
    expect(text()).toMatch(/The UK duty layer/);
    click('Download calendar reminder');
    expect(text()).toMatch(/could not start the download/);
  });

  it('shows a tariff update notice for returning makers', () => {
    const cat = emptyCatalog();
    cat.products = [newProduct({ title: 'Mug', price: 28, grams: 420, code: '6912.00.44.00' })];
    cat.lastSeenRevision = '2026HTSRev21';
    const store = memoryStore({ [STORAGE_KEY]: JSON.stringify(cat) });
    const history: RateChange[] = [{ revision: '2026HTSRev22', date: '10/30/2026', code: '6912.00.44.00', before: '9.8%', after: '10%' }];
    start(store, { history });
    expect(text()).toMatch(/tariff data has been updated/);
    expect(text()).toMatch(/1 rate change touch/);
    expect(saved(store).lastSeenRevision).toBe('2026HTSRev22');
    click('See what changed');
    expect(text()).toMatch(/Tariff data updated from 2026HTSRev21/);
    expect(text()).toMatch(/6912\.00\.44\.00: 9\.8% → 10%/);
    expect(text()).toMatch(/from 30 Oct 2026/);
  });

  it('lists new, removed and cheaper products in price mode', () => {
    const cat = sampleCatalog(index, '2026-11-08');
    cat.settings.mode = 'price';
    const store = memoryStore({ [STORAGE_KEY]: JSON.stringify(cat) });
    start(store);
    click('What changed');
    click(/save it/);
    click('Your products');
    click(/Delete Speckled stoneware mug/);
    click(/Edit Hand-knitted merino scarf/);
    setValue(inputByLabel('UK selling price (£)'), '40');
    click('Done');
    click('Add a product');
    setValue(inputByLabel('Product name'), 'Brand new');
    click('What changed');
    expect(text()).toMatch(/US price was/);
    expect(text()).toMatch(/New/);
    expect(text()).toMatch(/Removed/);
    expect(text()).toMatch(/−£/);
  });

  it('says when an update touches none of the codes', () => {
    const cat = emptyCatalog();
    cat.products = [newProduct({ title: 'Candle', price: 10, code: '3406.00.00.00' })];
    cat.lastSeenRevision = '2026HTSRev21';
    start(memoryStore({ [STORAGE_KEY]: JSON.stringify(cat) }), { idx: tinyIndex() });
    expect(text()).toMatch(/None of your saved codes changed rate/);
  });
});

describe('settings', () => {
  it('edits postage bands and other settings, backs up and restores', async () => {
    const store = memoryStore({ [STORAGE_KEY]: JSON.stringify(sampleCatalog(index, '2026-11-08')) });
    start(store);
    click('Enter your postage prices');
    expect(text()).toMatch(/made-up examples/);
    const name = root.querySelector<HTMLInputElement>('input[aria-label="Band 1 name"]')!;
    setValue(name, 'Letter');
    expect(saved(store).settings.bandsAreExample).toBe(false);
    setValue(root.querySelector<HTMLInputElement>('input[aria-label="Band 1 weight limit in grams"]')!, '120');
    setValue(root.querySelector<HTMLInputElement>('input[aria-label="Band 1 price in pounds"]')!, '9.10');
    expect(saved(store).settings.bands[0]).toMatchObject({ name: 'Letter', maxGrams: 120, price: 9.1 });
    click('Add a band');
    expect(saved(store).settings.bands).toHaveLength(7);
    click(/Remove New band/);
    expect(saved(store).settings.bands).toHaveLength(6);
    click('Start again from examples');
    expect(saved(store).settings.bandsAreExample).toBe(true);
    click('These are my real prices');
    expect(saved(store).settings.bandsAreExample).toBe(false);

    setValue(inputByLabel(/handling fee/), '0.75');
    setValue(inputByLabel('Packaging weight (g)'), '80');
    setValue(inputByLabel('US dollars per pound'), '1.27');
    setValue(inputByLabel('US dollars per pound'), 'x');
    setValue(inputByLabel('Round US prices up to'), '0.99');
    setValue(inputByLabel('Round US postage up to'), '1');
    setValue(inputByLabel('Shop name (optional)'), 'My shop');
    expect(saved(store).settings).toMatchObject({ handlingFee: 0.75, packagingGrams: 80, usdPerGbp: 1.27, priceEnding: '0.99', postageStep: 1, shopName: 'My shop' });

    click('Download a backup');
    expect(text()).toMatch(/could not start the download/);
    const restore = inputByLabel('Restore from a backup') as HTMLInputElement;
    const good = new File([JSON.stringify({ products: [{ title: 'Restored', price: 5 }] })], 'b.json');
    Object.defineProperty(restore, 'files', { value: [good], configurable: true });
    restore.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(text()).toMatch(/Restored 1 products/));
    const restore2 = inputByLabel('Restore from a backup') as HTMLInputElement;
    Object.defineProperty(restore2, 'files', { value: [new File(['nope'], 'x.json')] });
    restore2.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(text()).toMatch(/Could not restore/));
  });

  it('shows how it works', () => {
    start();
    click('How it works');
    expect(text()).toMatch(/Two ways to pass it on/);
    expect(text()).toMatch(/\$2,500/);
  });
});

describe('download helper', () => {
  it('starts a download when the browser supports it', () => {
    const create = vi.fn(() => 'blob:x');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.useFakeTimers();
    expect(download('a.csv', 'x')).toBe(true);
    expect(clickSpy).toHaveBeenCalled();
    vi.runAllTimers();
    expect(create).toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith('blob:x');
    vi.useRealTimers();
    Object.assign(URL, { createObjectURL: undefined });
  });
});
