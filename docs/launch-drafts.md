# Launch drafts

Two posts, written to sound like you. Edit freely; nothing has been posted.

---

## 1. Show HN: Bombe Bench

**Where:** https://news.ycombinator.com/submit
**When:** a weekday, roughly 7-9am Pacific. Stay around for the first two or three hours to answer comments; that matters more than the post.

**Title** (77 characters, HN allows 80):

    Show HN: Bombe Bench – an Enigma you can open up, and the Bombe that broke it

**URL:** https://bombe-bench.pisan.me/

**Text** (HN shows it under the link; plain text, no markdown):

    Bombe Bench has two halves.

    The Machine tab is an Enigma I (rotors I-V, reflectors A/B/C, rings, plugboard, double stepping). Each keypress draws its path through the plugboard, three rotors and the reflector and back, so you can see why no letter ever encrypts to itself.

    The Attack tab is the Turing-Welchman Bombe. Slide a crib along the ciphertext, see the menu graph and its loops, then run the Bombe over all 60 rotor orders x 17,576 positions. It takes about a second in a Web Worker and leaves a handful of stops; the checking machine throws out the inconsistent ones. A tracer lets you follow one hypothesis step by step, and you can switch the diagonal board off to see why loops mattered so much before Welchman added it.

    There is also a challenge mode: generate a message with hidden settings and send it as a link.

    Claude Code wrote the code. I picked the idea, set the rules (tests, no backend, no LLM at runtime) and reviewed what came back. It is one of about 50 apps built this way: https://github.com/pisanuw/claude-built-apps

    One known gap: plugs the crib does not reach are left straight, so the decrypt is only fully right across the crib until you work out the rest.

    Code (MIT): https://github.com/pisan-labs/bombe-bench

    Happy to answer questions about the attack, or about building it with Claude.

**Things to have ready for comments:**
- "Did you check it against a real Enigma?" Say what you know. The README says the Machine tab implements double stepping and that the Bombe finishes all 60 rotor orders in about a second. I have not seen any cross-check against historical traffic, so don't claim one.
- "What did you actually do if Claude wrote it?" This is your pitch. Have one concrete example ready of a decision you made or something you rejected.

---

## 2. Instructors: Cache Miss Theater

**Where:** the SIGCSE members mailing list (plain-text email). The same text, minus "Hi all", works for LinkedIn, r/compsci, or a note to colleagues who teach architecture or systems.

**Subject:**

    Free browser tool for teaching cache misses (compulsory / capacity / conflict)

**Body:**

    Hi all,

    If you teach architecture or systems, this may be useful.

    Cache Miss Theater (https://cache-miss-theater.pisan.me) takes a C loop nest, generates its exact address trace and runs it through a cache you configure: size, line size, associativity, LRU/FIFO/random, write-allocate and write-back or not. Every miss is labelled compulsory, capacity or conflict. Play or step through the trace and watch lines arrive in their sets and get evicted, while a memory map shows which array elements are cached.

    Things that might help in class:
    - Two kernels side by side (row vs column order, ijk vs ikj, naive vs blocked transpose), or a sweep over block size or a cache parameter with the miss rate plotted.
    - Exam questions from six templates, with every answer computed by simulating the exact code shown. Export as Markdown with an answer key, or as QTI 1.2 for Canvas. I have not yet imported the QTI file into a live Canvas course, so treat that part as beta.
    - Kernels and cache settings live in the URL, so a slide can link straight to an example.

    Limits: one cache level, data accesses only, and array contents are not modelled, so A[B[i]] is out.

    No sign-up, everything runs in the browser, nothing is uploaded. Source (MIT): https://github.com/pisan-labs/cache-miss-theater

    Full disclosure: Claude Code wrote the code; I set the requirements and reviewed it. The tests check the simulator against a naive reference on 60 random traces and pin the textbook results (row order 25% misses, column order 100%).

    If you try it with students, I would like to hear what breaks or what is missing.

    Yusuf Pisan

---

## Before you post

- Both links and both GIFs are live, and the pisan-labs repos now carry the MIT license.
- Add a sentence of your own to either post if you have one: why you wanted the tool, or a course where you would use it. I left that out rather than invent it.
- Post one at a time, a few days apart, so you can answer comments on each.
