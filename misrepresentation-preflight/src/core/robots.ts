/**
 * robots.txt, read the way Google reads it: the group for our user agent if
 * there is one, otherwise the "*" group; the longest matching rule wins and
 * Allow beats Disallow on a tie.
 */
export interface Robots {
  rules: Array<{ allow: boolean; path: string }>;
}

export const ROBOTS_AGENT = 'misrepresentationpreflight';

export function parseRobots(text: string, agent = ROBOTS_AGENT): Robots {
  const groups: Array<{ agents: string[]; rules: Robots['rules'] }> = [];
  let current: { agents: string[]; rules: Robots['rules'] } | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === 'allow' || key === 'disallow') {
      // An empty Disallow means "allow everything" and adds no rule.
      if (value) current.rules.push({ allow: key === 'allow', path: value });
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && agent.includes(a)));
  const chosen = mine.length ? mine : groups.filter((g) => g.agents.includes('*'));
  return { rules: chosen.flatMap((g) => g.rules) };
}

function ruleMatches(rule: string, path: string): boolean {
  const anchored = rule.endsWith('$');
  const body = anchored ? rule.slice(0, -1) : rule;
  const re = new RegExp(`^${body.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}${anchored ? '$' : ''}`);
  return re.test(path);
}

export function allowed(robots: Robots, url: string): boolean {
  let path: string;
  try {
    const u = new URL(url);
    path = `${u.pathname}${u.search}`;
  } catch {
    return false;
  }
  let best: { allow: boolean; length: number } | null = null;
  for (const r of robots.rules) {
    if (!ruleMatches(r.path, path)) continue;
    const length = r.path.length;
    if (!best || length > best.length || (length === best.length && r.allow)) best = { allow: r.allow, length };
  }
  return best ? best.allow : true;
}
