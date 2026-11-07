import { financialYear, fyLabel, fyRange, shortDate } from '../core/dates';
import { donorYears, issueReceipts, mailtoLink, readyGifts, receiptDoc, statementDoc, voidReceipt, yearsWithGifts, type Doc } from '../core/documents';
import { registerCsv, statementsCsv } from '../core/exports';
import { formatMoney } from '../core/money';
import { donorById, orgProblems, type Receipt } from '../core/model';
import { renderPdf } from '../core/pdf';
import { docView, type Ctx } from './ctx';
import { download, h } from './dom';

function pdfButton(label: string, docs: Doc[], filename: string, cls = 'small secondary'): HTMLButtonElement {
  return h('button', { type: 'button', class: cls, onclick: () => download(filename, renderPdf(docs), 'application/pdf') }, label);
}

function emailLink(to: string, ctx: Ctx, doc: Doc): HTMLElement {
  return to.trim()
    ? h('a', { class: 'button small secondary', href: mailtoLink(to, ctx.org, doc) }, 'Email')
    : h('span', { class: 'hint', title: 'Add an email address on the Donors tab' }, 'no email');
}

function previewButton(ctx: Ctx, doc: Doc): HTMLButtonElement {
  return h(
    'button',
    {
      type: 'button',
      class: 'small secondary',
      onclick: () => {
        ctx.ui.preview = doc;
        ctx.update();
        document.getElementById('preview')?.scrollIntoView?.({ behavior: 'smooth' });
      },
    },
    'View',
  );
}

function previewPanel(ctx: Ctx): HTMLElement | null {
  const doc = ctx.ui.preview;
  if (!doc) return null;
  return h(
    'div',
    { class: 'preview', id: 'preview' },
    h(
      'div',
      { class: 'actions' },
      pdfButton('Download PDF', [doc], doc.filename, 'small'),
      h(
        'button',
        {
          type: 'button',
          class: 'small secondary',
          onclick: () => {
            ctx.ui.preview = null;
            ctx.update();
          },
        },
        'Close',
      ),
    ),
    docView(doc),
  );
}

function blockers(ctx: Ctx): HTMLElement | null {
  const problems = orgProblems(ctx.org);
  if (!problems.length) return null;
  return h(
    'div',
    { class: 'callout warn' },
    h('strong', {}, 'Finish your organisation details first'),
    h('ul', {}, problems.map((p) => h('li', {}, p))),
    h('button', { type: 'button', class: 'small', onclick: () => ctx.go('setup') }, 'Go to Organisation'),
  );
}

