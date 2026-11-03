import type { CustomTheme } from './model';

export interface Theme {
  id: string;
  label: string;
  /** Lower-case noun phrase for sentences: "how the course is organized". */
  phrase: string;
  keywords: string[];
  custom?: boolean;
}

/**
 * Themes that come up in course evaluations, each with the words students
 * use for it. A keyword ending in * matches any ending; spaces match any
 * run of whitespace. A comment can belong to several themes.
 */
export const BUILT_IN_THEMES: Theme[] = [
  {
    id: 'organization',
    label: 'Organization & expectations',
    phrase: 'how the course is organized and what is expected',
    keywords: ['organiz*', 'disorganiz*', 'unorganiz*', 'structur*', 'syllabus', 'schedul*', 'expectation*', 'instructions', 'deadline*', 'due date*', 'all over the place', 'well planned', 'poorly planned', 'logistic*', 'announcement*', 'canvas page', 'consistent*', 'inconsistent*'],
  },
  {
    id: 'clarity',
    label: 'Explanations & clarity',
    phrase: 'how clearly material is explained',
    keywords: ['explain*', 'explanation*', 'clear*', 'unclear', 'confus*', 'understand*', 'example*', 'made sense', 'make sense', 'makes sense', 'concept*', 'hard to follow', 'easy to follow', 'lost', 'went over my head'],
  },
  {
    id: 'pace',
    label: 'Pace & workload',
    phrase: 'the pace and the workload',
    keywords: ['pace', 'paced', 'fast', 'slow*', 'rush*', 'workload', 'work load', 'too much work', 'amount of work', 'busy work', 'busywork', 'time consuming', 'time-consuming', 'hours a week', 'hours per week', 'heavy', 'overwhelm*', 'manageable', 'intense', 'keep up', 'behind'],
  },
  {
    id: 'feedback',
    label: 'Feedback on work',
    phrase: 'the feedback students get on their work',
    keywords: ['feedback', 'comments on', 'returned', 'get back', 'got back', 'turnaround', 'weeks to grade', 'took weeks', 'graded back', 'know how i was doing', 'where i stood'],
  },
  {
    id: 'grading',
    label: 'Grading & fairness',
    phrase: 'grading and fairness',
    keywords: ['grade', 'grades', 'grading', 'graded', 'grader*', 'rubric*', 'fair', 'fairly', 'unfair*', 'harsh*', 'points', 'partial credit', 'curve*', 'lenient', 'strict'],
  },
  {
    id: 'exams',
    label: 'Exams & quizzes',
    phrase: 'exams and quizzes',
    keywords: ['exam', 'exams', 'midterm*', 'final exam*', 'the final', 'finals', 'test', 'tests', 'quiz*', 'retake*'],
  },
  {
    id: 'assignments',
    label: 'Assignments & projects',
    phrase: 'assignments and projects',
    keywords: ['assignment*', 'homework*', 'hw', 'project*', 'lab', 'labs', 'lab work', 'problem set*', 'pset*', 'essay*', 'paper', 'papers', 'worksheet*', 'programming assignment*'],
  },
  {
    id: 'availability',
    label: 'Availability & support',
    phrase: 'how available and supportive the instructor is',
    keywords: ['office hour*', 'email*', 'emailed', 'responsive', 'unresponsive', 'responded', 'replied', 'reply', 'approachable', 'availab*', 'unavailab*', 'reach out', 'willing to help', 'extra help', 'support*', 'answered my questions', 'answer questions'],
  },
  {
    id: 'engagement',
    label: 'Engagement & enthusiasm',
    phrase: 'engagement and enthusiasm in class',
    keywords: ['engag*', 'boring', 'bored', 'dull', 'monoton*', 'enthusias*', 'passion*', 'energ*', 'interesting', 'fun', 'exciting', 'excited', 'entertain*', 'humor', 'funny', 'attention', 'dry', 'motivat*'],
  },
  {
    id: 'materials',
    label: 'Materials & resources',
    phrase: 'course materials and resources',
    keywords: ['textbook*', 'book', 'slide*', 'reading*', 'notes', 'video*', 'recording*', 'recorded', 'resource*', 'handout*', 'material*', 'practice problem*', 'study guide*'],
  },
  {
    id: 'relevance',
    label: 'Learning & relevance',
    phrase: 'what students learned and how relevant it felt',
    keywords: ['learn*', 'useful', 'real world', 'real-world', 'practical', 'applicable', 'apply', 'career*', 'job', 'jobs', 'internship*', 'skill*', 'relevan*', 'valuable', 'prepared me'],
  },
  {
    id: 'climate',
    label: 'Respect & classroom climate',
    phrase: 'respect and the classroom climate',
    keywords: ['respect*', 'disrespect*', 'inclusiv*', 'welcom*', 'comfortable', 'uncomfortable', 'condescend*', 'rude', 'dismissive', 'intimidat*', 'cared', 'cares', 'caring', 'care about', 'safe', 'belong*', 'judged', 'judgment', 'patient', 'patience', 'stupid question*'],
  },
  {
    id: 'active',
    label: 'Active learning & group work',
    phrase: 'group work and in-class activities',
    keywords: ['group*', 'team*', 'discussion*', 'discuss*', 'in-class activit*', 'in class activit*', 'activit*', 'active learning', 'participat*', 'peer*', 'partner*', 'collaborat*', 'hands-on', 'hands on', 'pair programming', 'breakout*'],
  },
];

export function allThemes(custom: CustomTheme[] = []): Theme[] {
  return [
    ...BUILT_IN_THEMES,
    ...custom
      .filter((c) => c.label.trim() && c.keywords.some((k) => k.trim()))
      .map((c) => ({ id: c.id, label: c.label.trim(), phrase: c.label.trim().toLowerCase(), keywords: c.keywords, custom: true })),
  ];
}

/** Turn one keyword into a regex source with word boundaries. */
export function keywordSource(keyword: string): string {
  const k = keyword.trim().toLowerCase();
  const star = k.endsWith('*');
  const body = (star ? k.slice(0, -1) : k)
    .split(/\s+/)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/-/g, '[- ]?'))
    .join('\\s+');
  return `(?<![\\w'])${body}${star ? "[\\w']*" : "(?![\\w'])"}`;
}

export interface CompiledTheme extends Theme {
  re: RegExp;
}

export function compileThemes(themes: Theme[]): CompiledTheme[] {
  return themes.map((t) => ({
    ...t,
    re: new RegExp(t.keywords.filter((k) => k.trim()).map(keywordSource).join('|'), 'gi'),
  }));
}

/** Ids of the themes a piece of text mentions, in theme order. */
export function themesIn(text: string, compiled: CompiledTheme[]): string[] {
  return compiled.filter((t) => t.re.source !== '(?:)' && matches(t.re, text)).map((t) => t.id);
}

function matches(re: RegExp, text: string): boolean {
  re.lastIndex = 0;
  const ok = re.test(text);
  re.lastIndex = 0;
  return ok;
}
