/**
 * Where Gmail put a message found in the seed inbox: finer than Placement
 * (the Updates tab and an archived message are both "other"). Shared by the
 * server's IMAP check and the page.
 */
import type { Placement } from './types';

export type SeedWhere = 'primary' | 'promotions' | 'social' | 'updates' | 'forums' | 'archived' | 'spam';

export const WHERE_PLACEMENT: Record<SeedWhere, Placement> = {
  primary: 'inbox',
  promotions: 'promotions',
  social: 'other',
  updates: 'other',
  forums: 'other',
  archived: 'other',
  spam: 'spam',
};

export const WHERE_TEXT: Record<SeedWhere, string> = {
  primary: 'the Primary inbox',
  promotions: 'the Promotions tab',
  social: 'the Social tab',
  updates: 'the Updates tab',
  forums: 'the Forums tab',
  archived: 'All Mail, outside the inbox (archived or moved by a filter)',
  spam: 'Spam',
};

export const SEED_WHERES = Object.keys(WHERE_TEXT) as SeedWhere[];

/** What the saved report keeps about a check that came from the seed inbox. */
export interface SeedOrigin {
  where: SeedWhere;
  /** When Gmail received it (ISO), or ''. */
  receivedAt: string;
}
