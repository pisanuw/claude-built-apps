/**
 * Checks that only read the page: names, roles, labels, contrast, sizes and
 * whether clickable things can be reached with the keyboard.
 */
import { contrastProblems } from './contrast';
import { allElements, computed, deepContains, describe, isFocusable, isHidden, isNativeModal, isHiddenFromReaders, isShown, parentOf, shortText, tabbables, type Env } from './dom';
import type { Overlay } from './detect';
import { accessibleName, isSymbolOnlyName } from './name';
import type { Finding } from './types';

const CONTROL = 'button, a[href], [role=button], [role=link], input[type=button], input[type=submit], input[type=image]';
const CLOSE_WORDS = /\b(close|dismiss|no,? thanks|not now|maybe later|skip|cancel|hide)\b|^[×✕✖✗✘xX╳⨯]$/i;

const read = (f: Omit<Finding, 'how'>): Finding => ({ ...f, how: 'read' });

function label(el: Element): string {
  const n = accessibleName(el).name;
  return n ? `“${n.slice(0, 50)}” (${describe(el)})` : describe(el);
}

/** Things inside the overlay that look like a close control. */
export function closeControls(env: Env, root: Element): Element[] {
  const out: Element[] = [];
  for (const el of [root, ...allElements(root)]) {
    if (env.ignore(el) || !isShown(env, el)) continue;
    const marks = `${el.id} ${el.getAttribute('class') ?? ''} ${el.getAttribute('data-action') ?? ''}`.toLowerCase();
    const name = accessibleName(el).name;
    const clickable = el.matches(CONTROL) || el.hasAttribute('onclick') || computed(el).cursor === 'pointer';
    if (!clickable) continue;
    if (CLOSE_WORDS.test(name) || /close|dismiss/.test(marks)) {
      if (!out.some((o) => deepContains(o, el))) out.push(el);
    }
  }
  return out;
}

function inFocusableAncestor(el: Element, root: Element): boolean {
  if (el === root) return false;
  let n = parentOf(el);
  while (n) {
    if (isFocusable(n)) return true;
    if (n === root) return false;
    n = parentOf(n);
  }
  return false;
}

/** Clickable-looking elements that the keyboard cannot reach. */
export function fakeButtons(env: Env, root: Element): Element[] {
  const out: Element[] = [];
  const looksClickable = (el: Element): boolean =>
    el.hasAttribute('onclick') ||
    el.getAttribute('role') === 'button' ||
    computed(el).cursor === 'pointer' ||
    /(^|[\s_-])(btn|button|close|dismiss)([\s_-]|$)/i.test(el.getAttribute('class') ?? '');
  for (const el of [root, ...allElements(root)]) {
    if (env.ignore(el) || !(el instanceof HTMLElement || el instanceof SVGElement)) continue;
    if (el.matches('label, input, select, textarea, option, iframe, img, svg *, html, body')) continue;
    if (!looksClickable(el) || isFocusable(el) || inFocusableAncestor(el, root) || !isShown(env, el)) continue;
    if (out.some((o) => deepContains(o, el))) continue;
    if (el === root && !el.hasAttribute('onclick') && el.getAttribute('role') !== 'button') continue;
    out.push(el);
  }
  return out;
}

