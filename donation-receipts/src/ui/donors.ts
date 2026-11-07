import { financialYear, fyLabel } from '../core/dates';
import { backupJson, giftsCsv } from '../core/exports';
import { formatMoney } from '../core/money';
import { activeOrg, newId, newOrg, type Donor } from '../core/model';
import type { Ctx } from './ctx';
import { download, field, h } from './dom';

function donorRow(ctx: Ctx, d: Donor, fy: number): HTMLElement {
  const { org } = ctx;
  const gifts = org.gifts.filter((g) => g.donorId === d.id && !g.excluded);
  const thisYear = gifts.filter((g) => financialYear(g.date) === fy).reduce((n, g) => n + g.amountCents, 0);
  const receipted = gifts.some((g) => g.receiptNo) || org.receipts.some((r) => r.donorId === d.id);
  const input = (key: 'name' | 'email' | 'address', label: string, type = 'text') =>
    h('input', {
      type,
      value: d[key],
      'aria-label': `${label} for ${d.name}`,
      oninput: (e: Event) => {
        d[key] = (e.target as HTMLInputElement).value;
        ctx.save();
      },
    });
  return h(
    'tr',
    { 'data-donor': d.id },
    h('td', {}, input('name', 'Name')),
    h('td', {}, input('email', 'Email', 'email')),
    h('td', {}, input('address', 'Address')),
    h('td', { class: 'num' }, formatMoney(thisYear), h('span', { class: 'hint block' }, `${gifts.length} gift${gifts.length === 1 ? '' : 's'} in all`)),
    h(
      'td',
      { class: 'aliases' },
      d.aliases.map((a) =>
        h(
          'span',
          { class: 'tag' },
          a,
          h(
            'button',
            {
              type: 'button',
              class: 'x',
              'aria-label': `Forget “${a}” for ${d.name}`,
              onclick: () => {
                d.aliases = d.aliases.filter((x) => x !== a);
                ctx.update();
              },
            },
            '×',
          ),
        ),
      ),
    ),
    h(
      'td',
      {},
      receipted
        ? h('span', { class: 'hint' }, 'has receipts')
        : h(
            'button',
            {
              type: 'button',
              class: 'small danger',
              onclick: () => {
                if (!window.confirm(`Remove ${d.name}? Their gifts go back to "Need a donor".`)) return;
                org.donors = org.donors.filter((x) => x.id !== d.id);
                for (const g of org.gifts) if (g.donorId === d.id) delete g.donorId;
                ctx.update();
              },
            },
            'Remove',
          ),
    ),
  );
}

export function donorsView(ctx: Ctx): HTMLElement {
  const { org } = ctx;
  const fy = financialYear(ctx.today);
  const name = h('input', { type: 'text', name: 'newName', required: true, autocomplete: 'off' });
  const email = h('input', { type: 'email', name: 'newEmail', autocomplete: 'off' });
  const address = h('input', { type: 'text', name: 'newAddress', autocomplete: 'off' });
  const form = h(
    'form',
    {
      class: 'add-donor',
      onsubmit: (e: Event) => {
        e.preventDefault();
        if (!name.value.trim()) return;
        org.donors.push({ id: newId('d'), name: name.value.trim(), email: email.value.trim(), address: address.value.trim(), aliases: [] });
        ctx.update();
        ctx.flash(`Added ${name.value.trim()}.`);
      },
    },
    field('Name', name),
    field('Email', email),
    field('Address', address),
    h('button', { type: 'submit' }, 'Add donor'),
  );
  const donors = [...org.donors].sort((a, b) => a.name.localeCompare(b.name));
  return h(
    'section',
    { class: 'view' },
    h('h2', {}, 'Donors'),
    h(
      'p',
      {},
      'Edits save as you type. "Bank text" is what this donor’s gifts arrive as; it is learned when you link a gift, and remove one if it was a mistake.',
    ),
    form,
    donors.length
      ? h(
          'div',
          { class: 'scroll' },
          h(
            'table',
            { class: 'list donors' },
            h('thead', {}, h('tr', {}, ['Name', 'Email', 'Address', `Given ${fyLabel(fy)}`, 'Bank text', ''].map((c) => h('th', { scope: 'col' }, c)))),
            h('tbody', {}, donors.map((d) => donorRow(ctx, d, fy))),
          ),
        )
      : h('p', { class: 'hint' }, 'No donors yet. They can also be added from the Gifts tab, straight from the bank text.'),
  );
}

export function backupView(ctx: Ctx, onRestore: (text: string) => void): HTMLElement {
  const { data, org } = ctx;
  const input = h('input', {
    type: 'file',
    accept: '.json,application/json',
    class: 'visually-hidden',
    onchange: async (e: Event) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (f) onRestore(await f.text());
    },
  });
  return h(
    'section',
    { class: 'view' },
    h('h2', {}, 'Backup and files'),
    h(
      'p',
      {},
      'Your records live only in this browser on this computer. Download a backup after each session and keep it with your other finance records; restore it on another computer to carry on there.',
    ),
    h(
      'div',
      { class: 'actions' },
      h(
        'button',
        { type: 'button', id: 'backup', onclick: () => download(`donation-receipts-backup-${ctx.today}.json`, backupJson(data), 'application/json') },
        'Download backup',
      ),
      h('label', { class: 'button secondary' }, input, 'Restore a backup…'),
      h('button', { type: 'button', class: 'secondary', onclick: () => download(`gifts-${ctx.today}.csv`, giftsCsv(org), 'text/csv') }, 'All gifts (CSV)'),
    ),
    h('h3', {}, 'Remove this organisation'),
    h('p', { class: 'hint' }, `Deletes ${org.name} and all its gifts, donors and receipts from this browser. Download a backup first.`),
    h(
      'button',
      {
        type: 'button',
        class: 'danger',
        id: 'remove-org',
        onclick: () => {
          if (!window.confirm(`Delete ${org.name} and all its records from this browser?`)) return;
          data.orgs = data.orgs.filter((o) => o.id !== org.id);
          if (!data.orgs.length) data.orgs = [newOrg()];
          data.activeOrgId = data.orgs[0]!.id;
          ctx.go(activeOrg(data).gifts.length ? 'gifts' : 'setup');
        },
      },
      'Delete organisation',
    ),
  );
}
