import { financialYear, fyLabel, shortDate } from '../core/dates';
import { giftProblems } from '../core/documents';
import { acceptStrongMatches, donorFromGift, linkGift, nameFromBankText, suggestDonors } from '../core/matching';
import { formatMoney } from '../core/money';
import { donorById, type Gift, type Org } from '../core/model';
import type { Ctx, GiftFilter } from './ctx';
import { h } from './dom';

export function giftState(org: Org, g: Gift): Exclude<GiftFilter, 'all'> {
  if (g.excluded) return 'excluded';
  if (g.receiptNo) return 'receipted';
  return giftProblems(org, g).length === 0 ? 'ready' : 'open';
}

const FILTERS: [GiftFilter, string][] = [
  ['open', 'Need a donor'],
  ['ready', 'Ready to receipt'],
  ['receipted', 'Receipted'],
  ['excluded', 'Not donations'],
  ['all', 'All'],
];

function donorCell(ctx: Ctx, g: Gift): HTMLElement {
  const { org } = ctx;
  if (g.receiptNo) {
    return h('td', {}, donorById(org, g.donorId)?.name ?? '', h('span', { class: 'hint block' }, `Receipt ${g.receiptNo}`));
  }
  const suggestions = suggestDonors(org, g);
  const suggestedIds = new Set(suggestions.map((s) => s.donorId));
  const others = [...org.donors].filter((d) => !suggestedIds.has(d.id)).sort((a, b) => a.name.localeCompare(b.name));
  const select = h(
    'select',
    {
      'aria-label': `Donor for ${formatMoney(g.amountCents)} on ${shortDate(g.date)}`,
      disabled: !!g.excluded,
      onchange: (e: Event) => {
        const v = (e.target as HTMLSelectElement).value;
        linkGift(org, g.id, v || undefined);
        ctx.update();
      },
    },
    h('option', { value: '' }, '— choose donor —'),
    suggestions.length
      ? h('optgroup', { label: 'Suggested' }, suggestions.map((s) => h('option', { value: s.donorId, selected: g.donorId === s.donorId }, s.name)))
      : null,
    others.length ? h('optgroup', { label: 'All donors' }, others.map((d) => h('option', { value: d.id, selected: g.donorId === d.id }, d.name))) : null,
  );
  const cell = h('td', { class: 'donor-cell' }, select);
  if (g.excluded) return cell;
  const top = suggestions[0];
  if (!g.donorId && top) {
    cell.append(
      h(
        'div',
        { class: `suggest ${top.strong ? 'strong' : ''}` },
        h(
          'button',
          {
            type: 'button',
            class: 'small',
            onclick: () => {
              linkGift(org, g.id, top.donorId);
              ctx.update();
            },
          },
          `Use ${top.name}`,
        ),
        h('span', { class: 'hint' }, ` ${top.reason}`),
      ),
    );
  }
  if (!g.donorId && !top?.strong) {
    const guess = nameFromBankText(g);
    cell.append(
      h(
        'button',
        {
          type: 'button',
          class: 'link',
          onclick: () => {
            const d = donorFromGift(org, g.id);
            ctx.update();
            ctx.flash(`Added donor ${d!.name}. Add their email and address on the Donors tab.`);
          },
        },
        guess ? `New donor “${guess}”` : 'New donor',
      ),
    );
  }
  return cell;
}

