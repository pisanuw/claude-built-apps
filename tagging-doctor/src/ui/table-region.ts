/**
 * The box around a table that may be wider than the screen (AC-54, AC-55;
 * D-165, R6.1-1): it scrolls sideways on its own, is a region named by the
 * table's caption, and takes the keyboard's focus (`tabindex="0"`), so a
 * keyboard can scroll it in every browser. Every table builder of the page
 * uses this one; `regionHtml` (src/core/report.ts) writes the same box as markup
 * for the downloaded reports.
 */
export function tableRegion(table: HTMLTableElement, name?: string): HTMLDivElement {
  const label = name ?? table.querySelector('caption')?.textContent?.trim() ?? 'Table';
  const d = document.createElement('div');
  d.className = 'table-wrap';
  d.setAttribute('role', 'region');
  d.setAttribute('aria-label', label);
  d.setAttribute('tabindex', '0');
  d.append(table);
  return d;
}
