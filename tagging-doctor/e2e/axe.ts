/**
 * The axe step shared by the e2e specs (AC-56, AC-60): axe-core is pinned in
 * package.json and injected from node_modules, so nothing is fetched.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import type { Page } from '@playwright/test';

const AXE = fs.readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

interface AxeViolation {
  id: string;
  impact: string | null;
  nodes: { target: unknown[] }[];
}

/** axe's WCAG 2.1 A and AA rules and its best practices on the page as it stands; the serious and critical ones. */
export async function axe(page: Page, label: string): Promise<string[]> {
  await page.addScriptTag({ content: AXE });
  const violations = await page.evaluate(async () => {
    const w = window as unknown as { axe: { run: (ctx: Document, opts: unknown) => Promise<{ violations: AxeViolation[] }> } };
    const r = await w.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target) }));
  });
  for (const v of violations) console.log(`axe ${label}: ${v.impact} ${v.id} ${JSON.stringify(v.nodes).slice(0, 200)}`);
  return violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id} ${JSON.stringify(v.nodes).slice(0, 200)}`);
}
