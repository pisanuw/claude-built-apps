import type { Catalog } from '../core/model';
import type { HtsIndex, RateChange } from '../core/hts';
import type { Store } from '../core/storage';

export type Tab = 'products' | 'sheet' | 'changes' | 'settings' | 'about';

export interface Ctx {
  catalog: Catalog;
  index: HtsIndex;
  history: RateChange[];
  store: Store | null;
  today: string;
  tab: Tab;
  /** Product being edited, if any. */
  editing: string | null;
  /** True while the CSV import panel is open. */
  importing: boolean;
  /** Last message shown in the status line. */
  flash: string;
  saveFailed: boolean;
  /** Persist and redraw. */
  commit(message?: string): void;
  /** Redraw without saving. */
  render(): void;
  go(tab: Tab): void;
}
