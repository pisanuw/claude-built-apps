import { shortDate } from '../core/dates';
import { FIELDS, accountsIn, columnNames, donationAccount, extractLines, guessMapping, importLines, type MoneyIn } from '../core/importer';
import { formatMoney } from '../core/money';
import { parseCsv, type Rows } from '../core/table';
import { readXlsx } from '../core/xlsx';
import type { Ctx } from './ctx';
import { field, h } from './dom';

/** Read a chosen file into rows: .xlsx through the built-in reader, anything else as CSV text. */
export async function readFile(file: File): Promise<Rows> {
  if (/\.xlsx$/i.test(file.name)) return readXlsx(new Uint8Array(await file.arrayBuffer()));
  if (/\.(xls|numbers|pdf|ods)$/i.test(file.name)) {
    throw new Error('Please save the file as CSV (or .xlsx) first: this app reads CSV and Excel .xlsx files.');
  }
  return parseCsv(await file.text());
}

export function startDraft(ctx: Ctx, fileName: string, rows: Rows): void {
  if (rows.length === 0) throw new Error(`${fileName} has no rows.`);
  const mapping = guessMapping(rows);
  mapping.accountFilter = donationAccount(accountsIn(rows, mapping));
  ctx.ui.draft = { fileName, rows, mapping };
  ctx.ui.message = null;
}

export async function loadFile(ctx: Ctx, file: File): Promise<void> {
  try {
    startDraft(ctx, file.name, await readFile(file));
    ctx.update();
  } catch (e) {
    ctx.flash((e as Error).message, 'error');
  }
}

function howTo(): HTMLElement {
  return h(
    'div',
    { class: 'ways' },
    h(
      'div',
      { class: 'way' },
      h('h3', {}, 'From Xero'),
      h(
        'ol',
        {},
        h('li', {}, 'Go to Reporting, then Account Transactions.'),
        h('li', {}, 'Choose your donations account (and any appeal or offering accounts) and the date range.'),
        h('li', {}, 'Click Update, then Export and choose Excel.'),
        h('li', {}, 'Drop the downloaded file here.'),
      ),
    ),
    h(
      'div',
      { class: 'way' },
      h('h3', {}, 'From your bank'),
      h(
        'ol',
        {},
        h('li', {}, 'In internet banking, open the account donations go into.'),
        h('li', {}, 'Export the transactions for the period as CSV.'),
        h('li', {}, 'Drop the file here. Only money coming in is imported.'),
      ),
    ),
  );
}