export function receiptsView(ctx: Ctx): HTMLElement {
  const { org, ui } = ctx;
  const ready = readyGifts(org);
  const readyTotal = ready.reduce((n, g) => n + g.amountCents, 0);
  const problems = blockers(ctx);
  const docFor = (r: Receipt) => receiptDoc(org, r, donorById(org, r.donorId));
  const lastIssued = org.receipts.filter((r) => ui.lastIssued.includes(r.number) && r.status === 'issued');
  const receipts = [...org.receipts].sort((a, b) => b.number.localeCompare(a.number, undefined, { numeric: true }));

  return h(
    'section',
    { class: 'view' },
    h('h2', {}, 'Receipts'),
    problems,
    h(
      'div',
      { class: 'panel' },
      ready.length
        ? h(
            'p',
            {},
            h('strong', {}, `${ready.length} gift${ready.length === 1 ? '' : 's'} ready (${formatMoney(readyTotal)}).`),
            ' Each gets the next receipt number, in date order.',
          )
        : h('p', {}, 'No gifts are waiting for a receipt. Link gifts to donors on the Gifts tab first.'),
      h(
        'button',
        {
          type: 'button',
          id: 'issue',
          disabled: !ready.length || !!problems,
          onclick: () => {
            try {
              const issued = issueReceipts(org, ready.map((g) => g.id), ctx.today);
              ui.lastIssued = issued.map((r) => r.number);
              ctx.update();
              ctx.flash(`Issued ${issued.length} receipts: ${issued[0]!.number} to ${issued[issued.length - 1]!.number}.`);
            } catch (e) {
              ctx.flash((e as Error).message, 'error');
            }
          },
        },
        `Issue ${ready.length} receipt${ready.length === 1 ? '' : 's'}`,
      ),
      lastIssued.length
        ? h(
            'p',
            {},
            pdfButton(
              `Download the ${lastIssued.length} new receipts as one PDF`,
              lastIssued.map(docFor),
              `receipts-${lastIssued[0]!.number}-to-${lastIssued[lastIssued.length - 1]!.number}.pdf`,
              'secondary',
            ),
            h('span', { class: 'hint' }, ' One page each, ready to print or post.'),
          )
        : null,
    ),
    previewPanel(ctx),
    receipts.length
      ? [
          h(
            'div',
            { class: 'toolbar' },
            h('h3', {}, 'Receipt register'),
            h(
              'button',
              { type: 'button', class: 'secondary', onclick: () => download(`receipt-register-${org.receiptPrefix.trim() || 'R'}.csv`, registerCsv(org), 'text/csv') },
              'Download register (CSV)',
            ),
          ),
          h('p', { class: 'hint' }, 'Every number ever issued, including void ones, for your auditor.'),
          h(
            'div',
            { class: 'scroll' },
            h(
              'table',
              { class: 'list' },
              h('thead', {}, h('tr', {}, ['Number', 'Donor', 'Gift date', 'Amount', 'Issued', ''].map((c) => h('th', { scope: 'col' }, c)))),
              h(
                'tbody',
                {},
                receipts.map((r) => {
                  const doc = docFor(r);
                  return h(
                    'tr',
                    { class: r.status, 'data-receipt': r.number },
                    h('td', { class: 'nowrap' }, r.number, r.status === 'void' ? h('span', { class: 'tag' }, 'void') : null),
                    h('td', {}, r.donorName, r.voidReason ? h('span', { class: 'hint block' }, r.voidReason) : null),
                    h('td', { class: 'nowrap' }, shortDate(r.giftDate)),
                    h('td', { class: 'num' }, formatMoney(r.amountCents)),
                    h('td', { class: 'nowrap' }, shortDate(r.issuedOn)),
                    h(
                      'td',
                      { class: 'row-actions' },
                      previewButton(ctx, doc),
                      pdfButton('PDF', [doc], doc.filename),
                      r.status === 'issued' ? emailLink(donorById(org, r.donorId)?.email ?? '', ctx, doc) : null,
                      r.status === 'issued'
                        ? h(
                            'button',
                            {
                              type: 'button',
                              class: 'small danger',
                              onclick: () => {
                                const reason = window.prompt(`Why is receipt ${r.number} void? (e.g. wrong donor, gift refunded)`);
                                if (reason === null) return;
                                try {
                                  voidReceipt(org, r.number, reason, ctx.today);
                                  ui.preview = null;
                                  ctx.update();
                                  ctx.flash(`Receipt ${r.number} is void. The gift is back in the queue for a new receipt.`);
                                } catch (e) {
                                  ctx.flash((e as Error).message, 'error');
                                }
                              },
                            },
                            'Void',
                          )
                        : null,
                    ),
                  );
                }),
              ),
            ),
          ),
        ]
      : null,
  );
}

/** Default to the most recent financial year that has ended, else the newest one with gifts. */
export function defaultStatementYear(years: number[], today: string): number {
  const current = financialYear(today);
  return years.find((y) => y < current) ?? years[0] ?? current - 1;
}

