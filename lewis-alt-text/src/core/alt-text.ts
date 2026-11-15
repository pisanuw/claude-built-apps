/**
 * One request, end to end: prepared image + options in, a result out. The
 * model call is injected: the page passes the template's ask() (HintWise key
 * or the visitor's own key); the CLI passes the local claude CLI.
 */
import { lint, parseReply, type Reply } from './parse.ts';
import { systemBlocks, type SystemBlock } from './prompt.ts';
import { normaliseOptions, userMessage, type MediaType, type Options, type UserMessage } from './request.ts';

export const DEFAULT_MODEL = 'claude-opus-5-5';
/** The gateway clamps max_tokens to the app's limit, 4096 by default. An audit reply measured about 1,400. */
export const MAX_TOKENS = 4096;

export interface Usage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export interface ModelRequest {
  system: SystemBlock[];
  messages: UserMessage[];
  model: string;
  max_tokens: number;
}

export interface ModelReply {
  text: string;
  model?: string;
  stopReason?: string | null;
  usage?: Usage;
}

export type Generate = (req: ModelRequest) => Promise<ModelReply>;

export type Result = Reply & { warnings: string[]; model?: string; usage?: Usage; ms: number };

export interface AltTextInput {
  base64: string;
  mediaType: MediaType;
  options?: Partial<Record<keyof Options, unknown>>;
  skill: string;
  generate: Generate;
  model?: string;
  now?: () => number;
}

export function buildRequest(input: Pick<AltTextInput, 'base64' | 'mediaType' | 'options' | 'skill' | 'model'>): ModelRequest {
  const opts = normaliseOptions(input.options);
  return {
    system: systemBlocks(input.skill),
    messages: [userMessage(input.base64, input.mediaType, opts)],
    model: input.model ?? DEFAULT_MODEL,
    max_tokens: MAX_TOKENS,
  };
}

export async function writeAltText(input: AltTextInput): Promise<Result> {
  const now = input.now ?? Date.now;
  const req = buildRequest(input);
  const started = now();
  const reply = await input.generate(req);
  const base = { model: reply.model, usage: reply.usage, ms: now() - started };
  if (reply.stopReason === 'refusal') {
    return { kind: 'error', message: 'The model declined to describe this image.', warnings: [], ...base };
  }
  const parsed = parseReply(reply.text);
  const warnings = parsed.kind === 'alt' ? lint(parsed.altText) : [];
  if (reply.stopReason === 'max_tokens') warnings.unshift('The reply was cut off before the end. Try again without the audit.');
  return { ...parsed, warnings, ...base };
}
