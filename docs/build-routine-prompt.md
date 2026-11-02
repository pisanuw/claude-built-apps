Repos pisanuw/daily-project-ideas, pisanuw/Claude-capstone,
and pisanorg/yusuf are cloned. Push directly to each repo's default branch
(main, main, master), not to claude/ branches. Follow each repo's CLAUDE.md

## Git workflow: this routine is authorized to finalize on main, unattended

1. Before Step 1, run:
     git fetch origin main
     git switch -C main origin/main
   Do all work on main. Commit there and push with `git push origin main`.
   Never push the session's assigned claude/* branch to GitHub. If one
   exists locally, delete it after the push: git branch -D <that branch>.

never push to claude/” line to the routine prompt,

1. Wait up to 5 minutes for the user to supply a project name. If project name given, continue to STEP 3. If no praject name is given, continue with STEP 2.

2. PICK. Project name was not given interactively, so you get to PICK. From daily-project-ideas/ideas/*.json, choose one 1–2 Weeks  idea
   not already in implemented.json and with no matching Claude-capstone
   subdirectory. Replace any suggested LLM API calls with deterministic
   client-side logic where feasible.

3. CLAIM. Add a ref entry to implemented.json ({date, n}) with
   "placeholder": true and notes "In progress since <date>". Commit and push.

4. BUILD. Implement in Claude-capstone/<slug>/ to a professional bar: tests,
   README, working build. If the idea turns out bigger than expected stop after a working core rather than gold-plating. If you cannot finish, commit and push all work in
   progress, leave the placeholder claim in place, and stop with a status
   note in the claim's notes field; next week's run resumes it. 

4.5 MERGE the newly built project into main.

5. DEPLOY. Deploy via the Netlify or Render  connector as site <slug>. Verify
   the live URL returns 200 and renders. If using Render as backend, use the backend-hub
Render project which serves multiple projects as backends if possible

6. MARK IMPLEMENTED. In implemented.json: remove "placeholder", set url,
   repo (Claude-capstone tree link), implementedOn, and a one-paragraph
   notes. Update CHANGES.md. Commit and push.

7. PORTFOLIO. In pisanorg/yusuf/aiprojects.md, insert a new section at the
   top of the project list matching the existing format and voice: H3 title
   linked to the live site, one or two paragraphs including one honest
   limitation, a repo link line, "(Last update <Month Year>)". Update the table of contents. Commit and push.


Success: live site verified, ideas page shows the project as Implemented,
portfolio updated. If any step fails, stop, push whatever is committed, and
leave a clear status in the run rather than half-updating the three repos.

Delete any claude/* branch whose tip is already on main
