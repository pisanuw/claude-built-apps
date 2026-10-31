/**
 * The piece lab's model: one invented piece, dropped into a built-in setup
 * in place of an existing piece, for both sides or for one side only.
 */
import { tryParse } from './notation';
import { BUILT_IN, type PieceDef, type VariantDef } from './variants';

export interface CustomPiece {
  name: string;
  symbol: string;
  notation: string;
}

export interface LabSpec {
  base: string;
  piece: CustomPiece;
  /** Id of the piece type it replaces. */
  replace: string;
  scope: 'both' | 'white' | 'black';
}

export const CUSTOM_ID = 'custom';

export const DEFAULT_PIECE: CustomPiece = { name: 'Gryphon', symbol: 'Gr', notation: 'F>R' };

export function baseVariant(id: string): VariantDef {
  return BUILT_IN.find((v) => v.id === id) ?? BUILT_IN[0];
}

/** Pieces the lab may replace: anything that is neither royal nor a pawn and appears in the setup. */
export function replaceable(v: VariantDef): PieceDef[] {
  const used = new Set(v.setup.map((p) => p.piece));
  return v.pieces.filter((p) => !p.royal && !p.pawn && used.has(p.id));
}

export function validatePiece(p: CustomPiece): string | null {
  if (!p.name.trim()) return 'Give the piece a name.';
  if (!/^\S{1,2}$/u.test(p.symbol.trim())) return 'The symbol must be one or two characters.';
  const r = tryParse(p.notation);
  return 'error' in r ? `Notation: ${r.error} (at character ${r.at + 1}).` : null;
}

export function buildVariant(spec: LabSpec): VariantDef {
  const base = baseVariant(spec.base);
  const err = validatePiece(spec.piece);
  if (err) throw new Error(err);
  if (!replaceable(base).some((p) => p.id === spec.replace)) throw new Error(`cannot replace '${spec.replace}' in ${base.name}`);
  const custom: PieceDef = {
    id: CUSTOM_ID,
    name: spec.piece.name.trim(),
    symbol: spec.piece.symbol.trim(),
    notation: spec.piece.notation,
    history: 'Your invention. Its value is estimated from its mobility on this board.',
  };
  const replaced = base.pieces.find((p) => p.id === spec.replace) as PieceDef;
  if (spec.scope === 'both') {
    return {
      ...base,
      id: `${base.id}+custom`,
      name: `${base.name} with ${custom.name} for ${replaced.name}`,
      pieces: [...base.pieces.map((p) => (p.promotesTo === spec.replace ? { ...p, promotesTo: CUSTOM_ID } : p)), custom],
      setup: base.setup.map((p) => (p.piece === spec.replace ? { ...p, piece: CUSTOM_ID } : p)),
    };
  }
  return {
    ...base,
    id: `${base.id}+custom-${spec.scope}`,
    name: `${base.name}, ${spec.scope === 'white' ? 'White' : 'Black'} has ${custom.name} for ${replaced.name}`,
    pieces: [...base.pieces, custom],
    asymmetric: { color: spec.scope === 'white' ? 0 : 1, replace: spec.replace, with: CUSTOM_ID },
  };
}

/* Share links: the spec as base64url JSON. */

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function encodeSpec(spec: LabSpec): string {
  return toBase64Url(JSON.stringify([spec.base, spec.piece.name, spec.piece.symbol, spec.piece.notation, spec.replace, spec.scope]));
}

export function decodeSpec(code: string): LabSpec | null {
  try {
    const a = JSON.parse(fromBase64Url(code)) as unknown;
    if (!Array.isArray(a) || a.length !== 6 || !a.every((x) => typeof x === 'string')) return null;
    const [base, name, symbol, notation, replace, scope] = a as string[];
    if (scope !== 'both' && scope !== 'white' && scope !== 'black') return null;
    const spec: LabSpec = { base, piece: { name, symbol, notation }, replace, scope };
    buildVariant(spec);
    return spec;
  } catch {
    return null;
  }
}
