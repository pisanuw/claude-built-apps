import { emptyProject, type Project, type StudentComment } from './model';

/**
 * A made-up instructor's comments for trying the tool: two courses over six
 * semesters, about 230 comments, generated from fixed phrases with a seeded
 * random number generator so every visitor (and every test) sees the same
 * data. Two changes are recorded: CS 142 swapped its midterms for quizzes in
 * Fall 2023, and CS 342 started one-week lab feedback in Spring 2024. CS 342's
 * workload stays a sore point throughout.
 */
export const SAMPLE_TERMS = ['Fall 2022', 'Spring 2023', 'Fall 2023', 'Spring 2024', 'Fall 2024', 'Spring 2025'];

type Pair = [subjects: string[], predicates: string[]];
interface Phrases {
  pos: Pair;
  neg: Pair;
}

const P: Record<string, Phrases> = {
  clarity: {
    pos: [['The lectures', 'Her explanations', 'The worked examples', 'The examples in class'], ['were really clear and easy to follow', 'made hard concepts make sense', 'always made sense to me, even recursion', 'were clear and built up step by step']],
    neg: [['Some lectures', 'The explanations of pointers', 'The proofs in lecture', 'A few topics'], ['were confusing and I got lost quickly', 'went over my head and the examples did not help', 'were unclear until I looked them up myself', 'felt hard to follow']],
  },
  engagement: {
    pos: [['Professor Rivera', 'The instructor', 'She'], ['is so enthusiastic that it is hard to be bored', 'made an 8:30 class genuinely engaging', 'is clearly passionate about the material and it is contagious', 'kept things fun and interesting with live coding']],
    neg: [['Some days', 'The long lecture blocks', 'The Friday sessions'], ['were boring and hard to pay attention to', 'felt dull compared to the rest of the course', 'dragged and I lost my motivation']],
  },
  availability: {
    pos: [['Professor Rivera', 'Dr. Rivera', 'The instructor', 'She'], ['was always willing to help in office hours', 'answered my questions over email within a day', 'is approachable and makes office hours feel welcoming', 'was always available when I needed extra help']],
    neg: [['Getting help', 'Getting into office hours'], ['was hard because office hours were packed', 'was difficult because emails took days to get a reply']],
  },
  pace: {
    pos: [['The pace', 'The workload', 'The weekly schedule'], ['was manageable and fair for a first course', 'felt reasonable and I could keep up', 'was well balanced']],
    neg: [['The workload', 'The amount of work', 'This course'], ['was way too much on top of other classes, easily 15 hours a week', 'was overwhelming with a lab and a project due the same week', 'was too heavy for a 4 credit class', 'left me behind in every other class']],
  },
  exams: {
    pos: [['The final exam', 'The lab practical exam'], ['was fair and matched the practice problems', 'was fair and tested what we practiced']],
    neg: [['The midterms', 'The two midterms', 'Both exams', 'The midterm exams'], ['were brutal and way too high stakes', 'felt like they tested speed and anxiety more than understanding', 'were stressful and covered things we barely practiced', 'made me so anxious that I blanked on things I knew']],
  },
  examsAfter: {
    pos: [['The weekly quizzes', 'The short quizzes', 'The quizzes and retakes', 'The six quizzes'], ['were much better than big exams and less stressful', 'kept me on track and felt low stakes', 'made grading feel fair because I could learn from my mistakes', 'were great for checking what I actually understood']],
    neg: [['The quizzes', 'Some quizzes'], ['were too short to show what I knew', 'were stressful when they landed on project weeks']],
  },
  assignments: {
    pos: [['The projects', 'The programming assignments', 'The labs', 'The weekly labs'], ['were challenging but really rewarding and I learned a lot', 'were the best part, I learned so much building them', 'were interesting and actually useful']],
    neg: [['Some assignments', 'The labs', 'The later projects'], ['had unclear instructions and took forever', 'felt like busy work', 'were tedious and the spec kept changing']],
  },
  feedback: {
    pos: [['Feedback on labs', 'The feedback', 'Getting comments on my code'], ['was detailed and helpful', 'helped me improve on the next one']],
    neg: [['Feedback on labs', 'Grading of labs', 'Getting feedback', 'Feedback'], ['took weeks so I never knew where I stood', 'came back too late to help on the next lab', 'was almost nonexistent, just a number with no feedback', 'took weeks and the comments were vague']],
  },
  feedbackAfter: {
    pos: [['Lab feedback', 'Getting lab feedback within a week', 'The rubric feedback', 'Feedback on labs'], ['was quick and really helpful, I always knew where I stood', 'helped me fix my mistakes before the next lab', 'was detailed and timely, much better than my other classes', 'was fast and clear about what to improve']],
    neg: [['Feedback', 'The rubric feedback'], ['was sometimes too short to be useful', 'felt generic on a couple of labs']],
  },
  grading: {
    pos: [['Grading', 'The lab grading', 'The grading'], ['was fair and the rubrics were clear', 'felt fair and consistent', 'was transparent and fair']],
    neg: [['Grading', 'The lab grading', 'Partial credit'], ['was harsh and inconsistent between graders', 'felt unfair with no clear rubric', 'was too strict for small mistakes']],
  },
  materials: {
    pos: [['The slides', 'The recorded lectures', 'The practice problems', 'The course notes'], ['were great for studying', 'were really helpful when I missed class', 'were thorough and well organized']],
    neg: [['The required textbook'], ['was expensive and we barely used it', 'was too dense to study from']],
  },
  organization: {
    pos: [['The course', 'The Canvas page', 'The schedule'], ['was well organized with clear expectations', 'was organized and deadlines were clear', 'made it easy to know what was due']],
    neg: [['The Canvas page', 'The course site'], ['was disorganized and hard to navigate', 'was all over the place, with deadlines hard to find', 'was a mess and expectations kept changing']],
  },
  relevance: {
    pos: [['This class', 'The material', 'What we learned'], ['was really useful for my internship interviews', 'is the most practical thing I have learned so far', 'prepared me for real world work']],
    neg: [['Some topics', 'The theory weeks'], ['felt pointless for what we will actually do', 'did not feel relevant to the rest of the major']],
  },
  climate: {
    pos: [['Professor Rivera', 'She', 'Dr. Rivera'], ['made everyone feel welcome to ask questions', 'felt like a safe place to be wrong', 'cares about students and treats us with respect']],
    neg: [['Asking questions in lecture', 'Speaking up in class'], ['felt intimidating with the more experienced students around', 'was intimidating and some replies felt dismissive toward beginners']],
  },
  active: {
    pos: [['The in-class activities', 'The pair programming sessions', 'The group discussions'], ['were really helpful and fun', 'helped me learn from my peers', 'were engaging and kept me awake']],
    neg: [['Group work', 'The team project'], ['was frustrating when partners did not participate', 'was stressful because of one teammate']],
  },
};