export function staticChecks(env: Env, o: Overlay): Finding[] {
  const findings: Finding[] = [];
  const root = o.root;
  const dialog = o.dialog;
  const tabs = tabbables(env, root);

  if (o.framed) {
    const frames = (root.tagName === 'IFRAME' ? [root] : Array.from(root.querySelectorAll('iframe'))) as HTMLIFrameElement[];
    const untitled = frames.filter((f) => !accessibleName(f).name);
    findings.push(
      read({
        check: 'frame',
        status: untitled.length ? 'fail' : 'manual',
        detail: untitled.length
          ? 'Part of this is drawn inside a frame from another site, and the frame has no title, so a screen reader announces it as just “frame”. Popup Check cannot look inside it.'
          : `Part of this is drawn inside a frame from another site (titled “${accessibleName(frames[0]).name}”). Popup Check cannot look inside it: use the guided keyboard test, and try it with a screen reader.`,
      }),
    );
  }

  if (o.kind === 'chat' || (o.kind === 'cookie' && !o.modal)) {
    findings.push(
      read({
        check: 'keyboard-reach',
        status: tabs.length || o.framed ? 'pass' : 'fail',
        detail: tabs.length
          ? `${tabs.length} control${tabs.length === 1 ? '' : 's'} can be reached with Tab.`
          : o.framed
            ? 'The frame itself can take focus; what is inside it needs a hand check.'
            : 'Nothing in it can be reached with the Tab key, so a keyboard user can never open or answer it.',
      }),
    );
  }

  if (o.modal) {
    const isDialog = !!dialog;
    findings.push(
      read({
        check: 'dialog-role',
        status: isDialog ? 'pass' : 'fail',
        detail: isDialog
          ? 'Marked as a dialog.'
          : 'Nothing tells a screen reader that a popup has opened: it is ordinary page content pinned on top. Screen-reader users may not know it is there, or that it is blocking the page.',
      }),
    );
    if (dialog) {
      const n = accessibleName(dialog).name;
      findings.push(
        read({
          check: 'dialog-name',
          status: n ? 'pass' : 'warn',
          detail: n ? `Announced as “${n.slice(0, 80)}”.` : 'The dialog has no title (aria-label or aria-labelledby), so it is announced as just “dialog”.',
        }),
      );
    } else {
      findings.push(read({ check: 'dialog-name', status: 'na', detail: 'Not marked as a dialog, so it cannot have a dialog title.' }));
    }
    const ariaModal = dialog?.getAttribute('aria-modal') === 'true';
    const nativeModal = isNativeModal(dialog);
    const siblingsHidden = backgroundHidden(env, root);
    findings.push(
      read({
        check: 'background',
        status: ariaModal || nativeModal || siblingsHidden ? 'pass' : 'fail',
        detail: ariaModal
          ? 'The dialog says it is modal (aria-modal), so screen readers stay inside it.'
          : nativeModal
            ? 'Opened as a modal dialog: the browser hides the page behind it.'
            : siblingsHidden
              ? 'The rest of the page is hidden from screen readers while it is open.'
              : 'A screen-reader user can still move into the page behind the popup, which is covered and cannot be used.',
      }),
    );
  }

  const closes = closeControls(env, root);
  if (o.kind === 'age') {
    findings.push(read({ check: 'close-name', status: 'na', detail: 'An age gate is answered, not closed; its answer buttons are checked under “Buttons and links have names”.' }));
  } else if (o.kind !== 'chat' && (o.modal || closes.length)) {
    if (!closes.length) {
      findings.push(
        read({
          check: 'close-name',
          status: o.modal ? 'fail' : 'warn',
          detail: 'No close or “no thanks” control was found, so a shopper may have no way to get rid of it.',
        }),
      );
    } else {
      const bad = closes.filter((c) => {
        const n = accessibleName(c).name;
        return !n || isSymbolOnlyName(n);
      });
      const unreachable = closes.filter((c) => !isFocusable(c) && !inFocusableAncestor(c, root));
      const status = bad.length === closes.length || unreachable.length === closes.length ? 'fail' : bad.length || unreachable.length ? 'warn' : 'pass';
      const parts: string[] = [];
      if (bad.length) parts.push(`${bad.length === closes.length ? 'The close control has' : 'Some close controls have'} no readable name: a screen reader says “button”, or reads the × as “times”.`);
      if (unreachable.length) parts.push(`${unreachable.length === closes.length ? 'The close control' : 'A close control'} cannot be reached with the keyboard.`);
      findings.push(
        read({
          check: 'close-name',
          status,
          detail: parts.length ? parts.join(' ') : `Found ${closes.map(label).join(', ')}.`,
          examples: [...new Set([...bad, ...unreachable])].map(label),
        }),
      );
      const small = closes.filter((c) => {
        const r = env.rect(c);
        return r.width < 24 || r.height < 24;
      });
      findings.push(
        read({
          check: 'close-size',
          status: small.length ? 'warn' : 'pass',
          detail: small.length
            ? `The close control is smaller than 24 × 24 pixels (${small.map((c) => `${Math.round(env.rect(c).width)} × ${Math.round(env.rect(c).height)}`).join(', ')}), which is hard to tap for people with shaky hands.`
            : 'The close control is at least 24 × 24 pixels.',
        }),
      );
    }
  }
  if (o.kind === 'chat') {
    const small = tabs.filter((t) => {
      const r = env.rect(t);
      return r.width < 24 || r.height < 24;
    });
    if (tabs.length) {
      findings.push(
        read({
          check: 'close-size',
          status: small.length ? 'warn' : 'pass',
          detail: small.length ? 'The chat button is smaller than 24 × 24 pixels.' : 'The chat button is at least 24 × 24 pixels.',
        }),
      );
    }
  }

  const fields = allElements(root).filter(
    (el) => (el instanceof HTMLInputElement && !['hidden', 'submit', 'button', 'reset', 'image'].includes(el.type)) || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement,
  ).filter((el) => isShown(env, el) && !env.ignore(el));
  if (fields.length) {
    const unnamed = fields.filter((f) => accessibleName(f).source === 'none');
    const placeholderOnly = fields.filter((f) => accessibleName(f).source === 'placeholder');
    findings.push(
      read({
        check: 'field-labels',
        status: unnamed.length ? 'fail' : placeholderOnly.length ? 'warn' : 'pass',
        detail: unnamed.length
          ? `${unnamed.length} of ${fields.length} form field${fields.length === 1 ? ' has' : 's have'} no label, so a screen reader announces just “edit text”.`
          : placeholderOnly.length
            ? `${placeholderOnly.length} field${placeholderOnly.length === 1 ? ' is' : 's are'} labelled only by grey placeholder text, which disappears as soon as the shopper starts typing.`
            : fields.length === 1 ? 'The form field has a label.' : `All ${fields.length} form fields have labels.`,
        examples: [...unnamed, ...placeholderOnly].map((f) => `${describe(f)}${(f as HTMLInputElement).placeholder ? ` (placeholder “${(f as HTMLInputElement).placeholder}”)` : ''}`),
      }),
    );
  }

  const controls = [root, ...allElements(root)].filter((el) => el.matches(CONTROL) && isShown(env, el) && !env.ignore(el));
  if (controls.length) {
    const unnamed = controls.filter((c) => !accessibleName(c).name);
    findings.push(
      read({
        check: 'button-names',
        status: unnamed.length ? 'fail' : 'pass',
        detail: unnamed.length
          ? `${unnamed.length} button${unnamed.length === 1 ? ' or link has' : 's or links have'} no name, so a screen reader says only “button” or “link”.`
          : controls.length === 1 ? 'The button has a name.' : `All ${controls.length} buttons and links have names.`,
        examples: unnamed.map((c) => `${describe(c)}${shortText(c, 30) ? ` “${shortText(c, 30)}”` : ''}`),
      }),
    );
  }

  const images = allElements(root).filter((el): el is HTMLImageElement => el instanceof HTMLImageElement && isShown(env, el) && !isHiddenFromReaders(el));
  if (images.length) {
    const missing = images.filter((i) => !i.hasAttribute('alt'));
    findings.push(
      read({
        check: 'image-alt',
        status: missing.length ? 'fail' : 'pass',
        detail: missing.length
          ? `${missing.length} image${missing.length === 1 ? ' has' : 's have'} no description (alt text); a screen reader may read out the file name instead.`
          : `${images.length === 1 ? 'The image has' : `All ${images.length} images have`} a description or ${images.length === 1 ? 'is' : 'are'} marked as decoration.`,
        examples: missing.map((i) => imageLabel(i.getAttribute('src') ?? '')),
      }),
    );
  }

  if (!o.framed || shortText(root)) {
    const c = contrastProblems(root);
    if (c.checked || c.problems.length) {
      findings.push(
        read({
          check: 'contrast',
          status: c.problems.length ? 'fail' : 'pass',
          detail: c.problems.length
            ? `${c.problems.length} piece${c.problems.length === 1 ? '' : 's'} of text ${c.problems.length === 1 ? 'is' : 'are'} too faint against the background (WCAG asks for 4.5 to 1, or 3 to 1 for large text).`
            : `Text contrast is fine in the ${c.checked} piece${c.checked === 1 ? '' : 's'} of text checked${c.skipped ? `; ${c.skipped} on a picture or gradient could not be measured` : ''}.`,
          examples: c.problems.slice(0, 5).map((p) => `“${p.text}”: ${p.ratio} to 1 (needs ${p.needed}), ${p.color} on ${p.background}`),
        }),
      );
    } else if (c.skipped) {
      findings.push(read({ check: 'contrast', status: 'manual', detail: 'The text sits on a picture or gradient, so contrast could not be measured. Check it by eye.' }));
    }
  }

  const fakes = fakeButtons(env, root);
  findings.push(
    read({
      check: 'fake-buttons',
      status: fakes.length ? 'fail' : 'pass',
      detail: fakes.length
        ? `${fakes.length} thing${fakes.length === 1 ? ' looks' : 's look'} clickable but cannot be reached with the keyboard (built from a plain box instead of a real button).`
        : 'Everything that looks clickable can be reached with the keyboard.',
      examples: fakes.map(label),
    }),
  );
  return findings;
}

function imageLabel(src: string): string {
  if (!src || src.startsWith('data:')) return 'an embedded image';
  return src.split('?')[0].split('/').pop()?.slice(0, 60) || src.slice(0, 60);
}

/** Whether everything outside the overlay is hidden from screen readers or inert. */
function backgroundHidden(env: Env, root: Element): boolean {
  const body = env.doc.body;
  let n: Element = root;
  let checked = 0;
  while (n && n !== body) {
    const parent = parentOf(n);
    if (!parent) break;
    for (const sib of Array.from(parent.children)) {
      if (sib === n || env.ignore(sib) || sib.matches('script, style, link, template, noscript')) continue;
      if (isHidden(sib)) continue;
      checked++;
      if (!isHiddenFromReaders(sib)) return false;
    }
    n = parent;
  }
  return checked > 0;
}
