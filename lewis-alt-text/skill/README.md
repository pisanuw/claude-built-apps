# The skill

`lewis-structure-alt-text-v8.txt` is the "Writing Alt Text for Lewis
Structures" skill, version 8, copied unchanged from
[srayermann/Lewis-Structures-Alt-Text](https://github.com/srayermann/Lewis-Structures-Alt-Text)
(there named `Lewis_Structure_Alt_Text_Skill_v8_TOO LONG.txt`).

Credit: the skill's author, GitHub user srayermann. Licence: to be confirmed
with the author; until then, ask before reusing the skill text elsewhere.

The app strips its two header lines (name, description), sends the rest as
the system prompt, and appends a short section on single-shot use
(`src/core/prompt.ts`). To update it, replace the file (keep the name, or
change the imports in `src/main.ts`, `test/core/prompt.test.ts`,
`cli/lewis-alt-text` and `src/cli/bundle.ts`) and rerun the tests.
