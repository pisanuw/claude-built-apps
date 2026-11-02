# Cache Miss Theater

Students in architecture and systems courses are told that loop order and
blocking matter, but rarely see why. Write a small C loop nest and Cache Miss
Theater generates its exact address trace, runs it through the cache you
configure, and classifies every miss as compulsory, capacity or conflict. Step
or play through the trace and watch lines arrive in their sets and get
evicted, while a memory map shows which array elements are cached. Compare two
kernels side by side, sweep a block size or a cache parameter, and generate
exam questions whose answers come straight from the simulator.

Live: [cache-miss-theater.pisan.me](https://cache-miss-theater.pisan.me/)

Built from idea 2026-10-10 n2 in
[`pisanuw/daily-project-ideas`](https://github.com/pisanuw/daily-project-ideas).

![Matrix multiply in ijk order, 187 accesses in: B[14][2] just evicted B[6] from set 8 in a conflict miss](desktop.png)

## What it does

1. **Kernel language.** A hand-written lexer and recursive-descent parser for
   the C you find in loop-nest exercises: array declarations of `char`,
   `short`, `int`, `float`, `long`, `double` and the `intN_t` types with any
   number of dimensions, `#define` constants, scalars, `for`, `while`, `if`,
   blocks, C's operators, casts, and `min`/`max`/`abs`. A
   `void kernel(void) { … }` wrapper and `#include` lines are accepted, so
   textbook snippets paste in unchanged.
2. **Exact trace.** Arrays are laid out row-major from `0x10000`, each at the
   next 64-byte boundary after the previous one (or wherever
   `double A[64] @ 0x8000;` puts it). Scalars live in registers. For
   `x = e` the reads in `e` happen left to right, then the write; for `x += e`
   and `x++` the read of `x` comes first. Every access keeps its array,
   element and source line. Out-of-bounds indices are errors with the line
   number, which is a lesson in itself.
3. **Cache.** Size, line size, associativity (direct-mapped to fully
   associative), LRU, FIFO or seeded random replacement, write-allocate or
   not, write-back or write-through. Results show hits, misses, bytes moved in
   each direction, write-backs, and misses per array and per source line.
4. **3C classification.** An infinite cache and a fully associative LRU cache
   of the same capacity run beside the real one. A miss on a line never seen
   before is compulsory; a miss the fully associative cache also has is
   capacity; the rest are conflict misses, caused only by the set mapping.
5. **Theater.** Play (2 to 20,000 accesses per second), step, step back, jump
   to the next miss, or scrub. The cache is drawn as sets × ways, each line
   labelled with the elements it holds (`B[14][0..3]`) and coloured by array,
   with dirty lines starred and the current access outlined in its miss
   colour. Hovering a line says which access brought it in. The memory map
   draws each array as a grid: cached elements in the array's colour, elements
   touched and since evicted in grey, and the current line outlined.
6. **Compare and sweep.** A second kernel runs on the same cache and the
   results sit side by side. A sweep re-runs both kernels while a `#define`
   (block size, stride, padding, N) or a cache parameter changes and plots the
   miss rate.
7. **Exam questions.** Six templates (miss count for a traversal, hits for a
   stride walk, best loop order for matrix multiply, conflict misses between
   two arrays, which set an element maps to, capacity misses on a second
   pass), perturbed by a seeded RNG over sizes, element types and cache
   geometry. Every answer comes from simulating the exact code shown. Any
   question opens in the editor to step through. Export as Markdown with an
   answer key or as QTI 1.2 (numerical and multiple-choice items, the dialect
   Canvas imports).

Eight presets: row-major vs column-major sum, matrix multiply ijk vs ikj,
blocked matrix multiply with a block-size sweep, naive vs blocked transpose,
conflict misses fixed by padding, a stride walk, a 1D stencil, and write
policies. Both kernels and the cache settings live in the URL fragment for
sharing.

## Design decisions

- **No LLM and no D3.** Everything is deterministic: the idea's stack listed
  React and D3 or Canvas; plain DOM, two canvases and a small SVG chart keep
  the bundle near 60 kB (22 kB gzipped).
- **An interpreter, not an affine-only analyser.** The idea asked for affine
  indices; running the loop nest is simpler and also handles `min()` bounds,
  `i % 2` branches and index arithmetic. The price is that array contents are
  not modelled, so `A[B[i]]` and conditions on array values are rejected with
  a clear message.
- **Typed-array traces.** Up to 2 million accesses are stored in typed arrays
  and simulated in well under a second; stepping backwards replays from the
  start, which is instant at the sizes worth animating.
- **Cross-checked simulator.** The tests compare the cache against a naive
  list-based reference on 60 random traces across geometries and policies,
  and pin the textbook results (row order 25% misses, column order 100%, 448
  conflict misses for two arrays one cache size apart, zero after adding a
  way).

## Limitations

- One level of cache, data accesses only: no instruction fetches, TLB,
  prefetcher, write buffer or multi-level inclusion. Scalars never touch
  memory, which is what an optimising compiler usually does but not always.
- The evaluation order of a statement is fixed (left to right, then the
  write); a compiler may reorder or merge accesses, and real code may keep
  `C[i][j]` in a register across the inner loop.
- Array contents are not simulated, so indirect indexing, pointers, structs
  and function calls are out of scope.
- The 3C split uses an LRU fully associative cache as the reference even when
  the real cache uses FIFO or random replacement, so a few "conflict" misses
  under those policies are really policy misses. This is the usual textbook
  definition but worth knowing.
- The QTI export follows the Canvas QTI 1.2 dialect but has not been imported
  into a live Canvas course yet.

## Development

```bash
npm install
npm run dev        # Vite dev server
npm run lint
npm run typecheck
npm run coverage   # vitest, 62 tests, thresholds 85%
npm run build      # dist/
```

Core logic lives in `src/core` (parser, trace generator, cache simulator,
sweep, quiz, presets, share links, view helpers) and is unit tested; `src/ui`
is the DOM layer.
