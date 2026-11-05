import type { OverlayKind } from './apps';

export type Status = 'pass' | 'fail' | 'warn' | 'manual' | 'notrun' | 'na';

export type CheckId =
  | 'focus-in'
  | 'tab-trap'
  | 'escape'
  | 'focus-return'
  | 'close-name'
  | 'close-size'
  | 'dialog-role'
  | 'dialog-name'
  | 'background'
  | 'field-labels'
  | 'button-names'
  | 'image-alt'
  | 'contrast'
  | 'fake-buttons'
  | 'keyboard-reach'
  | 'frame';

/** How a result was obtained. */
export type How = 'read' | 'simulated' | 'you';

export interface Finding {
  check: CheckId;
  status: Status;
  detail: string;
  how: How;
  examples?: string[];
}

export interface OverlayResult {
  id: string;
  kind: OverlayKind;
  app?: string;
  label: string;
  where: string;
  modal: boolean;
  framed: boolean;
  findings: Finding[];
}

export interface Report {
  v: 1;
  url: string;
  title: string;
  checkedAt: string;
  appsOnPage: string[];
  overlays: OverlayResult[];
}

export const CHECK_TITLES: Record<CheckId, string> = {
  'focus-in': 'Keyboard focus moves into it when it opens',
  'tab-trap': 'Tab stays inside it while it is open',
  escape: 'The Escape key closes it',
  'focus-return': 'Focus lands somewhere sensible after it closes',
  'close-name': 'The close button has a name a screen reader can read',
  'close-size': 'The close (or chat) button is big enough to tap',
  'dialog-role': 'Screen readers are told a popup opened',
  'dialog-name': 'The popup has a title screen readers announce',
  background: 'The page behind is hidden from screen readers while it is open',
  'field-labels': 'Form fields have labels',
  'button-names': 'Buttons and links have names',
  'image-alt': 'Images have text descriptions',
  contrast: 'Text is easy to read (contrast)',
  'fake-buttons': 'Everything clickable works with the keyboard',
  'keyboard-reach': 'It can be reached with the Tab key',
  frame: 'Content inside a frame from another site',
};

export const KIND_LABELS: Record<OverlayKind, string> = {
  email: 'Email sign-up or discount popup',
  age: 'Age gate',
  cookie: 'Cookie banner',
  chat: 'Chat button',
  other: 'Popup',
};

export const STATUS_LABELS: Record<Status, string> = {
  pass: 'Passed',
  fail: 'Problem',
  warn: 'Worth a look',
  manual: 'Check by hand',
  notrun: 'Not tested yet',
  na: 'Does not apply',
};
