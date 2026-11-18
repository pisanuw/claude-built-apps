/**
 * The sign-in panel's styles (src/lib/auth.ts, mountSignIn), one CSS block
 * that mountSignIn adds to the page once, first in <head> so the app's own
 * styles can override the layout.
 *
 * The look is UpvoteMe's (https://upvoteme.hintwise.org; owner, 18 November
 * 2026; BUILD_ROUTINE.md, "Google sign-in button"): at the right of the
 * app's top bar, two separate outlined pill buttons, "Sign in with Google"
 * and "Magic link". "Magic link" opens a small panel under the buttons with
 * the email form. Signed in, the same place shows the person (opening a
 * panel with "Delete my account") and "Sign out".
 *
 * Below 640 px every bar button becomes a round, bordered, icon-only button
 * whose label stays its accessible name: the owner's choice for phones. That
 * is the one media query at the end, so going back to visible labels is a
 * one-block change.
 *
 * The Google button is a custom button under Google's branding guidelines:
 * the text "Sign in with Google"; the standard multicolour G from Google's
 * signin-assets.zip, unmodified (google-g-light.svg); the light theme (fill
 * #FFFFFF, 1px inside stroke #747775, text #1F1F1F); Google Sans Medium,
 * 14px on a 20px line; 12px before the logo, 10px after it, 12px after the
 * text; pill shape. The template loads no external fonts, so 'Google Sans'
 * is used only where it is installed and Roboto or Arial stand in; an app
 * that already loads Google Fonts may add Google Sans there.
 *
 * The other bar buttons share .hw-signin-button: the same height, type,
 * border and weight, so neither sign-in option is more prominent. Light
 * theme only: a dark page needs the dark values (#131314, stroke #8E918F,
 * text #E3E3E3), the dark asset from the same zip, and a dark panel.
 */

export const SIGN_IN_STYLE_ID = 'hw-signin-styles';

export const SIGN_IN_CSS = `
.hw-signin {
  position: relative;
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex: none;
  margin-left: auto;
}
.hw-signin-button {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  height: 40px;
  min-width: 0;
  padding: 0 12px;
  background: #FFFFFF;
  border: 1px solid #747775;
  border-radius: 20px;
  color: #1F1F1F;
  font-family: 'Google Sans', Roboto, Arial, sans-serif;
  font-weight: 500;
  font-size: 14px;
  line-height: 20px;
  white-space: nowrap;
  cursor: pointer;
}
.hw-signin-button:hover {
  background: #F8F9FA;
}
.hw-signin-button:focus-visible {
  outline: 2px solid #0B57D0;
  outline-offset: 2px;
}
.hw-signin-button:disabled {
  cursor: default;
  opacity: 0.6;
}
.hw-signin-google-logo {
  display: inline-flex;
  flex: none;
  width: 20px;
  height: 20px;
  margin-right: 10px;
}
.hw-signin-google-logo svg {
  display: block;
  width: 20px;
  height: 20px;
}
.hw-signin-glyph {
  display: inline-flex;
  flex: none;
  margin-right: 6px;
  color: #64748B;
}
.hw-signin-glyph svg {
  display: block;
  width: 16px;
  height: 16px;
}
.hw-signin-avatar {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  margin-right: 8px;
  border-radius: 50%;
  background: #D3E3FD;
  color: #041E49;
  font-size: 12px;
  line-height: 20px;
}
.hw-signin-person .hw-signin-label {
  max-width: 16rem;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hw-signin-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.hw-signin-panel {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 1000;
  box-sizing: border-box;
  display: grid;
  gap: 0.75rem;
  /* 21.5rem leaves 309px inside, room for Turnstile's 300px widget; narrower phones get its compact form. */
  width: 21.5rem;
  max-width: calc(100vw - 32px);
  padding: 16px;
  background: #FFFFFF;
  color: #1F1F1F;
  border: 1px solid #C4C7C5;
  border-radius: 12px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.14);
  text-align: left;
  white-space: normal;
}
.hw-signin-panel[hidden] {
  display: none;
}
.hw-signin-panel p {
  margin: 0;
}
.hw-signin-panel form {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0;
}
.hw-signin-panel input[type='email'] {
  flex: 1 1 12rem;
  min-width: 0;
  box-sizing: border-box;
  height: 40px;
  padding: 0 12px;
  font: inherit;
  border: 1px solid #747775;
  border-radius: 20px;
}
.hw-signin-user {
  overflow-wrap: anywhere;
}
.hw-signin-status:empty,
.hw-signin-challenge:empty {
  display: none;
}
.hw-signin-challenge {
  max-width: 100%;
  overflow-x: auto;
}
.hw-account-delete summary {
  cursor: pointer;
}
.hw-account-delete > p,
.hw-account-delete > form {
  margin-top: 0.5rem;
}
@media (max-width: 639.98px) {
  .hw-signin-icon {
    width: 40px;
    padding: 0 9px;
  }
  .hw-signin-icon .hw-signin-label {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  .hw-signin-icon .hw-signin-google-logo,
  .hw-signin-icon .hw-signin-glyph,
  .hw-signin-icon .hw-signin-avatar {
    margin-right: 0;
  }
}
`;

/** Adds the panel's styles to the document once. */
export function ensureSignInStyles(doc: Document = document): void {
  if (doc.getElementById(SIGN_IN_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = SIGN_IN_STYLE_ID;
  style.textContent = SIGN_IN_CSS;
  doc.head.prepend(style);
}
