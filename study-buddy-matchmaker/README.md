# Study Buddy Matchmaker

Most study groups are formed at random, or by friendship, so two students who
are both lost on graphs end up together. Study Buddy Matchmaker reads a
gradebook export, works out which topics each student is strong in and which
they are still learning, and pairs students so that each one is strong where
the other is not. Every group gets a short shared agenda (who leads which
topic, with links), and every student gets a private card that shows their
own levels and gaps, never a groupmate's.

Live: [study-buddy-matchmaker.pisan.me](https://study-buddy-matchmaker.pisan.me)

Built from idea 2026-06-04 n2 in
[`pisanuw/daily-project-ideas`](https://github.com/pisanuw/daily-project-ideas).
The idea suggested Claude for clustering profiles and writing agendas, plus a
Flask and Supabase backend; both are replaced by deterministic code that runs
in the browser, so no student data leaves the instructor's machine.

## What it does

1. **Reads a gradebook.** Upload a CSV or paste from a spreadsheet (comma,
   tab or semicolon). One row per student, one column per quiz question or
   assignment. A header such as `Q3 [recursion] /5`, `HW2 (graphs) out of 10`
   or `Sorting: Q1 (max 4)` gives the topic and maximum; otherwise the column
   name becomes the topic and the highest score seen becomes the maximum
   (with a note). ID and name columns, totals and comments are recognised and
   every guess can be corrected in the column table. Blanks, `EX` and `n/a`
   are skipped rather than counted as zero; percentages and `3/5` cells
   work.
2. **Profiles each student.** Mastery of a topic is the share of the
   available points earned on the items of that topic the student attempted.
   At or above the strong line (80% by default) a student can lead the
   topic; below the gap line (60%) it is a gap; in between is "getting
   there". The class table colours every cell and shows the class mean and
   how many students are strong per topic.
3. **Pairs complementary students.** Student A can help B on a topic when A
   is strong and B is not; the gain is the difference in mastery. A pair's
   score is the help flowing both ways, plus a bonus equal to the smaller
   direction (so a pair that teaches each other beats one-sided help), minus
   0.15 for every topic where both have a gap. The pairing maximises the
   total score over the class: exactly, by dynamic programming over subsets,
   up to 20 students; above that by greedy matching followed by pair swaps
   until no swap helps. An odd class gets one trio: the student left out is
   found by matching against a placeholder and joins the pair they add the
   most to. "Keep apart" lines stop two students being grouped. The total is
   shown next to the average of 50 random pairings.
4. **Writes agendas.** For each topic someone in the group can lead, the
   strongest member leads it for everyone still below the strong line; up to
   four sessions, largest gain first, alternating leaders where possible.
   Topics where nobody in the group is strong but someone has a gap are
   flagged for office hours. Each session links to a free resource: a small
   built-in library (Wikipedia and VisuAlgo pages for about 25 common CS
   topics, matched by keyword) plus the instructor's own `topic | title |
   url` lines, which come first.
5. **Keeps students' data private.** Each card lists who the student meets,
   what they lead, what they get help with and from whom, their own level
   per topic, and their remaining gaps with a link. It never shows a
   groupmate's scores or gaps. Print the cards one per page, or download
   them as Markdown; the instructor can also download the pairings as CSV
   and all agendas as Markdown. A toggle shows student IDs instead of names
   for projecting.

The gradebook and settings are kept in this browser's localStorage so a
reload does not lose them; nothing is sent anywhere. A seeded sample class
(23 students, six topics, 18 columns) loads on first visit.

## Design decisions

- **No LLM.** Topic profiles are arithmetic and pairing is a matching
  problem, so a model adds nothing a formula cannot do, and keeping the work
  local is what makes the privacy promise true.
- **Exact where cheap.** Maximum-weight matching by bitmask DP is exact and
  fast up to 20 students (one million subsets). Larger classes use greedy
  plus pair swaps; on random 20-student classes it reaches more than 97% of
  the optimum in the tests. A full blossom algorithm would be exact at any
  size but is far more code for a small gain.
- **Mastery from attempted work only.** A blank is not a zero, so a student
  who missed a quiz is not marked as having a gap in that topic.
- **No framework.** Plain TypeScript and DOM; the bundle is about 28 kB
  (11 kB gzipped).

## Limitations

- The score is a heuristic: it treats a mastery difference as teaching
  value and ignores personalities, schedules and whether a strong student
  can actually explain. Treat the pairs as a starting point to adjust.
- Topics must be labelled by the instructor (in headers or the column table);
  the tool does not infer topics from question text.
- Above 20 students the pairing is very good but not guaranteed optimal, and
  only pairs (plus one trio for odd classes) are formed, not larger groups.
- The built-in resource library is small and English-only; it matches by
  keyword, so an unusual topic name gets no link until you add your own.
- Cards are printed or downloaded by the instructor; there is no student
  login or sharing link.

## Development

```bash
npm install
npm run dev        # Vite dev server
npm run lint
npm run typecheck
npm run coverage   # vitest, thresholds 85%
npm run build      # dist/
```

Core logic lives in `src/core` (CSV, gradebook and mastery, matching,
agendas, resources, exports, sample data) and is unit tested; `src/ui` is the
DOM layer.
