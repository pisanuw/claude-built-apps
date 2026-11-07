// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '../src/ui/app';
import { download, field, h } from '../src/ui/dom';
import { defaultStatementYear } from '../src/ui/receipts';
import { STORAGE_KEY } from '../src/core/storage';
import { activeOrg } from '../src/core/model';

const NOW = () => new Date('2026-11-07T10:00:00');
const flush = () => new Promise((r) => setTimeout(r, 0));

function memStore(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size;
    },
  };
}

function textFile(text: string, name: string): File {
  const f = new File([text], name);
  Object.defineProperty(f, 'text', { value: () => Promise.resolve(text) });
  return f;
}

function chooseFile(input: HTMLInputElement, file: File): void {
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
}

function select(root: HTMLElement, sel: string, value: string): void {
  const s = root.querySelector(sel) as HTMLSelectElement;
  s.value = value;
  s.dispatchEvent(new Event('change'));
}

function type(el: Element, value: string): void {
  (el as HTMLInputElement).value = value;
  el.dispatchEvent(new Event('input'));
}

const click = (root: HTMLElement, sel: string) => (root.querySelector(sel) as HTMLElement).click();
const byText = (root: HTMLElement, tag: string, text: string) =>
  [...root.querySelectorAll(tag)].find((e) => e.textContent?.includes(text)) as HTMLElement;

