/**
 * Request validation for the gateway. The browser sends a subset of the
 * Messages API: { app, model?, max_tokens?, system?, messages, tools? }.
 * Everything here is pure and returns a status plus a message the browser
 * can show; nothing throws on bad input.
 */

/** Hard limits on what one call may carry. */
export const MAX_BODY_BYTES = 1_000_000;
export const MAX_MESSAGES = 200;
export const MAX_TOOLS = 64;
export const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** The platform.llm_apps columns the validation needs. */
export interface AppRow {
  slug: string;
  enabled: boolean;
  default_model: string;
  allowed_models: string[];
  max_tokens: number;
}

export interface GatewayRequest {
  app: string;
  model: string;
  max_tokens: number;
  system?: string | unknown[];
  messages: unknown[];
  tools?: unknown[];
}

export type Failure = { ok: false; status: number; error: string };
export type Parsed = { ok: true; body: Record<string, unknown> } | Failure;
export type Validated = { ok: true; request: GatewayRequest } | Failure;

const fail = (status: number, error: string): Failure => ({ ok: false, status, error });
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Parses the raw body text: size limit, JSON, an object. */
export function parseBody(text: string): Parsed {
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > MAX_BODY_BYTES) return fail(413, `Request body is ${bytes} bytes; the limit is ${MAX_BODY_BYTES}.`);
  if (!text.trim()) return fail(400, 'Request body is empty; send a JSON object.');
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return fail(400, 'Request body is not valid JSON.');
  }
  if (!isObject(body)) return fail(400, 'Request body must be a JSON object.');
  return { ok: true, body };
}

/** The app slug named by the body, checked before the database lookup. */
export function appSlug(body: Record<string, unknown>): { ok: true; slug: string } | Failure {
  const app = body.app;
  if (typeof app !== 'string' || !app) return fail(400, '"app" is required: the app slug registered in platform.llm_apps.');
  if (!SLUG.test(app)) return fail(400, '"app" must be a slug: lowercase letters, digits and dashes.');
  return { ok: true, slug: app };
}

function validMessage(m: unknown): string | null {
  if (!isObject(m)) return 'each message must be an object';
  if (m.role !== 'user' && m.role !== 'assistant') return 'each message needs role "user" or "assistant"';
  const c = m.content;
  if (typeof c === 'string') return c ? null : 'a message content string must not be empty';
  if (Array.isArray(c)) return c.length ? null : 'a message content array must not be empty';
  return 'each message needs content: a string or an array of blocks';
}

/**
 * Checks the body against the app row: model in allowed_models (default the
 * app's default_model), max_tokens clamped to the app's max_tokens, messages
 * well formed and at most MAX_MESSAGES, tools an array if present.
 */
export function validateRequest(body: Record<string, unknown>, app: AppRow): Validated {
  const slug = appSlug(body);
  if (!slug.ok) return slug;

  let model = app.default_model;
  if (body.model !== undefined) {
    if (typeof body.model !== 'string' || !body.model) return fail(400, '"model" must be a model id string when given.');
    model = body.model;
  }
  const allowed = Array.isArray(app.allowed_models) ? app.allowed_models : [];
  if (!allowed.includes(model)) {
    return fail(400, `Model "${model}" is not allowed for app "${app.slug}". Allowed: ${allowed.join(', ') || '(none)'}.`);
  }

  const appMax = Number.isInteger(app.max_tokens) && app.max_tokens > 0 ? app.max_tokens : 4096;
  let max_tokens = appMax;
  if (body.max_tokens !== undefined) {
    const v = body.max_tokens;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) return fail(400, '"max_tokens" must be a positive integer when given.');
    max_tokens = Math.min(v, appMax);
  }

  let system: string | unknown[] | undefined;
  if (body.system !== undefined) {
    if (typeof body.system !== 'string' && !Array.isArray(body.system)) return fail(400, '"system" must be a string or an array of blocks when given.');
    system = body.system as string | unknown[];
  }

  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) return fail(400, '"messages" must be a non-empty array.');
  if (messages.length > MAX_MESSAGES) return fail(400, `"messages" has ${messages.length} entries; the limit is ${MAX_MESSAGES}.`);
  for (let i = 0; i < messages.length; i += 1) {
    const problem = validMessage(messages[i]);
    if (problem) return fail(400, `messages[${i}]: ${problem}.`);
  }

  let tools: unknown[] | undefined;
  if (body.tools !== undefined) {
    if (!Array.isArray(body.tools)) return fail(400, '"tools" must be an array when given.');
    if (body.tools.length > MAX_TOOLS) return fail(400, `"tools" has ${body.tools.length} entries; the limit is ${MAX_TOOLS}.`);
    tools = body.tools;
  }

  const request: GatewayRequest = { app: slug.slug, model, max_tokens, messages };
  if (system !== undefined) request.system = system;
  if (tools !== undefined) request.tools = tools;
  return { ok: true, request };
}
