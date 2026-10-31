export interface TourQuestion {
  prompt: string;
  choices: string[];
  /** Index into choices. */
  answer: number;
  explain: string;
}

export interface TourStop {
  /** Shown before the commands run. */
  say: string;
  /** Commands run when the student continues past this stop. */
  run: string[];
  /** Optional predict-then-reveal question, answered before run executes. */
  question?: TourQuestion;
}

export interface Tour {
  title: string;
  /** Optional skip-list seed; the city is reset with it when the tour starts. */
  seed?: number;
  stops: TourStop[];
}

export class TourError extends Error {}

const MAX_STOPS = 40;
const MAX_RUN = 40;

function str(v: unknown, where: string, max: number): string {
  if (typeof v !== 'string' || !v.trim()) throw new TourError(`${where} must be a non-empty string`);
  if (v.length > max) throw new TourError(`${where} is longer than ${max} characters`);
  return v;
}

/** Validate untrusted JSON (pasted or from a link) into a Tour. */
export function validateTour(raw: unknown): Tour {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new TourError('a tour must be a JSON object');
  const o = raw as Record<string, unknown>;
  const tour: Tour = { title: str(o.title, 'title', 120), stops: [] };
  if (o.seed !== undefined) {
    if (typeof o.seed !== 'number' || !Number.isInteger(o.seed) || o.seed < 0 || o.seed > 2 ** 31 - 1) throw new TourError('seed must be a non-negative integer');
    tour.seed = o.seed;
  }
  if (!Array.isArray(o.stops) || o.stops.length === 0) throw new TourError('stops must be a non-empty array');
  if (o.stops.length > MAX_STOPS) throw new TourError(`a tour has at most ${MAX_STOPS} stops`);
  o.stops.forEach((s, i) => {
    const where = `stop ${i + 1}`;
    if (typeof s !== 'object' || s === null) throw new TourError(`${where} must be an object`);
    const so = s as Record<string, unknown>;
    const run = so.run === undefined ? [] : so.run;
    if (!Array.isArray(run) || run.length > MAX_RUN) throw new TourError(`${where}: run must be an array of at most ${MAX_RUN} commands`);
    const stop: TourStop = { say: str(so.say, `${where} say`, 1000), run: run.map((c, j) => str(c, `${where} command ${j + 1}`, 200)) };
    if (so.question !== undefined) {
      const q = so.question as Record<string, unknown>;
      if (typeof q !== 'object' || q === null) throw new TourError(`${where}: question must be an object`);
      if (!Array.isArray(q.choices) || q.choices.length < 2 || q.choices.length > 6) throw new TourError(`${where}: question needs 2 to 6 choices`);
      const choices = q.choices.map((c, j) => str(c, `${where} choice ${j + 1}`, 200));
      if (typeof q.answer !== 'number' || !Number.isInteger(q.answer) || q.answer < 0 || q.answer >= choices.length) {
        throw new TourError(`${where}: answer must be the index of one of the choices`);
      }
      stop.question = { prompt: str(q.prompt, `${where} prompt`, 400), choices, answer: q.answer, explain: str(q.explain, `${where} explain`, 1000) };
    }
    tour.stops.push(stop);
  });
  return tour;
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Encode a tour for the #tour= fragment. The fragment never reaches a server. */
export function encodeTour(t: Tour): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(t)));
}

export function decodeTour(s: string): Tour {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fromBase64Url(s)));
  } catch {
    throw new TourError('the tour link is damaged or incomplete');
  }
  return validateTour(parsed);
}
