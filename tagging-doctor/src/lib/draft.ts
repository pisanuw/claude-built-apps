/**
 * Alt-text drafts for the figure panel (milestone 5a; AC-46, AC-47, AC-50).
 *
 * With the person's own key, the request goes from the browser to
 * api.anthropic.com only (llm.ts, 'byok'); signed in without a key, it goes
 * to the llm-gateway function as app "tagging-doctor" ('gateway'). One draft
 * is one non-streaming call on the cheapest model the gateway allows, with
 * thinking off and effort low (S2-12, D-142). Every request is measured
 * before it is sent: over the gateway's 1,000,000 bytes it is never sent.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { FigureItem } from '../core/figures';
import { ImageError, prepareImage, type ImageDeps, type PreparedImage } from '../core/image';
import { ask as realAsk, CapReached, GATEWAY_APP, GatewayError, isRefusal, LlmUnavailable, requestBody, textOf, type AskDeps, type AskRequest, type Message } from './llm';

export const DRAFT_MODEL = 'claude-haiku-5-5';
export const DRAFT_MAX_TOKENS = 400;
/** The gateway's limit on a request body (new-app-guide section 7); a direct call keeps the same one. */
export const MAX_REQUEST_BYTES = 1_000_000;
/** AC-50. */
export const DRAFT_ALL_LIMIT = 40;
export const DRAFT_CONCURRENCY = 3;

export const DRAFT_SYSTEM = [
  'You write alt text for figures in university course materials: mathematics, statistics, computer science, physics and engineering.',
  'Write one or two plain sentences, at most 250 characters, that say what the figure shows and what a student should take from it, using the caption and the surrounding text.',
  'Do not begin with "Image of", "Picture of" or "Figure showing". Write mathematics in words or plain symbols, never as LaTeX code.',
  'When no image is attached, describe the figure only from the text, and do not invent details the text does not give.',
  'Reply with the alt text only.',
].join(' ');

export type DraftMode = 'byok' | 'gateway';

/** Own key first (no sign-in needed, AC-46); else HintWise's key for a signed-in person (AC-47); else none. */
export function draftMode(hasKey: boolean, signedIn: boolean): DraftMode | null {
  if (hasKey) return 'byok';
  return signedIn ? 'gateway' : null;
}

export const NO_MODE = 'Paste your own Anthropic key above, or sign in to draft with HintWise’s key.';

function kindLine(fig: FigureItem, image: PreparedImage | null): string {
  if (fig.kind === 'tikz') return 'A TikZ picture drawn by the document; no image is attached, so write from the text only.';
  if (image) return `An image file, ${fig.file ?? ''}, attached.`;
  return `An image file, ${fig.file ?? ''}, that cannot be attached (${fig.resolved ? 'PDF, EPS or another type with no preview' : 'not in the project'}); write from the text only.`;
}

/** The request for one figure: the image first when there is one, then the text. */
export function draftRequest(fig: FigureItem, image: PreparedImage | null): AskRequest {
  const text = [
    'Write the alt text for this figure of a LaTeX course document.',
    `Figure: ${kindLine(fig, image)}`,
    `Caption: ${fig.caption || '(none)'}`,
    `Label: ${fig.label || '(none)'}`,
    `Text before the figure: ${fig.before || '(none)'}`,
    `Text after the figure: ${fig.after || '(none)'}`,
  ].join('\n');
  const content: Array<Anthropic.Messages.ImageBlockParam | Anthropic.Messages.TextBlockParam> = [];
  if (image) content.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } });
  content.push({ type: 'text', text });
  return {
    model: DRAFT_MODEL,
    max_tokens: DRAFT_MAX_TOKENS,
    system: DRAFT_SYSTEM,
    thinking: { type: 'disabled' },
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content }],
  };
}

/** The bytes of the body as the gateway would get it (the direct call sends the same body without `app`). */
export function requestBytes(req: AskRequest): number {
  return new TextEncoder().encode(JSON.stringify({ app: GATEWAY_APP, ...requestBody(req) })).length;
}

export class RequestTooLarge extends Error {
  constructor(public readonly bytes: number) {
    super(`The request would be ${bytes} bytes, over the limit of ${MAX_REQUEST_BYTES}.`);
    this.name = 'RequestTooLarge';
  }
}

export class NoDraft extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoDraft';
  }
}

export interface Draft {
  text: string;
  /** As `alt_texts.source` spells it (SPEC §5). */
  source: 'model' | 'byok';
  /** No image went with the request. */
  textOnly: boolean;
  /** Why an image that has a preview was not sent, if it was not. */
  imageNote: string | null;
}

