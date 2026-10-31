import { DEFAULT_PIECE, type LabSpec } from '../core/lab';
import { BUILT_IN, type VariantDef } from '../core/variants';

/** The lab's current spec, shared by the lab and the play tab. */
export const store = {
  spec: { base: 'timur', piece: { ...DEFAULT_PIECE }, replace: 'giraffe', scope: 'both' } as LabSpec,
  /** Variant the play tab should load next, set by the lab's Play button or a share link. */
  pendingVariant: null as VariantDef | null,
  listeners: new Set<() => void>(),
};

export function builtIn(id: string): VariantDef {
  return BUILT_IN.find((v) => v.id === id) ?? BUILT_IN[0];
}

export function notify(): void {
  for (const l of store.listeners) l();
}
