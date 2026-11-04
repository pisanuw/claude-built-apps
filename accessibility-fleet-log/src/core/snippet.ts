/**
 * Ways to get axe-core results without installing anything on the client's
 * site: a DevTools console snippet and a bookmarklet. Both run in the
 * agency's own browser, load axe-core from a public CDN, run the WCAG A/AA
 * rules on the open page and copy the results for pasting into the app.
 */

export const AXE_VERSION = '4.11.0';
export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const CDN = [`https://cdnjs.cloudflare.com/ajax/libs/axe-core/${AXE_VERSION}/axe.min.js`, `https://cdn.jsdelivr.net/npm/axe-core@${AXE_VERSION}/axe.min.js`];

function body(copyLine: string): string {
  return `(async () => {
  const load = (src) => new Promise((ok, fail) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = fail; document.head.appendChild(s); });
  if (!window.axe) { try { await load(${JSON.stringify(CDN[0])}); } catch { await load(${JSON.stringify(CDN[1])}); } }
  const r = await axe.run(document, { runOnly: { type: 'tag', values: ${JSON.stringify(AXE_TAGS)} }, resultTypes: ['violations'] });
  const keep = { url: r.url, timestamp: r.timestamp, testEngine: r.testEngine, violations: r.violations.map((v) => ({ id: v.id, help: v.help, impact: v.impact, tags: v.tags, nodes: v.nodes.map(() => ({})) })) };
  const json = JSON.stringify(keep);
  ${copyLine}
})();`;
}

/** For the DevTools console: uses the console's copy() helper. */
export function consoleSnippet(): string {
  return body(
    "try { copy(json); console.log('Fleet Log: ' + keep.violations.length + ' failing rules copied. Paste them into the app.'); } catch { console.log(json); }",
  );
}

/** A javascript: URL to save as a bookmark. */
export function bookmarklet(): string {
  const code = body(
    "try { await navigator.clipboard.writeText(json); alert('Fleet Log: ' + keep.violations.length + ' failing rules copied. Paste them into the app.'); } catch { prompt('Copy these results:', json); }",
  );
  return `javascript:${encodeURIComponent(code.replace(/\n\s*/g, ' '))}`;
}