export interface DraftDeps {
  mode: DraftMode;
  /** The image's bytes, for a figure with a preview. */
  bytes?: (path: string) => Uint8Array;
  imageDeps?: ImageDeps;
  /** llm.ts's `ask`; tests pass their own. */
  ask?: (req: AskRequest, deps: AskDeps) => Promise<Message>;
  askDeps?: AskDeps;
}

/** One draft. Throws RequestTooLarge (nothing sent), NoDraft, or llm.ts's errors. */
export async function draftFigure(fig: FigureItem, deps: DraftDeps): Promise<Draft> {
  let image: PreparedImage | null = null;
  let imageNote: string | null = null;
  if (fig.preview && fig.resolved && deps.bytes && deps.imageDeps) {
    try {
      image = await prepareImage(deps.bytes(fig.resolved), deps.imageDeps);
    } catch (e) {
      imageNote = `${e instanceof ImageError ? e.message : 'The image could not be read.'} The draft is from the text only.`;
    }
  }
  const req = draftRequest(fig, image);
  const bytes = requestBytes(req);
  if (bytes > MAX_REQUEST_BYTES) throw new RequestTooLarge(bytes);
  const message = await (deps.ask ?? realAsk)(req, { ...deps.askDeps, mode: deps.mode });
  if (isRefusal(message)) throw new NoDraft('The model declined to describe this figure. Write the text yourself.');
  const text = textOf(message).replace(/\s+/g, ' ').trim();
  if (!text) throw new NoDraft('The model gave no text for this figure. Try again, or write the text yourself.');
  return { text, source: deps.mode === 'byok' ? 'byok' : 'model', textOnly: !image, imageNote };
}

/** The cap's scope in the plain words of new-app-guide section 7. */
export function capWords(scope: string): string {
  if (scope === 'user-day') return 'your daily HintWise allowance is used up';
  if (scope === 'app-user-day' || scope === 'app-user-day-calls') return 'your daily allowance in this app is used up';
  if (scope === 'app-user-week' || scope === 'app-user-week-calls') return 'your weekly allowance in this app is used up';
  return 'this app’s shared allowance is used up';
}

/** A time in the person's own zone: "Tue, 01:00 CET". */
export function localTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'later';
  return d.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
}

export const NOT_REGISTERED = 'Drafting with HintWise’s key is not available yet; use your own key.';

/** Any failure of a draft, in plain words (AC-47). */
export function draftErrorWords(e: unknown): string {
  if (e instanceof CapReached) return `HintWise’s key cannot draft now: ${capWords(e.scope)} until ${localTime(e.resetsAt)}. To go on, use your own key: paste it above.`;
  if (e instanceof GatewayError) {
    const body = e.body as { error?: unknown } | null;
    if (e.status === 403 && body && body.error === 'app') return NOT_REGISTERED;
    if (e.status === 401) return 'Your sign-in has expired. Sign in again, or use your own key.';
    return `HintWise’s key could not draft this one (the gateway answered ${e.status}). Try again, or use your own key.`;
  }
  if (e instanceof RequestTooLarge) return `This figure’s request would be ${e.bytes.toLocaleString('en-US')} bytes, over the limit of 1,000,000, so it was not sent. Write the text yourself.`;
  if (e instanceof NoDraft || e instanceof LlmUnavailable) return e.message;
  const status = typeof e === 'object' && e !== null ? (e as { status?: unknown }).status : undefined;
  if (status === 401) return 'Anthropic refused your key. Check it, or forget it and paste it again.';
  if (status === 429) return 'Anthropic is limiting your key for now. Wait a minute and try again.';
  if (typeof status === 'number') return `Anthropic answered ${status}. Try again in a moment.`;
  return 'The draft could not be made: the connection failed. Try again.';
}

export interface DraftAllResult {
  /** How many drafts were asked for in this run. */
  started: number;
  /** Set when a cap stopped the run. */
  cap: CapReached | null;
  /** Figures left for another run (over the limit, or not started after the cap). */
  left: number;
}

/**
 * "Draft all" (AC-50): at most `concurrency` calls at once, at most `limit`
 * figures, and no new call after the first cap error. `run` makes one draft
 * and throws only what should stop the run (a CapReached); other failures
 * are its own to show.
 */
export async function draftAll<T>(items: readonly T[], run: (item: T) => Promise<void>, opts: { limit?: number; concurrency?: number; stopped?: () => boolean } = {}): Promise<DraftAllResult> {
  const limit = opts.limit ?? DRAFT_ALL_LIMIT;
  const todo = items.slice(0, limit);
  let next = 0;
  let started = 0;
  let cap: CapReached | null = null;
  const worker = async () => {
    while (next < todo.length && !cap && !opts.stopped?.()) {
      const item = todo[next++];
      started++;
      try {
        await run(item);
      } catch (e) {
        if (e instanceof CapReached) cap ??= e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? DRAFT_CONCURRENCY, todo.length) }, worker));
  return { started, cap, left: items.length - started };
}
