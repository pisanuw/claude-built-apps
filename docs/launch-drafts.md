# Launch drafts

Seven posts, written to sound like you. Edit freely; nothing has been posted.
Sections 3 to 6 were added on 2026-11-02 for the next round (picked from the 30-day analytics).

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

## 3. Small businesses: Accessibility Lens

**Where:** LinkedIn first. The same text works as a note to a local business association or chamber newsletter, if you know someone who edits one.

**Post:**

    Is your website usable by someone who cannot see it?

    Accessibility Lens (https://accessibility-lens.pisan.me) takes the address of a public page and runs eleven WCAG 2.1 checks on it: missing alt text, unlabelled form fields, empty links, heading order and so on. Then it replays the page the way four groups of visitors get it: as the linear stream a screen reader reads out, blurred for low vision, filtered for color blindness, and keyboard only. Every problem comes with a suggested fix.

    Free, no sign-up. It is not a full audit (it reads the HTML your server sends, so anything added later by JavaScript is invisible to it), but it is a quick way to find the obvious problems before a customer does.

    Claude Code wrote it; I set the rules and reviewed it. If you run a small business and want a tool like this built for your own site or workflow, email builder@pisan.me.

**Have ready:** "Does this make my site ADA compliant?" Nope. Say it finds common problems and is a starting point, not a legal opinion.

---

## 4. Instructors: Code Viva

**Where:** the SIGCSE members list, at least a week after the Cache Miss Theater email. Your LinkedIn post already brought about 450 visits, so a short follow-up there ("what I learned from the first N instructors who tried it") is worth it once you have something to say.

**Subject:**

    Short written orals on each student's own code (free tool)

**Body:**

    Hi all,

    If you ever wonder how much of a submitted assignment the student actually understands, this may help.

    Code Viva (https://code-viva.pisan.me) imports a Gradescope or Canvas export or a GitHub Classroom assignment, reads each student's code and commit history, and writes 4 to 6 questions anchored to *their* functions, guards and odd commits. Students answer in a timed text session from a personal link, with up to two follow-ups when an answer is vague. You get transcripts with proposed rubric scores and a flag queue, so TA time goes to the few students who need a real conversation.

    No LLM: questions come from templates over a source analyser, so they are less fluent than a chatbot's but cannot invent code the student never wrote. Extended time for accommodations is built in.

    Limits: response codes are not signed, so a determined student could edit their own transcript before sending it.

    Claude Code wrote it; I set the requirements and reviewed it. Source (MIT): https://github.com/pisan-labs/code-viva

    If you try it, I would like to hear what breaks.

    Yusuf Pisan

---

## 5. Instructors: Fork Count

**Where:** a short follow-up to the OS and systems people, or LinkedIn. Pairs well with Cache Miss Theater; post a few days apart.

**Post:**

    "How many times is hello printed?" is on nearly every operating systems exam, and most students guess.

    Fork Count (https://fork-count.pisan.me) takes a short C snippet with fork, wait, exit, printf and pipes, runs every process it creates, draws the process tree and lists every output the scheduler could produce (stdio buffers copied at fork included). Type an output and it tells you whether some schedule prints it; if not, it names the happens-before edge that rules it out. Forgotten close() deadlocks show up too. A generator makes new exam questions whose answers are checked against every schedule.

    Free, runs in the browser. Source (MIT): https://github.com/pisan-labs/fork-count

    Built by Claude Code, reviewed by me. Students: no, it will not do the exam for you. It will show you why your answer was wrong. :-)

---

## 6. Chess players: MyChessMaster

**Where:** your chess club's newsletter or mailing list, a scholastic chess parents' group, or LinkedIn. Check the forum's rules on self-promotion before posting anywhere else.

**Post:**

    MyChessMaster (https://mychessmaster.net) is for chess players who play in tournaments and want to prepare for a specific opponent.

    Stockfish finds the moments where a game went wrong. A coach model explains each one in plain chess terms, using only the engine's lines, so it does not invent variations. The mistakes then become spaced-repetition drills from your own games, and an opponent's games become a prep sheet and a deck of positions to punish them with before the round.

    You can look around without signing in: there is a sample player with a full report, drills and a prep sheet. Members get the same for their own games.

    Built with Claude Code. I am happy to hear what a stronger player thinks it gets wrong.

**Before posting:** check that membership requests are being answered before you send people to "Become a member".

---

## 7. Instructors: Digital Student Assistant

Added 2026-11-06. Facts are from the README's "My biggest project" section and the arXiv abstract; nothing else is assumed.

**Where:** the SIGCSE members mailing list (plain-text email). A shorter LinkedIn version follows.

**Subject:**

    An AI tutor that withholds the answer: deployed in my data structures courses, paper and demo

**Body:**

    Hi all,

    I have been running an AI teaching assistant, Digital Student Assistant, in my data structures courses at UW Bothell, and my students are using it now. It guides rather than answers: it asks before it tells, it will not hand over homework solutions, and it teaches from my own lectures and recordings rather than the internet.

    The hard part was getting it to hold back reliably. A capable model pressed by a frustrated student does not withhold on a prompt alone, so the tutor treats withholding as a per-turn contract it can check: a non-LLM policy core sets a ceiling on an eight-rung help ladder, a deterministic detector strips solution code, and a separate LLM judge checks each risky reply. I tuned it with scripted student personas driven through the live pipeline, and recorded why each reply was rejected so each failure could be fixed by cause.

    The write-up: "Teaching a Large Language Model Tutor to Withhold the Answer" https://arxiv.org/abs/2608.12292

    To look around: https://digital-student-assistant.com/ and sign in with demo@hintwise.org (no code needed). Student accounts are limited to UW addresses for now, and the code is private.

    [Optional, yours to add: a sentence on what you have seen students do with it, or whether you would like to hear from others who want to try it in their own course.]

    Yusuf Pisan

**LinkedIn:**

    My students at UW Bothell are using an AI teaching assistant I built for my data structures courses. It asks before it tells and will not hand over homework solutions.

    Getting a capable model to hold back the answer when a frustrated student pushes is the hard part. The paper describes how: a per-turn contract the system checks, an eight-rung help ladder, and evidence-driven tuning with scripted student personas.

    Paper: https://arxiv.org/abs/2608.12292
    Demo: https://digital-student-assistant.com/ (sign in as demo@hintwise.org)

**Before posting:** decide whether to say how it was built (for example with Claude Code); I left that out because neither the README nor the paper abstract says it. Check that the demo account signs in on the day you post.

---

## Before you post

- Every link above was live on 2026-11-02, and the pisan-labs repos carry the MIT license (MyChessMaster's code is private, so its post has no source link).
- Add a sentence of your own to either post if you have one: why you wanted the tool, or a course where you would use it. I left that out rather than invent it.
- Post one at a time, a few days apart, so you can answer comments on each.
