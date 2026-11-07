import { activeOrg, newOrg, validateData, type AppData } from '../core/model';
import { readyGifts } from '../core/documents';
import { SAMPLE_FILE_NAME, sampleCsv, sampleOrg } from '../core/sample';
import { browserStorage, loadData, saveData } from '../core/storage';
import { parseCsv } from '../core/table';
import { todayIso } from '../core/dates';
import type { Ctx, Tab, UiState } from './ctx';
import { h } from './dom';
import { backupView, donorsView } from './donors';
import { giftState, giftsView } from './gifts';
import { importView, startDraft } from './importView';
import { receiptsView, statementsView } from './receipts';
import { setupView } from './setup';

const TABS: [Tab, string][] = [
  ['setup', 'Organisation'],
  ['import', 'Import'],
  ['gifts', 'Gifts'],
  ['receipts', 'Receipts'],
  ['statements', 'Statements'],
  ['donors', 'Donors'],
  ['backup', 'Backup'],
];

export interface App {
  data: AppData;
  ui: UiState;
  render(): void;
}

export function mount(root: HTMLElement, now: () => Date = () => new Date(), store: Storage | null = browserStorage()): App {
  const data = loadData(store);
  const first = activeOrg(data);
  const ui: UiState = {
    tab: first.gifts.length ? 'gifts' : 'setup',
    draft: null,
    giftFilter: 'open',
    giftYear: 0,
    statementYear: 0,
    preview: null,
    lastIssued: [],
    message: null,
  };
  let saveFailed = false;
  const save = () => {
    saveFailed = !saveData(store, data);
  };

  const status = h('div', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const header = h('header');
  const nav = h('nav', { 'aria-label': 'Steps' });
  const main = h('main', { id: 'main', tabindex: -1 });
  root.replaceChildren(header, nav, status, main);

  const switchOrg = (id: string) => {
    data.activeOrgId = id;
    ui.draft = null;
    ui.preview = null;
    ui.lastIssued = [];
    ui.message = null;
    ui.tab = activeOrg(data).gifts.length ? 'gifts' : 'setup';
    save();
    render();
  };

  function renderHeader(): void {
    const org = activeOrg(data);
    header.replaceChildren(
      h('h1', {}, 'Donation Receipts'),
      h(
        'p',
        { class: 'lede' },
        'Numbered donation receipts and 30 June statements for small charities, churches and community groups, from the gifts already in your Xero or bank export.',
      ),
      h('p', { class: 'privacy' }, 'Everything stays in this browser. Nothing is uploaded.'),
      h(
        'div',
        { class: 'orgbar' },
        h(
          'label',
          { class: 'inline' },
          'Organisation ',
          h(
            'select',
            { name: 'org', onchange: (e: Event) => switchOrg((e.target as HTMLSelectElement).value) },
            data.orgs.map((o) => h('option', { value: o.id, selected: o.id === org.id }, o.name)),
          ),
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'small secondary',
            id: 'add-org',
            onclick: () => {
              const o = newOrg(`Organisation ${data.orgs.length + 1}`);
              data.orgs.push(o);
              switchOrg(o.id);
            },
          },
          '+ Add organisation',
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'small secondary',
            id: 'example',
            onclick: () => {
              const o = sampleOrg();
              data.orgs.push(o);
              switchOrg(o.id);
              startDraft(ctx(), SAMPLE_FILE_NAME, parseCsv(sampleCsv()));
              ui.tab = 'import';
              save();
              render();
            },
          },
          'Try the example',
        ),
        h('span', { class: 'hint' }, 'Bookkeepers: keep each client as its own organisation.'),
      ),
    );
  }

  function renderNav(): void {
    const org = activeOrg(data);
    const badge = (t: Tab): string => {
      if (t === 'gifts') {
        const open = org.gifts.filter((g) => giftState(org, g) === 'open').length;
        return open ? ` (${open})` : '';
      }
      if (t === 'receipts') {
        const n = readyGifts(org).length;
        return n ? ` (${n})` : '';
      }
      return '';
    };
    nav.replaceChildren(
      h(
        'ol',
        {},
        TABS.map(([t, label]) =>
          h(
            'li',
            {},
            h(
              'button',
              {
                type: 'button',
                class: `tab ${ui.tab === t ? 'on' : ''}`,
                'data-tab': t,
                'aria-current': ui.tab === t ? 'page' : 'false',
                onclick: () => go(t),
              },
              label + badge(t),
            ),
          ),
        ),
      ),
    );
  }

  function renderStatus(): void {
    const parts: HTMLElement[] = [];
    if (ui.message) parts.push(h('p', { class: `msg ${ui.message.kind}` }, ui.message.text));
    if (saveFailed) parts.push(h('p', { class: 'msg error' }, 'This browser is not saving your work (private window or storage full). Download a backup from the Backup tab before you close it.'));
    status.replaceChildren(...parts);
  }

  function ctx(): Ctx {
    return { data, org: activeOrg(data), ui, today: todayIso(now()), save, update, go, flash };
  }

  function go(t: Tab): void {
    ui.tab = t;
    ui.preview = null;
    ui.message = null;
    update();
    main.focus?.({ preventScroll: true });
  }

  function flash(text: string, kind: 'ok' | 'error' = 'ok'): void {
    ui.message = { text, kind };
    renderStatus();
  }

  function update(): void {
    save();
    render();
  }

  function render(): void {
    const c = ctx();
    renderHeader();
    renderNav();
    renderStatus();
    const views: Record<Tab, () => HTMLElement> = {
      setup: () => setupView(c),
      import: () => importView(c),
      gifts: () => giftsView(c),
      receipts: () => receiptsView(c),
      statements: () => statementsView(c),
      donors: () => donorsView(c),
      backup: () =>
        backupView(c, (text) => {
          try {
            const restored = validateData(JSON.parse(text));
            if (!window.confirm('Replace everything in this browser with the backup?')) return;
            data.orgs = restored.orgs;
            data.activeOrgId = restored.activeOrgId;
            switchOrg(data.activeOrgId);
            flash(`Restored ${restored.orgs.length} organisation${restored.orgs.length === 1 ? '' : 's'} from the backup.`);
          } catch (e) {
            flash(e instanceof SyntaxError ? 'That file is not a backup (it is not valid JSON).' : (e as Error).message, 'error');
          }
        }),
    };
    main.replaceChildren(views[ui.tab]());
  }

  render();
  return { data, ui, render };
}
