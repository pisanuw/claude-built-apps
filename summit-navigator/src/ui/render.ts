import type { Session, TimeBlock } from '../core/types';
import { dayLabel } from '../core/schedule';
import { timeLabel, timeRangeLabel, type SessionStatus } from '../core/clock';

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export interface CardDeps {
  trackNames: Map<string, { name: string; color: string }>;
  confZone: string;
  viewZone: string | null;
  isStarred(id: string): boolean;
  onToggleStar(id: string): void;
  status(s: Session): SessionStatus;
}

const KIND_LABEL: Record<Session['kind'], string> = {
  keynote: 'Keynote',
  panel: 'Panel',
  talks: 'Talks',
  workshop: 'Workshop',
  papers: 'Papers',
  break: 'Break',
  social: 'Social',
};

export function renderCard(s: Session, deps: CardDeps): HTMLElement {
  const status = deps.status(s);
  const card = el('article', 'card');
  if (s.kind === 'break') card.classList.add('dim');
  if (status === 'now') card.classList.add('live');

  const time = el('div', 'time');
  time.textContent = timeRangeLabel(s, deps.confZone, deps.viewZone);
  if (status === 'now') {
    time.append(' · ');
    time.append(Object.assign(el('span', 'live-tag'), { textContent: 'ON NOW' }));
  }
  card.append(time);

  card.append(el('h3', undefined, s.title));

  const badges = el('div', 'badges');
  const track = deps.trackNames.get(s.track);
  if (track) {
    const chip = el('span', 'badge', track.name);
    chip.style.background = track.color;
    badges.append(chip);
  }
  if (s.kind !== 'talks') {
    const kind = el('span', 'badge', KIND_LABEL[s.kind]);
    kind.style.background = '#64748b';
    badges.append(kind);
  }
  badges.append(el('span', 'badge room', s.room));
  if (s.invitationOnly) badges.append(el('span', 'badge invite', 'Invitation only'));
  card.append(badges);

  if (s.speakers.length > 0) {
    card.append(el('p', 'speakers', s.speakers.join(' · ')));
  }

  if (s.description) {
    const desc = el('p', 'desc', s.description);
    desc.hidden = true;
    card.append(desc);
    card.addEventListener('click', (ev) => {
      if ((ev.target as HTMLElement).closest('.star')) return;
      desc.hidden = !desc.hidden;
    });
    card.style.cursor = 'pointer';
  }

  const star = el('button', 'star', deps.isStarred(s.id) ? '★' : '☆');
  star.setAttribute('aria-pressed', String(deps.isStarred(s.id)));
  star.setAttribute('aria-label', `Star "${s.title}"`);
  star.addEventListener('click', () => deps.onToggleStar(s.id));
  card.append(star);

  return card;
}

export function renderBlocks(blocks: TimeBlock[], deps: CardDeps): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const block of blocks) {
    const day = block.sessions[0].day;
    frag.append(el('div', 'block-time', timeLabel(day, block.start, deps.confZone, deps.viewZone)));
    for (const s of block.sessions) frag.append(renderCard(s, deps));
  }
  return frag;
}

export function renderDayTab(day: string, selected: boolean): HTMLButtonElement {
  const { weekday, label } = dayLabel(day);
  const btn = el('button', 'daytab');
  btn.setAttribute('role', 'tab');
  btn.setAttribute('aria-selected', String(selected));
  const b = el('b', undefined, weekday);
  btn.append(b, document.createTextNode(label));
  return btn;
}
