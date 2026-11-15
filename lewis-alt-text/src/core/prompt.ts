/**
 * The system prompt: the chemistry author's skill, unchanged apart from its
 * name/description header, plus a short section on how this app calls the
 * model. The skill text is passed in (Vite imports it with ?raw; the CLI
 * reads the file), so this module has no I/O.
 */

/** A system block; cache_control lets every call within a few minutes reuse the cached skill. */
export interface SystemBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

// The app is single-shot, so the model cannot hold a conversation. A
// question or an error must be marked so the page and the CLI can show it.
export const APP_RULES = `

---

## How this app calls you

You are running inside a web app and a command-line tool, not a chat. Each request has one image and the user's answers to the usual clarifying questions (figure purpose, instructional focus, extra context). Treat "not specified" as the user declining to answer, and apply the defaults in "Handling Uncertainty and Edge Cases".

- Normally reply with the alt text only, exactly as "Output Format" says.
- If no image is attached or it cannot be read, reply with one line that starts with "ERROR:" followed by a short reason.
- Ask a clarifying question only if the defaults would produce misleading alt text. Then reply with one line that starts with "QUESTION:" followed by the question, and nothing else.
- If the request says "Show the verification audit", reply with a line "Audit", the inventory and recount, then a line "Alt text", then the alt text.`;

/** Drop the header lines (name, description) above the first "---" line near the top. */
export function stripHeader(text: string): string {
  const lines = text.split(/\r?\n/);
  const sep = lines.findIndex((l) => l.trim() === '---');
  return sep >= 0 && sep < 10 ? lines.slice(sep + 1).join('\n').trim() : text.trim();
}

export function systemText(skill: string): string {
  return stripHeader(skill) + APP_RULES;
}

/** One cached block: the skill is the same on every call, so most calls pay the cache-read price. */
export function systemBlocks(skill: string): SystemBlock[] {
  return [{ type: 'text', text: systemText(skill), cache_control: { type: 'ephemeral' } }];
}
