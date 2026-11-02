import { emptyProject, type Project, type RuleOutcome, type RuleResult, type Screen } from '../src/core/project';

export function rule(id: string, outcome: RuleOutcome, criteria: string[], nodes = 1, help = `${id} help`): RuleResult {
  return { id, help, helpUrl: `https://dequeuniversity.com/rules/axe/4.11/${id}`, impact: outcome === 'pass' ? null : 'serious', outcome, criteria, nodes, targets: nodes ? [`#${id}`] : [] };
}

export function screen(name: string, rules: RuleResult[] | null): Screen {
  return { id: name.toLowerCase().replace(/\W+/g, '-'), name, url: `https://app.example/${name}`, scan: rules ? { source: 'axe-json', engine: 'axe-core 4.11.0', url: '', timestamp: '2026-10-30T00:00:00Z', rules } : null };
}

export function project(screens: Screen[] = [], extra: Partial<Project> = {}): Project {
  return { ...emptyProject('2026-11-02'), screens, ...extra };
}