const SUGGESTIONS = [
  'It would be nice to have more practice problems before exams.',
  'I wish the slides were posted before class.',
  'Please post solutions to the practice problems.',
  'Maybe add one more review session.',
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BASE_WEIGHT: Record<string, number> = {
  clarity: 14, engagement: 11, availability: 10, pace: 9, exams: 8, assignments: 10, feedback: 6, grading: 6, materials: 7, organization: 6, relevance: 7, climate: 4, active: 4,
};
const BASE_POSITIVE: Record<string, number> = {
  clarity: 0.72, engagement: 0.85, availability: 0.88, pace: 0.6, exams: 0.5, assignments: 0.7, feedback: 0.55, grading: 0.6, materials: 0.75, organization: 0.7, relevance: 0.8, climate: 0.85, active: 0.7,
};

function profile(course: string, termIndex: number): { weight: Record<string, number>; positive: Record<string, number> } {
  const weight = { ...BASE_WEIGHT };
  const positive = { ...BASE_POSITIVE };
  if (course === 'CS 142') {
    // Midterms replaced by quizzes from Fall 2023 (index 2).
    if (termIndex < 2) {
      weight.exams = 22;
      positive.exams = 0.18;
    } else {
      weight.exams = 12;
      positive.exams = 0.8;
    }
  } else {
    // Lab feedback within a week from Spring 2024 (index 3).
    weight.pace = 18;
    positive.pace = 0.22;
    if (termIndex < 3) {
      weight.feedback = 18;
      positive.feedback = 0.12;
      positive.grading = 0.35;
    } else {
      weight.feedback = 16;
      positive.feedback = 0.82;
      positive.grading = 0.7;
    }
  }
  return { weight, positive };
}

function pickWeighted(rand: () => number, weights: Record<string, number>, not: string[]): string {
  const entries = Object.entries(weights).filter(([k]) => !not.includes(k));
  const total = entries.reduce((n, [, w]) => n + w, 0);
  let r = rand() * total;
  for (const [k, w] of entries) {
    r -= w;
    if (r <= 0) return k;
  }
  return entries[entries.length - 1][0];
}

function phrase(rand: () => number, [subjects, predicates]: Pair): string {
  const s = subjects[Math.floor(rand() * subjects.length)];
  const p = predicates[Math.floor(rand() * predicates.length)];
  return `${s} ${p}.`;
}

export function sampleComments(): StudentComment[] {
  const rand = mulberry32(20261103);
  const out: StudentComment[] = [];
  const seen = new Set<string>();
  for (const course of ['CS 142', 'CS 342']) {
    SAMPLE_TERMS.forEach((term, ti) => {
      const { weight, positive } = profile(course, ti);
      const count = 17 + Math.floor(rand() * 6);
      let made = 0;
      for (let attempt = 0; made < count && attempt < count * 6; attempt++) {
        const themes = [pickWeighted(rand, weight, [])];
        if (rand() < 0.45) themes.push(pickWeighted(rand, weight, themes));
        const parts = themes.map((t) => {
          const key = course === 'CS 142' && t === 'exams' && ti >= 2 ? 'examsAfter' : course === 'CS 342' && t === 'feedback' && ti >= 3 ? 'feedbackAfter' : t;
          return phrase(rand, rand() < positive[t] ? P[key].pos : P[key].neg);
        });
        if (rand() < 0.12) parts.push(SUGGESTIONS[Math.floor(rand() * SUGGESTIONS.length)]);
        const text = parts.join(' ');
        if (seen.has(text)) continue;
        seen.add(text);
        out.push({ id: `s-${course.replace(/\W/g, '')}-${ti}-${made}`, course, term, text, source: 'Sample comments' });
        made++;
      }
    });
  }
  return out;
}

export function sampleProject(): Project {
  const p = emptyProject();
  p.comments = sampleComments();
  p.settings.names = ['Rivera'];
  p.changes = [
    {
      id: 'sample-change-1',
      course: 'CS 142',
      term: 'Fall 2023',
      what: 'replaced the two high-stakes midterms with six short quizzes and a retake week',
      why: 'students kept saying the midterms measured anxiety more than understanding',
      themes: ['exams'],
    },
    {
      id: 'sample-change-2',
      course: 'CS 342',
      term: 'Spring 2024',
      what: 'started returning lab feedback within one week, using a shared rubric with the TAs',
      why: 'students said they did not know where they stood until the final',
      themes: ['feedback', 'grading'],
    },
  ];
  return p;
}
