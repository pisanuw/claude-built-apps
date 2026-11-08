import { UK_LAYER } from '../core/layer';
import { CATEGORIES } from '../core/categories';
import { PDDP_LIMIT_USD } from '../core/pricing';
import { h } from './dom';
import { ukDate } from '../core/money';
import type { Ctx } from './ctx';

export function aboutView(ctx: Ctx): HTMLElement {
  const d = ctx.index.data;
  return h('section', { class: 'prose' },
    h('h2', null, 'How it works'),
    h('h3', null, 'Why this exists'),
    h('p', null, 'US orders sent by post now have to be duty-paid, and every product needs its own 10-digit US code (UK commodity codes are not accepted). Working out the duty once is hard enough; redoing a whole catalogue every time a US rate moves is what makes many makers give up on US buyers. This sheet keeps the codes, does the sums, and tells you which prices to change.'),
    h('h3', null, 'Where the duty comes from'),
    h('ol', null,
      h('li', null, h('strong', null, 'The general rate'), ` of each code, from the official US tariff schedule (${d.revisionTitle}, published by the US International Trade Commission). The app carries ${d.lines.length.toLocaleString('en-GB')} lines from the chapters handmade goods fall into, with their full legal wording.`),
      h('li', null, h('strong', null, `Plus ${UK_LAYER.percent}% for goods made in the UK`), ` (heading ${UK_LAYER.heading}, in force since ${ukDate(UK_LAYER.since)}). This layer is checked by hand against official notices and dated.`),
      h('li', null, h('strong', null, 'Plus any weight or per-item part'), ' some codes add, such as wool hats at 25.4¢ per kg. These are converted to pounds at your exchange rate.')),
    h('p', null, `Royal Mail collects the duty when you buy the label, adds a small handling fee per parcel, and takes duty-paid parcels to the US valued up to $${PDDP_LIMIT_USD.toLocaleString('en-US')}.`),
    h('h3', null, 'Two ways to pass it on'),
    h('p', null, h('strong', null, 'In the postage: '), 'US postage = label price + duty on the item + handling fee. Each extra item in the same parcel adds its own duty.'),
    h('p', null, h('strong', null, 'In the price: '), 'US price = (UK price + handling fee) ÷ (1 − duty rate). Duty is charged on what the customer pays, so the price has to cover the duty on itself; this formula leaves you exactly your UK price after duty.'),
    h('h3', null, 'Choosing codes'),
    h('p', null, `${CATEGORIES.length} common handmade product types come with suggested codes and a plain note on when each applies. Always read the official wording before you confirm: the right code depends on material, construction and sometimes value. If none fits, search the wording, or look your product up on hts.usitc.gov and type the code in.`),
    h('h3', null, 'Keeping up with changes'),
    h('p', null, `The US updates its tariff schedule many times a year; the data here is ${d.revisionTitle}. When this app’s data is updated, it shows which of your codes changed. After you copy the sheet into your shop, save the figures; the What changed page then lists every product whose US price or postage should move, and why.`),
    h('h3', null, 'Limits'),
    h('ul', null,
      h('li', null, 'Estimates only, not a binding ruling. You declare the code and value, and you are responsible for them.'),
      h('li', null, 'Only goods made in the UK and posted with Royal Mail duty paid. Goods made elsewhere pay their own country’s rate; set it by hand.'),
      h('li', null, 'Postage prices are yours to enter. Royal Mail changes them, usually each April.'),
      h('li', null, 'The tariff data is updated when the app is, not live. The date of the data is shown at the top of every page.'),
      h('li', null, 'It does not file anything with US Customs or Royal Mail, and it does not cover the EU’s per-parcel duty.')),
  );
}
