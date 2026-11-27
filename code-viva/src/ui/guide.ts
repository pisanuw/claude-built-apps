/**
 * Static help text: the "How it works" tab and the short "How to use this
 * step" box at the top of each step tab. Kept apart from the app logic so it
 * can be edited as prose.
 */

export const GUIDE_HTML = `
<section class="card guide">
  <h2>What Code Viva does</h2>
  <p>A <i>viva</i> is a short oral defense: the student explains their own work. Code Viva runs a written version of one for every student in a course, in about 15 to 20 minutes each, without a TA in the room. It reads each student's submitted code and commit history, writes 4 to 6 questions about <b>that student's</b> functions, variable names and commits, and gives each student a personal link to a timed text session. When the answers come back you see every transcript next to a proposed score and the sentences it rests on, plus a short list of students worth a five-minute conversation in person.</p>
  <p>It does not decide anything on its own. Every score is a proposal you approve or change, and a flag is a reason to talk to someone, not a finding of misconduct.</p>
</section>

<section class="card guide">
  <h2>Five-minute tour with a demo course</h2>
  <ol class="steps">
    <li><b>Pick a demo</b> in the box at the top of the page and press <b>Load demo</b>. There are eleven: linked lists, backtracking, binary search trees, graph search, a C hash table, dynamic programming, stacks, a REST API, grade statistics, sorting, bank accounts and word counts, in Python, Java, JavaScript, TypeScript, C, C++ and C#. <button class="linkish" id="guide-demo">Take me to the picker</button></li>
    <li>You land on <b>3. Review</b>. The <b>flag queue</b> on the left lists the students to see in person, most urgent first. In every demo one student submitted everything in a single late-night commit and answers vaguely or by pasting a textbook paragraph; they are at the top.</li>
    <li>Click a name. On the right you see the whole session: each question, the code excerpt the student saw, their answers, any follow-up questions, how long each answer took and how much of it was pasted. Under each question is the <b>proposed score</b> (0 to 3), the quoted sentences that earned it, and notes on what was missing.</li>
    <li>Change a score with the drop-down if you disagree, add a note, and press <b>Approve these scores</b>. The next student in the queue opens.</li>
    <li>Open <b>2. Questions and links</b> to see the questions each student was given. For a student who has not answered yet, press <b>Open as student</b> to take their viva yourself in a new tab, then paste the response code you get at the end into <b>Collect answers</b> on the Review tab.</li>
    <li>Open <b>1. Import</b> to see the assignment settings and each student's commit summary, including the "single commit" and "late-night" events that produced the commit questions.</li>
  </ol>
</section>

<section class="card guide">
  <h2>Running it for a real assignment</h2>
  <ol class="steps">
    <li><b>Set up the assignment</b> (Import tab). Give it a course and assignment name, a session length (20 minutes suits 5 questions), the number of questions and follow-ups, and optionally the deadline. Paste the assignment spec if you have it: functions it names are asked about first, and its "must" and "should" sentences become questions. Press <b>Save settings</b>.</li>
    <li><b>Import the submissions.</b> Upload a Gradescope export, a Canvas "Download submissions" zip, or a zip with one folder per student. For commit history from a zip, add a <code>git-log.txt</code> to each folder (the output of <code>git log --numstat</code>). With GitHub Classroom, enter the organization, the assignment's repo prefix and a token with read access: the browser fetches each repo's code and commits directly from GitHub.</li>
    <li><b>Set extended time</b> for students with accommodations in the submissions table (1.25x to 3x). Their link includes the extra time.</li>
    <li><b>Generate questions</b> (Questions tab). Read through them. <b>Replace</b> swaps a question for the next-best one about the same student's code; <b>Edit wording</b> lets you rewrite it. Regenerating or editing changes that student's link, so do this before sending.</li>
    <li><b>Send the links.</b> Use <b>Copy link</b> per student, or <b>Download links CSV</b> for a mail merge or an LMS message. Each link is personal: it carries that student's questions and code excerpts.</li>
    <li><b>Collect answers.</b> Students finish with a response code starting <code>CVR1.</code> and send it however you asked (an LMS text submission works well). On the Review tab, paste any text that contains codes, even a whole export or a pile of emails, or load the .txt files students downloaded.</li>
    <li><b>Review and approve.</b> Work through the flag queue first, then the rest. Export the results CSV for your gradebook, and export the course JSON from the Import tab to keep a copy.</li>
  </ol>
</section>

<section class="card guide">
  <h2>What students see</h2>
  <p>A welcome page with their name, the number of questions, the time allowed (including any extended time) and the rules: answer in their own words, follow-ups may come, they cannot go back, and pasting, time per answer and leaving the window are recorded. The timer starts only when they press Start. Each question shows the relevant lines of their own code with the line in question highlighted. At the end they get the response code, with buttons to copy or download it. Nothing is sent automatically, and reopening the link shows the same code again.</p>
  <p>If a student reloads mid-session they can start again, but the restart is recorded and shown to you.</p>
</section>

<section class="card guide">
  <h2>How questions are chosen</h2>
  <div class="table-wrap" tabindex="0" role="region" aria-label="Question kinds"><table>
    <thead><tr><th>Kind</th><th>Asks about</th><th>Example</th></tr></thead>
    <tbody>
      <tr><td>recursion</td><td>A function that calls itself</td><td>"<code>_sort</code> calls itself on line 56. What is the base case?"</td></tr>
      <tr><td>edge</td><td>An <code>if</code> guard, preferring empty/None/bounds checks, or a hard-coded constant</td><td>"What input makes <code>if cur is None</code> true, and what breaks without it?"</td></tr>
      <tr><td>design</td><td>A map, set, list, stack, queue, heap or sort</td><td>"Why a set for <code>seen</code> rather than a list?"</td></tr>
      <tr><td>naming</td><td>Vague or opaque names like <code>tmp1</code>, <code>t2</code>, <code>pv</code></td><td>"What does <code>pv</code> hold?"</td></tr>
      <tr><td>scale</td><td>Nested loops or loops plus recursion</td><td>"Which part dominates if the input is 1,000 times larger?"</td></tr>
      <tr><td>trace</td><td>The most involved functions</td><td>"Walk through <code>remove(value)</code> on a small input."</td></tr>
      <tr><td>spec</td><td>A must/should sentence from the spec</td><td>"Show where your code does this."</td></tr>
      <tr><td>commit</td><td>One commit with most of the code, a late-night commit, a bulk add or a deadline rush</td><td>"Walk me through how you developed this."</td></tr>
    </tbody>
  </table></div>
  <p class="small muted">The most complex functions come first, every kind is used before any repeats, no function gets more than two questions, and the commit question (when there is one) comes last. Two students with the same starter code still get different questions.</p>
</section>

<section class="card guide">
  <h2>Reading a review</h2>
  <p><b>Scores.</b> Each question earns up to 3 points: one for being <i>specific</i> (naming the student's own variables, a line number or quoted code), one for <i>covering</i> what the question asks (for recursion, a base case and something getting smaller), and one for <i>explaining</i> (30+ words with a "because" or "so that"). "I don't know" scores 0, and a reply that is mostly pasted is shown but earns nothing.</p>
  <p><b>Evidence.</b> The quoted sentences under each score are copied from the transcript word for word, so you can check the reasoning in seconds.</p>
  <p><b>Flags</b>, from most to least serious:</p>
  <ul>
    <li><span class="badge sev3">low-score</span> under 34% (under 50% shows amber), <span class="badge sev3">commit-unexplained</span> the commit question scored 1 or less, <span class="badge sev3">mismatch</span> the answers are for a different version of the questions than the one issued.</li>
    <li><span class="badge sev2">zero</span> an answered question scored 0, <span class="badge sev2">paste</span> half or more of the text was pasted.</li>
    <li><span class="badge sev1">focus</span> left the window 3+ times, <span class="badge sev1">fast</span> typed over 120 words a minute, <span class="badge sev1">timeout</span> ran out of time with questions left, <span class="badge sev1">restart</span> reloaded and started again.</li>
  </ul>
  <p>A student enters the flag queue when they are under 60% or have an amber or red flag. A good follow-up is to open their code with them and ask them to change one line.</p>
</section>

<section class="card guide">
  <h2>Privacy and data</h2>
  <p>Everything runs in your browser. The course is saved in this browser's storage; use <b>Export course JSON</b> to back it up or move it to another computer. The questions travel inside each link's <code>#fragment</code>, the part of a URL browsers do not send to servers, and answers come back only as the response codes students choose to send. The GitHub import goes straight from your browser to GitHub, and the token is kept in memory for that import only.</p>
</section>

<section class="card guide">
  <h2>Tips and limits</h2>
  <ul>
    <li>Keep the stakes low: present it as a check that helps you decide who to talk to, not as a grade. Students find orals stressful.</li>
    <li>Scores reward naming the right things, so a student who knows the vocabulary but not their code can still earn a point or two. Read the transcript before deciding.</li>
    <li>The code reader is heuristic. Unusual formatting or macros can hide a function; replace or edit any question that misses.</li>
    <li>Links carry the questions, so they are a few kilobytes long. If an LMS message box wraps them, send the links CSV through a mail merge instead.</li>
  </ul>
  <div class="row"><button class="primary" data-goto="import">Start: 1. Import</button></div>
</section>`;

