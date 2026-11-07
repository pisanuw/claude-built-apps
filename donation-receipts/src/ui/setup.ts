import { receiptDoc } from '../core/documents';
import { formatAbn, isValidAbn, orgProblems, type Org } from '../core/model';
import { docView, type Ctx } from './ctx';
import { field, h } from './dom';

type TextKey = 'name' | 'abn' | 'address' | 'email' | 'phone' | 'signatory' | 'signatoryTitle' | 'receiptPrefix' | 'thankYou';

function sampleReceipt(org: Org, today: string): HTMLElement {
  return docView(
    receiptDoc(
      org,
      {
        number: `${org.receiptPrefix.trim()}${String(Math.max(1, org.nextReceiptNo || 1)).padStart(5, '0')}`,
        giftId: '',
        donorId: '',
        donorName: 'A. Donor',
        giftDate: today,
        amountCents: 5000,
        issuedOn: today,
        status: 'issued',
      },
      undefined,
    ),
  );
}

export function setupView(ctx: Ctx): HTMLElement {
  const { org } = ctx;
  const problems = h('div', { class: 'problems', 'aria-live': 'polite' });
  const preview = h('div', { class: 'preview' });
  const refresh = () => {
    const list = orgProblems(org);
    problems.replaceChildren(
      list.length
        ? h('div', { class: 'callout warn' }, h('strong', {}, 'Before you issue receipts'), h('ul', {}, list.map((p) => h('li', {}, p))))
        : h('p', { class: 'callout good' }, 'Ready to issue receipts.'),
    );
    preview.replaceChildren(h('h3', {}, 'How a receipt will look'), sampleReceipt(org, ctx.today));
  };
  const changed = () => {
    ctx.save();
    refresh();
  };
  const text = (key: TextKey, label: string, opts: { hint?: string; multiline?: boolean; placeholder?: string; autocomplete?: string } = {}) => {
    const attrs = {
      name: key,
      value: org[key],
      placeholder: opts.placeholder ?? '',
      autocomplete: opts.autocomplete ?? 'off',
      oninput: (e: Event) => {
        org[key] = (e.target as HTMLInputElement).value;
        changed();
      },
    };
    const control = opts.multiline ? h('textarea', { ...attrs, rows: 3 }) : h('input', { ...attrs, type: 'text' });
    return field(label, control, opts.hint);
  };
  const abnNote = h('span', { class: 'hint abn-note' });
  const showAbn = () => {
    const raw = org.abn.trim();
    abnNote.textContent = !raw ? '' : isValidAbn(raw) ? `Valid ABN: ${formatAbn(raw)}` : 'This ABN fails the ATO check digit test.';
    abnNote.className = `hint abn-note ${raw && !isValidAbn(raw) ? 'bad' : ''}`;
  };
  const abn = text('abn', 'ABN', { placeholder: '11 digits', hint: 'Checked against the ATO check digit rule as you type.' });
  abn.append(abnNote);
  abn.querySelector('input')!.addEventListener('input', showAbn);
  showAbn();

  const dgrChoice = (value: boolean, label: string, hint: string) =>
    h(
      'label',
      { class: 'choice' },
      h('input', {
        type: 'radio',
        name: 'dgr',
        value: value ? 'yes' : 'no',
        checked: org.dgr === value,
        onchange: () => {
          org.dgr = value;
          changed();
        },
      }),
      h('span', {}, h('strong', {}, label), h('span', { class: 'hint block' }, hint)),
    );

  const nextNo = h('input', {
    type: 'number',
    name: 'nextReceiptNo',
    min: 1,
    step: 1,
    value: org.nextReceiptNo,
    oninput: (e: Event) => {
      org.nextReceiptNo = Number((e.target as HTMLInputElement).value);
      changed();
    },
  });

  refresh();
  return h(
    'section',
    { class: 'view' },
    h('h2', {}, 'Your organisation'),
    h('p', {}, 'This is what every receipt and statement shows. Changes save as you type.'),
    h(
      'div',
      { class: 'two-col' },
      h(
        'div',
        { class: 'form' },
        text('name', 'Legal name', { placeholder: 'e.g. St Columba Parish Hall Inc.' }),
        abn,
        h(
          'fieldset',
          {},
          h('legend', {}, 'Deductible gift recipient (DGR)?'),
          dgrChoice(true, 'Yes, we are endorsed as a DGR', 'Receipts say gifts of $2 or more are tax deductible.'),
          dgrChoice(false, 'No', 'Receipts thank the donor and say the gift is not tax deductible.'),
        ),
        text('address', 'Postal address', { multiline: true }),
        text('email', 'Email', { autocomplete: 'email' }),
        text('phone', 'Phone'),
        text('signatory', 'Issued by (name)', { placeholder: 'e.g. Alex Morgan', hint: 'Printed on each receipt. Leave blank to leave it off.' }),
        text('signatoryTitle', 'Their role'),
        h(
          'div',
          { class: 'pair' },
          text('receiptPrefix', 'Receipt number prefix', { hint: 'e.g. R or 2026-' }),
          field('Next receipt number', nextNo, 'Continue from your last paper receipt.'),
        ),
        text('thankYou', 'Thank-you note', { multiline: true }),
        problems,
      ),
      preview,
    ),
  );
}