describe('ui', () => {
  let root: HTMLElement;
  let store: Storage;
  let downloads: string[];
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app') as HTMLElement;
    store = memStore();
    downloads = [];
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      if (this.download) downloads.push(this.download);
    });
  });

  it('starts on the organisation form, checks the ABN live and saves as you type', () => {
    mount(root, NOW, store);
    expect(root.querySelector('h1')?.textContent).toBe('Donation Receipts');
    expect(root.querySelector('[data-tab="setup"]')?.getAttribute('aria-current')).toBe('page');
    expect(root.querySelector('.callout.warn')?.textContent).toContain('legal name');
    type(root.querySelector('input[name="name"]')!, 'St Columba Hall Inc.');
    type(root.querySelector('input[name="abn"]')!, '51 824 753 557');
    expect(root.querySelector('.abn-note')?.textContent).toContain('fails');
    type(root.querySelector('input[name="abn"]')!, '51824753556');
    expect(root.querySelector('.abn-note')?.textContent).toBe('Valid ABN: 51 824 753 556');
    type(root.querySelector('input[name="nextReceiptNo"]')!, '40');
    type(root.querySelector('input[name="receiptPrefix"]')!, 'SC-');
    expect(root.querySelector('.callout.good')?.textContent).toBe('Ready to issue receipts.');
    expect(root.querySelector('.preview')?.textContent).toContain('SC-00040');
    expect(root.querySelector('.preview')?.textContent).toContain('tax deductible');
    (root.querySelector('input[name="dgr"][value="no"]') as HTMLInputElement).dispatchEvent(new Event('change'));
    expect(root.querySelector('.preview')?.textContent).toContain('not tax deductible');
    type(root.querySelector('textarea[name="thankYou"]')!, 'Ta.');
    const saved = JSON.parse(store.getItem(STORAGE_KEY)!);
    expect(saved.orgs[0]).toMatchObject({ name: 'St Columba Hall Inc.', abn: '51824753556', dgr: false, nextReceiptNo: 40, thankYou: 'Ta.' });
    type(root.querySelector('input[name="abn"]')!, '');
    expect(root.querySelector('.abn-note')?.textContent).toBe('');
  });

  it('runs the example from import to statements', async () => {
    const app = mount(root, NOW, store);
    click(root, '#example');
    expect(app.ui.tab).toBe('import');
    expect(root.textContent).toContain('28 gifts, $4,036.50.');
    expect(root.textContent).toContain('Skipped: 1 money out or blank; 1 from other accounts; 3 headings, totals or rows without a date.');
    expect(root.textContent).toContain('…and 20 more.');
    // Mapping changes redraw the preview.
    select(root, 'select[name="account"]', '');
    expect(root.textContent).toContain('29 gifts');
    select(root, 'select[name="account"]', 'Donations');
    select(root, 'select[name="moneyIn"]', 'debit');
    expect(root.textContent).toContain('1 gifts, $50.00');
    select(root, 'select[name="moneyIn"]', 'credit');
    select(root, 'select[name="dayFirst"]', 'month');
    select(root, 'select[name="dayFirst"]', 'day');
    select(root, 'select[name="col-date"]', '-1');
    expect((root.querySelector('#do-import') as HTMLButtonElement).disabled).toBe(true);
    select(root, 'select[name="col-date"]', '0');
    click(root, '#do-import');
    expect(app.ui.tab).toBe('gifts');
    expect(root.querySelector('.status')?.textContent).toBe('Imported 28 gifts.');
    expect(root.querySelector('[data-tab="gifts"]')?.textContent).toBe('Gifts (28)');
    expect(root.querySelectorAll('tbody tr')).toHaveLength(28);
    expect(root.textContent).not.toContain('undefined');

    // One by hand, one new donor from bank text, the rest in bulk.
    const kowRow = byText(root, 'tr', 'KOWALSKI');
    byText(kowRow, 'button', 'New donor “A Kowalski”').click();
    expect(root.querySelector('.status')?.textContent).toContain('Added donor A Kowalski');
    byText(byText(root, 'tr', 'SMITH PLUMBING'), 'button', 'Use Smith Plumbing Pty Ltd').click();
    expect(root.querySelector('#accept-strong')?.textContent).toBe('Link 24 clear matches');
    click(root, '#accept-strong');
    expect(root.querySelector('.status')?.textContent).toContain('Linked 24 gifts');
    expect(root.querySelectorAll('tbody tr')).toHaveLength(2);
    const grant = byText(root, 'tr', 'COUNCIL');
    (grant.querySelector('input[type="checkbox"]') as HTMLInputElement).click();
    expect(root.querySelector('[data-filter="excluded"]')?.textContent).toBe('Not donations (1)');
    const patel = byText(root, 'tr', 'PATEL');
    select(patel, 'select', activeOrg(app.data).donors.find((d) => d.name === 'Jane Citizen')!.id);
    expect(root.querySelector('[data-filter="open"]')?.textContent).toBe('Need a donor (0)');
    click(root, '[data-filter="ready"]');
    select(byText(root, 'tr', 'PATEL'), 'select', '');
    click(root, '[data-filter="all"]');
    select(root, 'select[name="giftYear"]', '2027');
    expect(root.querySelectorAll('tbody tr')).toHaveLength(3);
    select(root, 'select[name="giftYear"]', '0');
    click(root, '[data-filter="excluded"]');
    (byText(root, 'tr', 'COUNCIL').querySelector('input[type="checkbox"]') as HTMLInputElement).click();
    click(root, '[data-filter="open"]');
    expect(root.querySelectorAll('tbody tr')).toHaveLength(2);
    (byText(root, 'tr', 'COUNCIL').querySelector('input[type="checkbox"]') as HTMLInputElement).click();

    // Receipts.
    byText(root, 'button', 'Issue receipts for 26 ready gifts').click();
    expect(app.ui.tab).toBe('receipts');
    click(root, '#issue');
    expect(root.querySelector('.status')?.textContent).toBe('Issued 26 receipts: RCP-00101 to RCP-00126.');
    byText(root, 'button', 'Download the 26 new receipts as one PDF').click();
    expect(downloads).toContain('receipts-RCP-00101-to-RCP-00126.pdf');
    const row = root.querySelector('[data-receipt="RCP-00101"]') as HTMLElement;
    byText(row, 'button', 'View').click();
    expect(root.querySelector('#preview .doc')?.textContent).toContain('Receipt for a tax deductible gift');
    byText(root.querySelector('#preview')!, 'button', 'Download PDF').click();
    expect(downloads).toContain('receipt-RCP-00101-Jane-Citizen.pdf');
    byText(root.querySelector('#preview')!, 'button', 'Close').click();
    expect(root.querySelector('#preview')).toBeNull();
    expect(row.querySelector('a.button')?.getAttribute('href')).toMatch(/^mailto:jane%40example\.com/);
    expect(byText(root, 'tr', "Margaret O'Brien").textContent).toContain('no email');
    byText(root, 'button', 'Download register (CSV)').click();
    expect(downloads).toContain('receipt-register-RCP-.csv');
    byText(root.querySelector('[data-receipt="RCP-00102"]') as HTMLElement, 'button', 'PDF').click();

    // Void: cancelled, empty reason, then a real one.
    const prompt = vi.spyOn(window, 'prompt').mockReturnValueOnce(null).mockReturnValueOnce('  ').mockReturnValueOnce('Wrong donor');
    const voidBtn = () => byText(root.querySelector('[data-receipt="RCP-00101"]') as HTMLElement, 'button', 'Void');
    voidBtn().click();
    expect(root.querySelector('[data-receipt="RCP-00101"]')?.className).toBe('issued');
    voidBtn().click();
    expect(root.querySelector('.status .error')?.textContent).toContain('Say why');
    voidBtn().click();
    expect(prompt).toHaveBeenCalledTimes(3);
    expect(root.querySelector('.status')?.textContent).toContain('RCP-00101 is void');
    expect(root.querySelector('[data-receipt="RCP-00101"]')?.className).toBe('void');
    expect(root.querySelector('[data-tab="receipts"]')?.textContent).toBe('Receipts (1)');
    click(root, '#issue');
    expect(root.querySelector('.status')?.textContent).toContain('RCP-00127');

    // Statements.
    click(root, '[data-tab="statements"]');
    expect((root.querySelector('select[name="statementYear"]') as HTMLSelectElement).value).toBe('2026');
    expect(root.textContent).toContain('6 donors gave $1,835.00 in 2025-26.');
    expect(root.textContent).toContain('1 gift in 2025-26 has no donor yet and is on no statement.');
    click(root, '#all-statements');
    expect(downloads).toContain('statements-2025-26.pdf');
    byText(root, 'button', 'Statement list (CSV)').click();
    expect(downloads).toContain('statements-2025-26.csv');
    byText(byText(root, 'tr', 'Thomas Tran'), 'button', 'View').click();
    expect(root.querySelector('#preview')?.textContent).toContain('Annual statement of gifts, 2025-26');
    byText(byText(root, 'tr', 'Thomas Tran'), 'button', 'PDF').click();
    expect(downloads).toContain('statement-2025-26-Thomas-Tran.pdf');
    select(root, 'select[name="statementYear"]', '2027');
    expect(root.textContent).toContain('has not ended yet');
    expect(root.textContent).toContain('2 donors gave $200.00 in 2026-27.');

    // Gifts without a donor are flagged on statements.
    const newGift = activeOrg(app.data).gifts.find((g) => g.description === 'TRANSFER FROM A KOWALSKI')!;
    newGift.donorId = undefined;
    newGift.receiptNo = undefined;
    select(root, 'select[name="statementYear"]', '2026');
    expect(root.textContent).toContain('2 gifts in 2025-26 have no donor yet and are on no statement.');
    byText(root, 'button', 'Link them').click();
    expect(app.ui.tab).toBe('gifts');
    expect(app.ui.giftYear).toBe(2026);
    await flush();
  });

  it('manages donors and bank text', () => {
    const app = mount(root, NOW, store);
    click(root, '#example');
    click(root, '#do-import');
    click(root, '#accept-strong');
    click(root, '[data-tab="donors"]');
    expect(root.querySelectorAll('tbody tr')).toHaveLength(5);
    const form = root.querySelector('form.add-donor') as HTMLFormElement;
    form.dispatchEvent(new Event('submit'));
    expect(root.querySelectorAll('tbody tr')).toHaveLength(5);
    type(root.querySelector('input[name="newName"]')!, 'Zoe Ng');
    type(root.querySelector('input[name="newEmail"]')!, 'zoe@example.com');
    root.querySelector('form.add-donor')!.dispatchEvent(new Event('submit'));
    expect(root.querySelector('.status')?.textContent).toBe('Added Zoe Ng.');
    expect(root.querySelectorAll('tbody tr')).toHaveLength(6);
    const jane = byText(root, 'tr', 'JANE CITIZEN');
    expect(jane.querySelector('.tag')?.textContent).toContain('JANE CITIZEN');
    (jane.querySelector('.tag button') as HTMLButtonElement).click();
    expect(activeOrg(app.data).donors.find((d) => d.name === 'Jane Citizen')!.aliases).toEqual([]);
    const zoe = root.querySelector(`[data-donor="${activeOrg(app.data).donors.find((d) => d.name === 'Zoe Ng')!.id}"]`) as HTMLElement;
    type(zoe.querySelector('input[type="email"]')!, 'zoe.ng@example.com');
    expect(activeOrg(app.data).donors.find((d) => d.name === 'Zoe Ng')!.email).toBe('zoe.ng@example.com');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    byText(zoe, 'button', 'Remove').click();
    expect(root.querySelectorAll('tbody tr')).toHaveLength(6);
    byText(root.querySelector(`[data-donor="${activeOrg(app.data).donors.find((d) => d.name === 'Zoe Ng')!.id}"]`) as HTMLElement, 'button', 'Remove').click();
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(root.querySelectorAll('tbody tr')).toHaveLength(5);
    // A donor with linked gifts but no receipts can be removed; the gifts go back to the queue.
    const jRow = root.querySelector(`[data-donor="${activeOrg(app.data).donors.find((d) => d.name === 'Jane Citizen')!.id}"]`) as HTMLElement;
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    byText(jRow, 'button', 'Remove').click();
    expect(activeOrg(app.data).gifts.filter((g) => g.description.includes('JANE') && !g.donorId)).toHaveLength(14);
  });

  it('keeps several organisations apart, backs up and restores', async () => {
    const app = mount(root, NOW, store);
    click(root, '#add-org');
    expect(app.data.orgs).toHaveLength(2);
    expect((root.querySelector('select[name="org"]') as HTMLSelectElement).selectedOptions[0]!.textContent).toBe('Organisation 2');
    click(root, '#example');
    click(root, '#do-import');
    select(root, 'select[name="org"]', app.data.orgs[0]!.id);
    expect(app.ui.tab).toBe('setup');
    select(root, 'select[name="org"]', app.data.orgs[2]!.id);
    expect(app.ui.tab).toBe('gifts');

    click(root, '[data-tab="backup"]');
    click(root, '#backup');
    expect(downloads).toContain('donation-receipts-backup-2026-11-07.json');
    byText(root, 'button', 'All gifts (CSV)').click();
    expect(downloads).toContain('gifts-2026-11-07.csv');
    const backup = JSON.stringify(app.data);

    // Restore: bad JSON, not a backup, cancelled, then accepted.
    const input = root.querySelector('input[type="file"]') as HTMLInputElement;
    chooseFile(input, textFile('{nope', 'x.json'));
    await flush();
    expect(root.querySelector('.status .error')?.textContent).toContain('not valid JSON');
    chooseFile(input, textFile('{"version":2}', 'x.json'));
    await flush();
    expect(root.querySelector('.status .error')?.textContent).toContain('not a Donation Receipts backup');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    chooseFile(input, textFile(backup, 'b.json'));
    await flush();
    confirm.mockReturnValue(true);

    // Delete organisations down to none: a fresh one appears.
    for (let i = 0; i < 3; i++) {
      click(root, '[data-tab="backup"]');
      click(root, '#remove-org');
    }
    expect(app.data.orgs).toHaveLength(1);
    expect(activeOrg(app.data).name).toBe('My organisation');
    click(root, '[data-tab="backup"]');
    chooseFile(root.querySelector('input[type="file"]') as HTMLInputElement, textFile(backup, 'b.json'));
    await flush();
    expect(app.data.orgs).toHaveLength(3);
    expect(root.querySelector('.status')?.textContent).toBe('Restored 3 organisations from the backup.');
    confirm.mockReturnValue(false);
    click(root, '[data-tab="backup"]');
    click(root, '#remove-org');
    expect(app.data.orgs).toHaveLength(3);
  });

  it('imports files, reports bad ones and shows empty states', async () => {
    const app = mount(root, NOW, store);
    click(root, '[data-tab="gifts"]');
    expect(root.textContent).toContain('No gifts yet.');
    byText(root, 'button', 'Import a Xero or bank export').click();
    expect(app.ui.tab).toBe('import');
    const input = root.querySelector('#file') as HTMLInputElement;
    chooseFile(input, textFile('', 'empty.csv'));
    await flush();
    expect(root.querySelector('.status .error')?.textContent).toBe('empty.csv has no rows.');
    chooseFile(input, textFile('', 'old.xls'));
    await flush();
    expect(root.querySelector('.status .error')?.textContent).toContain('save the file as CSV');
    chooseFile(input, textFile('Date,Amount,Payee\n01/07/2026,25,S Lee\n01/07/2026,25,S Lee', 'bank.csv'));
    await flush();
    expect(root.textContent).toContain('Check the columns in bank.csv');
    expect(root.querySelector('select[name="account"]')).toBeNull();
    byText(root, 'button', 'Cancel').click();
    expect(root.textContent).toContain('From Xero');

    // Drag and drop.
    const zone = root.querySelector('.zone') as HTMLElement;
    zone.dispatchEvent(new Event('dragover'));
    expect(zone.classList.contains('over')).toBe(true);
    zone.dispatchEvent(new Event('dragleave'));
    expect(zone.classList.contains('over')).toBe(false);
    const drop = new Event('drop') as Event & { dataTransfer: unknown };
    drop.dataTransfer = { files: [textFile('Date,Amount,Payee\n01/07/2026,25,S Lee', 'drop.csv')] };
    zone.dispatchEvent(drop);
    await flush();
    expect(root.textContent).toContain('Check the columns in drop.csv');
    click(root, '#do-import');
    expect(root.querySelector('.status')?.textContent).toBe('Imported 1 gift.');
    // The same file again adds nothing.
    click(root, '[data-tab="import"]');
    chooseFile(root.querySelector('#file') as HTMLInputElement, textFile('Date,Amount,Payee\n01/07/2026,25,S Lee', 'drop.csv'));
    await flush();
    click(root, '#do-import');
    expect(root.querySelector('.status')?.textContent).toBe('Imported 0 gifts; 1 were already here and were skipped.');

    // Receipts and statements before the organisation is set up.
    const giftRow = root.querySelector('tbody tr') as HTMLElement;
    byText(giftRow, 'button', 'New donor “S Lee”').click();
    click(root, '[data-tab="receipts"]');
    expect(root.textContent).toContain('Finish your organisation details first');
    expect((root.querySelector('#issue') as HTMLButtonElement).disabled).toBe(true);
    click(root, '[data-tab="statements"]');
    expect((root.querySelector('#all-statements') as HTMLButtonElement).disabled).toBe(true);
    byText(root, 'button', 'Go to Organisation').click();
    expect(app.ui.tab).toBe('setup');
    // Unset storage warns the person to back up.
    const failing = { ...memStore(), setItem: () => { throw new Error('full'); } } as Storage;
    document.body.innerHTML = '<div id="app"></div>';
    const r2 = document.getElementById('app') as HTMLElement;
    mount(r2, NOW, failing);
    type(r2.querySelector('input[name="name"]')!, 'X');
    click(r2, '[data-tab="donors"]');
    expect(r2.textContent).toContain('This browser is not saving your work');
    expect(r2.textContent).toContain('No donors yet.');
    click(r2, '[data-tab="receipts"]');
    expect(r2.textContent).toContain('No gifts are waiting for a receipt.');
    click(r2, '[data-tab="statements"]');
    expect(r2.textContent).toContain('No linked gifts in 2025-26.');
  });

  it('picks a sensible statement year and has working helpers', () => {
    expect(defaultStatementYear([2027, 2026], '2026-11-07')).toBe(2026);
    expect(defaultStatementYear([2027], '2026-11-07')).toBe(2027);
    expect(defaultStatementYear([], '2026-11-07')).toBe(2026);
    const l = field('Name', h('input', { value: 'x', checked: true }), 'hint');
    expect(l.querySelector('.hint')?.textContent).toBe('hint');
    expect(h('div', { hidden: true, skip: false, n: 3 }).outerHTML).toBe('<div hidden="" n="3"></div>');
    vi.useFakeTimers();
    download('a.txt', 'hi', 'text/plain');
    vi.runAllTimers();
    vi.useRealTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });
});
