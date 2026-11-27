// App shell: header, tabs and a tiny hash router.

import { decodeChallenge, encodeChallenge, generate, type Tier } from '../core/challenge';
import { ChallengeView } from './challengeView';
import { clear, el } from './dom';
import { InstructorView } from './instructorView';
import { SandboxView } from './sandboxView';
import { SignatureService } from './signatures';
import { aboutView } from './about';

type Tab = 'challenge' | 'sandbox' | 'instructor' | 'about';
const TABS: [Tab, string][] = [
  ['challenge', 'Challenge'],
  ['sandbox', 'Sandbox'],
  ['instructor', 'Instructor'],
  ['about', 'How it works'],
];

export function mountApp(root: HTMLElement): void {
  clear(root);
  const sigs = new SignatureService();
  const nav = el('nav', { class: 'tabs' });
  const main = el('main');
  root.append(
    el(
      'header',
      {},
      el('div', { class: 'title-row' }, el('h1', {}, 'Pull the Pin'), el('hw-theme-toggle')),
      el('p', { class: 'muted' }, 'A tiny 8-bit computer, simulated pin by pin, with one thing broken. Run test programs, spend probes on a logic analyzer, and name the faulty chip, pin or line.'),
      nav,
    ),
    main,
  );

  const parse = (): { tab: Tab; code: string | null } => {
    const m = /^#\/(\w+)(?:\?c=([\w-]+))?/.exec(location.hash);
    const tab = (TABS.find(([t]) => t === m?.[1])?.[0] ?? 'challenge') as Tab;
    return { tab, code: m?.[2] ?? null };
  };

  const newChallenge = (tier: Tier) => {
    const c = generate(Math.floor(Math.random() * 1e9), tier);
    location.hash = `#/challenge?c=${encodeChallenge(c)}`;
  };

  let shownCode: string | null = null;
  const route = () => {
    const { tab, code } = parse();
    clear(nav);
    for (const [t, label] of TABS) nav.append(el('a', { href: `#/${t}`, class: t === tab ? 'active' : '' }, label));
    if (tab === 'challenge') {
      const challenge = code ? decodeChallenge(code) : null;
      if (!challenge) {
        newChallenge('bench');
        return;
      }
      if (shownCode === code && main.firstElementChild?.classList.contains('challenge')) return;
      shownCode = code;
      clear(main);
      main.append(new ChallengeView(challenge, sigs, newChallenge).root);
      return;
    }
    shownCode = null;
    clear(main);
    if (tab === 'sandbox') main.append(new SandboxView().root);
    else if (tab === 'instructor') main.append(new InstructorView().root);
    else main.append(aboutView());
  };
  window.addEventListener('hashchange', route);
  route();
}
