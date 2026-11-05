/** Styles for the on-page panel, inside its shadow root (pixel sizes: the store may resize rem). */
export const PANEL_CSS = `
:host { all: initial; }
.panel {
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
  width: min(380px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto;
  background: #ffffff; color: #18202b; border: 2px solid #1f5f8b; border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0,0,0,.25); padding: 12px 14px;
  font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; text-align: left;
}
.bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
h2 { font-size: 17px; margin: 0; }
h2:focus { outline: none; }
h3 { font-size: 15px; margin: 0 0 4px; }
p { margin: 6px 0; }
.lead { font-weight: 600; }
.quote { color: #4b5666; font-style: italic; overflow-wrap: anywhere; }
.counts, .small, .how { color: #4b5666; font-size: 13px; }
.message { background: #e5f3e8; color: #1b6630; padding: 6px 8px; border-radius: 6px; }
button {
  font: inherit; font-size: 13px; cursor: pointer; border-radius: 6px; padding: 6px 10px; min-height: 32px;
  border: 1px solid #1f5f8b; background: #ffffff; color: #1f5f8b;
}
button.primary { background: #1f5f8b; color: #ffffff; }
button.icon { font-size: 20px; line-height: 1; padding: 2px 8px; min-width: 32px; }
button:focus-visible, summary:focus-visible { outline: 3px solid #f2b544; outline-offset: 2px; }
.actions { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
.overlay { border-top: 1px solid #d3d9e2; padding-top: 10px; margin-top: 10px; }
details summary { cursor: pointer; color: #1a5a96; }
.findings { list-style: none; padding: 0; margin: 6px 0; }
.finding { border-left: 4px solid #d3d9e2; padding: 2px 0 2px 8px; margin: 8px 0; }
.finding.fail { border-color: #a3261b; } .finding.warn { border-color: #b26a00; } .finding.pass { border-color: #1b6630; }
.finding-head { display: flex; gap: 6px; align-items: baseline; flex-wrap: wrap; }
.badge { font-size: 12px; font-weight: 700; padding: 1px 6px; border-radius: 10px; background: #eceff4; color: #18202b; white-space: nowrap; }
.badge.fail { background: #fbe9e7; color: #a3261b; } .badge.warn { background: #fff1d6; color: #7a4a00; } .badge.pass { background: #e5f3e8; color: #1b6630; }
.examples { margin: 2px 0 0 18px; padding: 0; font-size: 12px; color: #4b5666; overflow-wrap: anywhere; }
.steps { margin: 6px 0 6px 20px; padding: 0; }
.highlight { position: fixed; z-index: 2147483646; outline: 4px dashed #d4380d; outline-offset: 2px; pointer-events: none; }
@media (prefers-color-scheme: dark) {
  .panel { background: #19202a; color: #e5e9f0; border-color: #8cc4ef; }
  .quote, .counts, .small, .how, .examples { color: #a6b0bf; }
  button { background: #19202a; color: #8cc4ef; border-color: #8cc4ef; }
  button.primary { background: #8cc4ef; color: #0b1a26; }
  details summary { color: #8cc4ef; }
  .overlay { border-color: #323c4b; }
  .badge { background: #262d39; color: #e5e9f0; }
  .badge.fail { background: #3b1d1a; color: #ff9a8f; } .badge.warn { background: #3a2a10; color: #ffc46b; } .badge.pass { background: #16301f; color: #85d19a; }
  .message { background: #16301f; color: #85d19a; }
}
`;
