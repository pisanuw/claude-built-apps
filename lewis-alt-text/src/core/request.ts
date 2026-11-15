/**
 * The user turn of one request: the image, then the user's answers to the
 * skill's usual clarifying questions. Runs in the browser and in Node.
 */

export const PURPOSES = {
  unknown: 'not specified',
  question: 'a question or problem students must solve (do not give away answers)',
  'answer-key': 'an answer key (describe all instructor-provided information shown)',
} as const;

export const FOCUSES = {
  unknown: 'not specified',
  lewis: 'Lewis structures (exact lone pair locations matter)',
  resonance: 'resonance',
  'formal-charge': 'formal charges',
  geometry: 'molecular geometry',
  polarity: 'bond polarity',
  other: 'other (see context)',
} as const;

export type Purpose = keyof typeof PURPOSES;
export type Focus = keyof typeof FOCUSES;
export type MediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

export interface Options {
  purpose: Purpose;
  focus: Focus;
  context: string;
  audit: boolean;
}

export const MAX_CONTEXT_CHARS = 2000;

/** Thrown for input the caller can fix; the message is shown as is. */
export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputError';
  }
}

export function normaliseOptions(o: Partial<Record<keyof Options, unknown>> = {}): Options {
  const purpose = (o.purpose ?? 'unknown') as string;
  const focus = (o.focus ?? 'unknown') as string;
  if (!(purpose in PURPOSES)) throw new InputError(`purpose must be one of: ${Object.keys(PURPOSES).join(', ')}`);
  if (!(focus in FOCUSES)) throw new InputError(`focus must be one of: ${Object.keys(FOCUSES).join(', ')}`);
  const context = String(o.context ?? '').trim();
  if (context.length > MAX_CONTEXT_CHARS) throw new InputError(`context is longer than ${MAX_CONTEXT_CHARS} characters`);
  const audit = o.audit === true || o.audit === 'true' || o.audit === 'on';
  return { purpose: purpose as Purpose, focus: focus as Focus, context, audit };
}

/** The image type from its first bytes; null when it is not one the API accepts. */
export function sniffType(b: Uint8Array): MediaType | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length > 11 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** Base64 without Buffer, so the same code runs in the browser. */
export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function userText(opts: Options): string {
  const lines = [
    'Write the alt text for the attached figure.',
    `Figure purpose: ${PURPOSES[opts.purpose]}.`,
    `Instructional focus: ${FOCUSES[opts.focus]}.`,
    `Context from the user: ${opts.context || 'none given'}`,
  ];
  if (opts.audit) lines.push('Show the verification audit.');
  return lines.join('\n');
}

export interface ImageBlock {
  type: 'image';
  source: { type: 'base64'; media_type: MediaType; data: string };
}
export interface TextBlock {
  type: 'text';
  text: string;
}
export interface UserMessage {
  role: 'user';
  content: [ImageBlock, TextBlock];
}

/** Image first, then the text, as the Messages API recommends. */
export function userMessage(base64: string, mediaType: MediaType, opts: Options): UserMessage {
  return {
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
      { type: 'text', text: userText(opts) },
    ],
  };
}