function mappingForm(ctx: Ctx): HTMLElement {
  const draft = ctx.ui.draft!;
  const { rows, mapping } = draft;
  const names = columnNames(rows, mapping.headerRow);
  const columnSelect = (f: (typeof FIELDS)[number]) =>
    field(
      f.label,
      h(
        'select',
        {
          name: `col-${f.field}`,
          onchange: (e: Event) => {
            mapping.columns[f.field] = Number((e.target as HTMLSelectElement).value);
            ctx.update();
          },
        },
        h('option', { value: -1 }, '(none)'),
        names.map((n, i) => h('option', { value: i, selected: mapping.columns[f.field] === i }, n)),
      ),
    );
  const moneyOptions: [MoneyIn, string][] = [
    ['credit', 'Credit column'],
    ['debit', 'Debit column'],
    ['positive', 'Amount column, positive numbers'],
    ['negative', 'Amount column, negative numbers'],
  ];
  const accounts = accountsIn(rows, mapping);
  const ex = extractLines(rows, mapping);
  const total = ex.lines.reduce((n, l) => n + l.amountCents, 0);
  const skipped = [
    ex.moneyOut ? `${ex.moneyOut} money out or blank` : '',
    ex.otherAccount ? `${ex.otherAccount} from other accounts` : '',
    ex.noDate ? `${ex.noDate} headings, totals or rows without a date` : '',
  ].filter(Boolean);

  return h(
    'div',
    { class: 'draft' },
    h('h3', {}, `Check the columns in ${draft.fileName}`),
    h('p', { class: 'hint' }, 'We guessed which column is which. Fix any guess and the preview updates.'),
    h(
      'div',
      { class: 'grid' },
      FIELDS.map(columnSelect),
      field(
        'Gifts are in the',
        h(
          'select',
          {
            name: 'moneyIn',
            onchange: (e: Event) => {
              mapping.moneyIn = (e.target as HTMLSelectElement).value as MoneyIn;
              ctx.update();
            },
          },
          moneyOptions.map(([v, label]) => h('option', { value: v, selected: mapping.moneyIn === v }, label)),
        ),
      ),
      field(
        'Dates like 03/04/2026 mean',
        h(
          'select',
          {
            name: 'dayFirst',
            onchange: (e: Event) => {
              mapping.dayFirst = (e.target as HTMLSelectElement).value === 'day';
              ctx.update();
            },
          },
          h('option', { value: 'day', selected: mapping.dayFirst }, '3 April (Australian)'),
          h('option', { value: 'month', selected: !mapping.dayFirst }, 'March 4 (US)'),
        ),
      ),
      accounts.length > 1
        ? field(
            'Only this account',
            h(
              'select',
              {
                name: 'account',
                onchange: (e: Event) => {
                  mapping.accountFilter = (e.target as HTMLSelectElement).value;
                  ctx.update();
                },
              },
              h('option', { value: '' }, 'All accounts'),
              accounts.map((a) => h('option', { value: a, selected: mapping.accountFilter === a }, a)),
            ),
          )
        : null,
    ),
    h(
      'p',
      { class: 'found' },
      h('strong', {}, `${ex.lines.length} gifts, ${formatMoney(total)}.`),
      skipped.length ? ` Skipped: ${skipped.join('; ')}.` : '',
    ),
    ex.lines.length
      ? h(
          'div',
          { class: 'scroll' },
          h(
            'table',
            { class: 'list' },
            h('thead', {}, h('tr', {}, ['Date', 'Amount', 'Bank text', 'Account'].map((c) => h('th', { scope: 'col' }, c)))),
            h(
              'tbody',
              {},
              ex.lines.slice(0, 8).map((l) =>
                h(
                  'tr',
                  {},
                  h('td', {}, shortDate(l.date)),
                  h('td', { class: 'num' }, formatMoney(l.amountCents)),
                  h('td', {}, [l.payee, l.description, l.reference].filter(Boolean).join(' · ')),
                  h('td', {}, l.account),
                ),
              ),
            ),
          ),
          ex.lines.length > 8 ? h('p', { class: 'hint' }, `…and ${ex.lines.length - 8} more.`) : null,
        )
      : null,
    h(
      'div',
      { class: 'actions' },
      h(
        'button',
        {
          type: 'button',
          id: 'do-import',
          disabled: ex.lines.length === 0,
          onclick: () => {
            const { added, duplicates } = importLines(ctx.org, ex.lines);
            ctx.ui.draft = null;
            ctx.ui.giftFilter = 'open';
            ctx.ui.giftYear = 0;
            ctx.go('gifts');
            ctx.flash(
              `Imported ${added.length} gift${added.length === 1 ? '' : 's'}` +
                (duplicates ? `; ${duplicates} were already here and were skipped.` : '.'),
            );
          },
        },
        `Import ${ex.lines.length} gifts`,
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'secondary',
          onclick: () => {
            ctx.ui.draft = null;
            ctx.update();
          },
        },
        'Cancel',
      ),
    ),
  );
}

export function importView(ctx: Ctx): HTMLElement {
  const input = h('input', {
    type: 'file',
    accept: '.csv,.txt,.xlsx,text/csv',
    class: 'visually-hidden',
    id: 'file',
    onchange: (e: Event) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (f) void loadFile(ctx, f);
    },
  });
  const zone = h(
    'label',
    { class: 'zone' },
    input,
    h('strong', {}, 'Choose a CSV or Excel file'),
    h('span', { class: 'hint' }, 'or drop it here. It is read in this browser and never uploaded.'),
  );
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('over');
    const f = (e as DragEvent).dataTransfer?.files?.[0];
    if (f) void loadFile(ctx, f);
  });
  return h(
    'section',
    { class: 'view' },
    h('h2', {}, 'Bring in your gifts'),
    h(
      'p',
      {},
      'Import as often as you like: lines already imported are skipped, so you can drop in a whole year again after adding a month.',
    ),
    ctx.ui.draft ? mappingForm(ctx) : [howTo(), zone],
  );
}
