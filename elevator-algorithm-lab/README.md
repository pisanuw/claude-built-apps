# Elevator Algorithm Lab

**Write an elevator dispatch policy in JavaScript, run it against seeded
traffic in an animated building, and flip to the disk view to see that FCFS,
SSTF, SCAN and LOOK are elevator algorithms.** Operating systems courses teach
disk scheduling as lists of cylinder numbers; here the same policies move a
car past waiting passengers, every run reports mean, p95 and max wait
(starvation) plus energy, two policies can be replayed side by side on the
same trace, and the identical run can be drawn as a head sweeping across
cylinders with time flowing down, the textbook diagram. Everything runs in the
browser; nothing is uploaded.

Live: [elevator-algorithm-lab.pisan.me](https://elevator-algorithm-lab.pisan.me)

Implements idea #2 ("Elevator Algorithm Lab") from the
[2026-09-29 ideas day](https://github.com/pisanuw/daily-project-ideas)
of `pisanuw/daily-project-ideas`.

## What it does

- **A policy is one function.** `dispatch(car, state)` is called whenever a
  car is idle or has just finished a stop and returns the next floor (or
  `null` to stay). It sees the car (floor, direction, load, destinations
  aboard), every other car, and the hall calls grouped by floor and
  direction with counts and ages. Helpers `pending`, `nearest` and `heading`
  are prepended to the code and shown in the API panel. Top-level variables
  persist between calls, which is how C-LOOK remembers its sweep direction.
- **Six presets to start from**, all written in the same student-facing
  JavaScript: FCFS, SSTF, SCAN, LOOK, C-LOOK and a zoned LOOK for several
  cars. On the textbook trace (200 cylinders, head at 53 moving toward 0,
  queue 98 183 37 122 14 124 65 67) they move 640, 236, 236, 208 and 326
  cylinders, the numbers from the operating systems textbook, and the tests
  pin them.
- **Seeded scenarios.** Instructors write small JSON files: floors, cars,
  capacity, door time, explicit passengers `{t, from, to}` and a
  deterministic generator (`up-peak`, `down-peak`, `lunch`, `interfloor`,
  with a floor range and a seed). Disk scenarios are `kind: "disk"` with a
  head position and a request list or a seed. Six are built in: the textbook
  trace, a morning rush, a lunch spike, a starvation trap (one person on
  floor 1 while a stream rides between 30 and 40; SSTF never comes down), a
  quiet evening and a random cylinder storm.
- **Hidden grading scenarios.** Add `"hidden": true` and share the link: the
  request list, generator and JSON are not shown, so students cannot tune a
  policy to the exact trace, but it still runs and scores.
- **Metrics.** Mean, p95 and max wait (a passenger still waiting at the end
  counts until max time, so starvation shows up rather than vanishing from
  the average), mean ride, energy (floors travelled by all cars, which on a
  disk is total head movement), finish time, stops, served and unserved.
- **Side by side.** Pick a policy to compare with and both run on the same
  trace, animated in sync from one time slider, with the better value of each
  metric highlighted.
- **Disk view.** The same run drawn as cylinder across and time down: one
  zigzag per car, hollow marks where requests appear and filled marks where
  they are served. On the starvation trap LOOK dips to floor 0 once; SSTF's
  line never leaves the 30 to 40 band.
- **Class leaderboard.** Saves name, scenario, an 8-character hash of the
  policy and the metrics (never the code) to localStorage, ranks by
  mean wait + ¼ max wait + 1000 per unserved passenger, exports CSV or JSON
  and imports classmates' JSON to build the class table.
- **Sharing without a server.** "Share link" compresses the policy and the
  custom scenario (or the built-in scenario id) into the URL fragment.

## Simulation rules

One tick moves a car one floor. A car travels straight to the floor the
policy named; it does not stop at floors in between, so serving them is the
policy's job (that is exactly what makes SCAN on a building SCAN on a disk).
On arrival, and whenever an idle car is woken by a new request, the doors
open for anyone it can take: passengers going the car's way board first, an
empty car takes anyone, up to capacity; a stop where someone boards or
alights keeps the doors open for the scenario's door time (0 on disks, so
time equals head movement there). Hall calls on the car's own floor that it
could not take are hidden from that car's view, and `pending()` drops hall
calls when the car is full, so a nearest-first policy cannot spin in place.
A run ends when everyone is delivered or at max time. The policy runs in a
Web Worker and is killed after eight seconds, so an infinite loop only costs
a Run.

## Deviations from the idea

- The leaderboard is local: it lives in each browser and travels as exports,
  rather than a shared class server. Hidden scenarios are hidden in the UI
  only; the share link still contains the scenario, so a determined student
  can decode it.
- Cars do not stop at intermediate floors on their own; the policy chooses
  every stop. This is simpler to reason about and matches disk scheduling
  exactly, at the cost of some elevator realism.

## Development

```bash
npm install
npm run dev        # Vite dev server
npm test           # vitest
npm run coverage   # with thresholds (85% statements/branches/functions/lines)
npm run lint
npm run typecheck
npm run build      # typecheck + vite build to dist/
```

53 vitest tests, 100% statement coverage on the core (`src/core`). The DOM
layer (`src/main.ts`, `src/ui`, the worker) is checked by hand in headless
Chromium.

## Layout

- `src/core/scenario.ts`: validation, generators, disk expansion.
- `src/core/sim.ts`: the tick simulation.
- `src/core/policies.ts`: presets and the helper prelude.
- `src/core/compile.ts`: student source to function, policy hash.
- `src/core/metrics.ts`, `leaderboard.ts`, `share.ts`.
- `src/worker/sim.worker.ts`: sandboxed run; `src/ui/runner.ts` with timeout.
- `src/ui/building.ts`, `src/ui/diskview.ts`: SVG renderers.
- `src/main.ts`: the app.

Deployed to Netlify as a static site; see `deploy/target.yml`. No environment
variables, no API keys.
