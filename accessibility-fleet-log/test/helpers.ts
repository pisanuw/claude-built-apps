import { emptyFleet, emptySite, type Check, type Finding, type Fleet, type Site } from '../src/core/model';
import { criteriaForRule } from '../src/core/wcag';

export function finding(ruleId: string, count = 1, extra: Partial<Finding> = {}): Finding {
  return { ruleId, help: `${ruleId} help`, criteria: criteriaForRule(ruleId), impact: 'serious', count, ...extra };
}

export function site(id = 's1', extra: Partial<Site> = {}): Site {
  return { ...emptySite(id), name: 'Shop', client: 'Shop Ltd', url: 'https://shop.example.com', owner: 'Shop Ltd', contactEmail: 'a11y@shop.example.com', ...extra };
}

let n = 0;
/** pages: path -> rule ids (or [rule, count]) */
export function check(siteId: string, date: string, pages: Record<string, (string | [string, number])[]>, engine = 'axe-core 4.11.0'): Check {
  n += 1;
  return {
    id: `c${n}`,
    siteId,
    date,
    engine,
    pages: Object.entries(pages).map(([p, rules]) => ({
      url: `https://shop.example.com${p}`,
      findings: rules.map((r) => (Array.isArray(r) ? finding(r[0], r[1]) : finding(r))),
    })),
  };
}

export function fleet(sites: Site[], checks: Check[] = [], extra: Partial<Fleet> = {}): Fleet {
  return { ...emptyFleet(), sites, checks, ...extra };
}