export function giftsView(ctx: Ctx): HTMLElement {
  const { org, ui } = ctx;
  const years = [...new Set(org.gifts.map((g) => financialYear(g.date)))].sort((a, b) => b - a);
  const inYear = org.gifts.filter((g) => !ui.giftYear || financialYear(g.date) === ui.giftYear);
  const counts = new Map<GiftFilter, number>(FILTERS.map(([f]) => [f, 0]));
  for (const g of inYear) {
    const s = giftState(org, g);
    counts.set(s, counts.get(s)! + 1);
  }
  counts.set('all', inYear.length);
  const shown = inYear.filter((g) => ui.giftFilter === 'all' || giftState(org, g) === ui.giftFilter);
  const strongOpen = org.gifts.filter(
    (g) => !g.donorId && !g.excluded && !g.receiptNo && suggestDonors(org, g).some((s) => s.strong),
  ).length;

  if (org.gifts.length === 0) {
    return h(
      'section',
      { class: 'view' },
      h('h2', {}, 'Gifts'),
      h('p', {}, 'No gifts yet. ', h('button', { type: 'button', class: 'link', onclick: () => ctx.go('import') }, 'Import a Xero or bank export'), ' to start.'),
    );
  }

  return h(
    'section',
    { class: 'view' },
    h('h2', {}, 'Gifts'),
    h('p', {}, 'Link each gift to a donor. Suggestions come from the bank text and from gifts you linked before, so this gets quicker every month.'),
    h(
      'div',
      { class: 'toolbar' },
      h(
        'div',
        { class: 'chips', role: 'group', 'aria-label': 'Show' },
        FILTERS.map(([f, label]) =>
          h(
            'button',
            {
              type: 'button',
              class: `chip ${ui.giftFilter === f ? 'on' : ''}`,
              'aria-pressed': ui.giftFilter === f ? 'true' : 'false',
              'data-filter': f,
              onclick: () => {
                ui.giftFilter = f;
                ctx.update();
              },
            },
            `${label} (${counts.get(f)})`,
          ),
        ),
      ),
      h(
        'label',
        { class: 'inline' },
        'Year ',
        h(
          'select',
          {
            name: 'giftYear',
            onchange: (e: Event) => {
              ui.giftYear = Number((e.target as HTMLSelectElement).value);
              ctx.update();
            },
          },
          h('option', { value: 0 }, 'All years'),
          years.map((y) => h('option', { value: y, selected: ui.giftYear === y }, fyLabel(y))),
        ),
      ),
    ),
    strongOpen
      ? h(
          'p',
          {},
          h(
            'button',
            {
              type: 'button',
              id: 'accept-strong',
              onclick: () => {
                const n = acceptStrongMatches(org);
                ctx.update();
                ctx.flash(`Linked ${n} gift${n === 1 ? '' : 's'} to the donor the bank text clearly names.`);
              },
            },
            `Link ${strongOpen} clear match${strongOpen === 1 ? '' : 'es'}`,
          ),
          h('span', { class: 'hint' }, ' Only where one donor clearly fits. Check the rest by hand.'),
        )
      : null,
    counts.get('ready')
      ? h('p', {}, h('button', { type: 'button', class: 'secondary', onclick: () => ctx.go('receipts') }, `Issue receipts for ${counts.get('ready')} ready gifts →`))
      : null,
    shown.length
      ? h(
          'div',
          { class: 'scroll' },
          h(
            'table',
            { class: 'list gifts' },
            h('thead', {}, h('tr', {}, ['Date', 'Amount', 'Bank text', 'Donor', ''].map((c) => h('th', { scope: 'col' }, c)))),
            h(
              'tbody',
              {},
              shown.map((g) =>
                h(
                  'tr',
                  { class: giftState(org, g), 'data-gift': g.id },
                  h('td', { class: 'nowrap' }, shortDate(g.date)),
                  h('td', { class: 'num' }, formatMoney(g.amountCents)),
                  h('td', { class: 'bank' }, [g.payee, g.description, g.reference].filter(Boolean).join(' · ') || '(no text)', g.account ? h('span', { class: 'hint block' }, g.account) : null),
                  donorCell(ctx, g),
                  h(
                    'td',
                    {},
                    g.receiptNo
                      ? null
                      : h(
                          'label',
                          { class: 'check' },
                          h('input', {
                            type: 'checkbox',
                            checked: !!g.excluded,
                            onchange: (e: Event) => {
                              g.excluded = (e.target as HTMLInputElement).checked || undefined;
                              ctx.update();
                            },
                          }),
                          ' Not a donation',
                        ),
                  ),
                ),
              ),
            ),
          ),
        )
      : h('p', { class: 'hint' }, 'Nothing here.'),
  );
}
