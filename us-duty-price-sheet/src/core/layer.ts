// The extra US duty on goods made in the UK (the "Chapter 99 layer").
//
// Curated by hand. Checked 2026-11-08 against HTS 2026 Revision 22, where
// heading 9903.05.81 reads "The duty provided in the applicable subheading + 10%"
// for "articles the product of the United Kingdom". A test compares the
// percentage below with the bundled data, so a refresh that changes it fails
// loudly until this file is updated too.

export interface LayerPeriod {
  from: string;
  to: string | null;
  percent: number;
  heading: string;
  authority: string;
}

export const UK_LAYER = {
  heading: '9903.05.81',
  percent: 10,
  since: '2026-07-24',
  authority: 'Section 301 of the Trade Act of 1974 (USTR notice, 91 FR 47318)',
  checked: '2026-11-08',
  exemptions:
    'Not charged on goods listed under headings 9903.05.85 to 9903.05.92 and 9903.05.96 (for example whisky and some medical devices), on goods in US note 52(b) and (c), or on steel, aluminium and other goods that pay Section 232 duties instead.',
};

/** What the UK layer has been this year, newest last. */
export const UK_LAYER_HISTORY: LayerPeriod[] = [
  { from: '2025-04-05', to: '2026-02-23', percent: 10, heading: 'IEEPA', authority: 'IEEPA baseline tariff (ended by the Supreme Court, 20 Feb 2026)' },
  { from: '2026-02-24', to: '2026-07-23', percent: 10, heading: '9903.03.01', authority: 'Section 122 surcharge (expired 24 Jul 2026)' },
  { from: '2026-07-24', to: null, percent: 10, heading: '9903.05.81', authority: 'Section 301 duty on UK goods' },
];
