/** What the owner tells us about their course site. Paths may be full URLs or site-relative. */
export interface JourneyConfig {
  siteUrl: string;
  username: string;
  /** Only needed by the login step; never stored. */
  password?: string;
  coursePath: string;
  /** Optional overrides. Empty means "use the Tutor LMS default" or "skip the step". */
  loginPath?: string;
  dashboardPath?: string;
  courseTitle?: string;
  lessonPath?: string;
  quizPath?: string;
  certificatePath?: string;
  pricePath?: string;
  expectedPrice?: string;
}

export type StepId = 'home' | 'login' | 'dashboard' | 'course' | 'lesson' | 'quiz' | 'certificate' | 'price';

/** pass: works. warn: works but something looks off. fail: students are stuck. skip: not checked. */
export type StepStatus = 'pass' | 'warn' | 'fail' | 'skip';

export interface StepResult {
  id: StepId;
  status: StepStatus;
  /** One plain-language sentence a course owner understands. */
  headline: string;
  /** Extra context: what we saw. */
  detail?: string;
  /** What to try next. */
  advice?: string;
  /** The address the student ended up on. */
  url?: string;
  httpStatus?: number;
  /** A short piece of the visible page text, as evidence. */
  evidence?: string;
  ms: number;
}

/** A cookie as the checker carries it between steps. */
export interface StoredCookie {
  name: string;
  value: string;
  path: string;
}

/** State carried from one step to the next (the student's session and what we discovered). */
export interface JourneyState {
  cookies: StoredCookie[];
  loggedIn: boolean;
  lessonUrl?: string;
  enrolled?: boolean;
}

export function emptyState(): JourneyState {
  return { cookies: [], loggedIn: false };
}

export interface StepOutcome {
  result: StepResult;
  state: JourneyState;
}

/** Runs one step: locally (demo academy) or on the server (a real site). */
export type StepRunner = (step: StepId, config: JourneyConfig, state: JourneyState) => Promise<StepOutcome>;

export interface JourneyRun {
  siteUrl: string;
  startedAt: string;
  finishedAt: string;
  results: StepResult[];
  demo: boolean;
}