export function statementsView(ctx: Ctx): HTMLElement {
  const { org, ui } = ctx;
  const years = yearsWithGifts(org);
  if (!years.includes(ui.statementYear)) ui.statementYear = defaultStatementYear(years, ctx.today);
  const fy = ui.statementYear;
  const rows = donorYears(org, fy);
  const docs = rows.map((y) => statementDoc(org, fy, y, ctx.today));
  const { start, end } = fyRange(fy);
  const unlinked = org.gifts.filter((g) => !g.excluded && !g.donorId && g.date >= start && g.date <= end);
  const total = rows.reduce((n, y) => n + y.totalCents, 0);
  const notEnded = financialYear(ctx.today) <= fy;

  return h(
    'section',
    { class: 'view' },
    h('h2', {}, 'Annual statements'),
    h('p', {}, 'One statement per donor for the year to 30 June, listing every gift and its receipt number. Donors use it with their tax return.'),
    blockers(ctx),
    h(
      'div',
      { class: 'toolbar' },
      h(
        'label',
        { class: 'inline' },
        'Financial year ',
        h(
          'select',
          {
            name: 'statementYear',
            onchange: (e: Event) => {
              ui.statementYear = Number((e.target as HTMLSelectElement).value);
              ui.preview = null;
              ctx.update();
            },
          },
          (years.length ? years : [fy]).map((y) => h('option', { value: y, selected: y === fy }, `${fyLabel(y)} (to 30 June ${y})`)),
        ),
      ),
    ),
    notEnded ? h('p', { class: 'callout warn' }, `The ${fyLabel(fy)} year has not ended yet, so these statements are a running total.`) : null,
    unlinked.length
      ? h(
          'p',
          { class: 'callout warn' },
          `${unlinked.length} gift${unlinked.length === 1 ? '' : 's'} in ${fyLabel(fy)} ${unlinked.length === 1 ? 'has' : 'have'} no donor yet and ${unlinked.length === 1 ? 'is' : 'are'} on no statement. `,
          h(
            'button',
            {
              type: 'button',
              class: 'link',
              onclick: () => {
                ui.giftFilter = 'open';
                ui.giftYear = fy;
                ctx.go('gifts');
              },
            },
            'Link them',
          ),
        )
      : null,
    rows.length
      ? [
          h('p', {}, h('strong', {}, `${rows.length} donor${rows.length === 1 ? '' : 's'} gave ${formatMoney(total)} in ${fyLabel(fy)}.`)),
          h(
            'div',
            { class: 'actions' },
            h(
              'button',
              {
                type: 'button',
                id: 'all-statements',
                disabled: !!orgProblems(org).length,
                onclick: () => download(`statements-${fyLabel(fy)}.pdf`, renderPdf(docs, `Statements ${fyLabel(fy)}`), 'application/pdf'),
              },
              `Download all ${rows.length} statements (one PDF)`,
            ),
            h('button', { type: 'button', class: 'secondary', onclick: () => download(`statements-${fyLabel(fy)}.csv`, statementsCsv(org, fy), 'text/csv') }, 'Statement list (CSV)'),
          ),
          previewPanel(ctx),
          h(
            'div',
            { class: 'scroll' },
            h(
              'table',
              { class: 'list' },
              h('thead', {}, h('tr', {}, ['Donor', 'Gifts', 'Total', ''].map((c) => h('th', { scope: 'col' }, c)))),
              h(
                'tbody',
                {},
                rows.map((y, i) =>
                  h(
                    'tr',
                    {},
                    h('td', {}, y.donor.name),
                    h('td', { class: 'num' }, String(y.gifts.length)),
                    h('td', { class: 'num' }, formatMoney(y.totalCents)),
                    h('td', { class: 'row-actions' }, previewButton(ctx, docs[i]!), pdfButton('PDF', [docs[i]!], docs[i]!.filename), emailLink(y.donor.email, ctx, docs[i]!)),
                  ),
                ),
              ),
            ),
          ),
        ]
      : h('p', { class: 'hint' }, `No linked gifts in ${fyLabel(fy)}.`),
  );
}