export const STEP_HELP: Partial<Record<string, string>> = {
  import: `<ol class="steps">
    <li>Fill in the assignment and press <b>Save settings</b>. The spec is optional but makes questions sharper.</li>
    <li>Upload a zip or import from GitHub Classroom. The table below then shows each student's code size and commit summary; red and amber badges are commit patterns that will become a question.</li>
    <li>Set extended time for students with accommodations, then press <b>Next: generate questions</b>.</li>
  </ol><p class="small muted">Exploring? Load a demo from the top of the page; it fills all three steps.</p>`,
  questions: `<ol class="steps">
    <li>Press <b>Generate questions for everyone</b>, then read each student's questions. Open "Code shown to the student" to see the exact excerpt.</li>
    <li>Use <b>Replace</b> or <b>Edit wording</b> on any question you would not ask in person. This changes that student's link.</li>
    <li>Send each student their link with <b>Copy link</b>, or <b>Download links CSV</b> for a mail merge. <b>Open as student</b> lets you try a session yourself.</li>
  </ol>`,
  review: `<ol class="steps">
    <li>Paste the response codes students sent you (any text containing <code>CVR1.</code> codes) and press <b>Add responses</b>.</li>
    <li>Start with the <b>flag queue</b>. Click a name to read the transcript, the proposed score for each question and the quoted evidence.</li>
    <li>Adjust any score, add a note, and press <b>Approve these scores</b>. When you are done, <b>Export results CSV</b> for your gradebook.</li>
  </ol>`,
};
