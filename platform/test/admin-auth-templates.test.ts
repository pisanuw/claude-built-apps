import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CODE_ONLY_REFUSAL_MESSAGE } from '../src/signin/hook.ts';
import DEFAULTS from './fixtures/auth-default-templates.json';

// Owner, 23 Nov 2026: "take code out". inspect reports Auth's email
// templates and configure-auth --templates-no-code rewrites the ones that
// print Auth's code. SUPABASE_ADMIN_NO_RUN=1 lets the pure helpers be
// imported without running a command.
type Admin = typeof import('../supabase-admin.mjs');
let m: Admin;
beforeAll(async () => {
  process.env.SUPABASE_ADMIN_NO_RUN = '1';
  m = await import('../supabase-admin.mjs');
});

const TYPES = Object.keys(DEFAULTS.since_v2_190_0.subjects);
const LINK_TYPES = ['invite', 'confirmation', 'recovery', 'magic_link', 'email_change'] as const;
const linkCount = (text: string, name: string) => (text.match(new RegExp(`\\{\\{-?\\s*\\.${name}\\s*-?\\}\\}`, 'g')) ?? []).length;

describe('printsCode: every template variable that prints Auth code', () => {
  it('finds .Token and .TokenNew however they are spaced or trimmed', () => {
    for (const t of [
      '{{ .Token }}', '{{.Token}}', '{{  .Token  }}', '{{- .Token -}}', '{{-  .Token}}', '{{.Token -}}', '{{\n.Token\n}}',
      '{{ .TokenNew }}', '{{.TokenNew}}', '{{- .TokenNew -}}', '{{ $.Token }}', '{{ $.TokenNew }}',
      'Your code is {{ .Token }}.', '<p>{{ .Token }}</p>', '<a href="{{ .SiteURL }}/verify?code={{.Token}}">Go</a>',
    ]) expect(m.printsCode(t), t).toBe(true);
  });
  it('finds the code however it is printed: a pipeline, a variable, a test, index, or the whole data', () => {
    for (const t of [
      '{{ .Token | printf "%s" }}', '{{ printf "%s" .Token }}', '{{ html .Token }}', '{{ $t := .Token }}{{ $t }}',
      '{{ if .Token }}x{{ end }}', '{{ with .Token }}{{ . }}{{ end }}', '{{ index . "Token" }}', '{{ index $ `TokenNew` }}',
      '{{ . }}', '{{.}}', '{{ $ }}', '{{ printf "%v" . }}', '{{ range $k, $v := . }}{{ $v }}{{ end }}', '{{ template "x" . }}',
    ]) expect(m.printsCode(t), t).toBe(true);
  });
  it('leaves links, other fields, strings and comments alone', () => {
    for (const t of [
      '', null, undefined, 'Token', '{{ .TokenHash }}', '{{.TokenHash}}', '{{ .ConfirmationURL }}', '{{ .SiteURL }}', '{{ .RedirectTo }}',
      '{{ .Email }} {{ .NewEmail }} {{ .SendingTo }}', '{{ .Data.Token }}', '{{ .Data.name }}', '{{ "Token" }}', '{{ printf "%s." .Email }}',
      '{{ /* .Token */ }}', '{{- /* {{ . }} */ -}}', '{{ with .Data }}{{ .name }}{{ end }}', '{{ printf "%.2f" 1.5 }}', '{{ $x := .Email }}{{ $x }}',
      '<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next={{ .RedirectTo }}">Sign in</a>',
    ]) expect(m.printsCode(t as string), String(t)).toBe(false);
  });
});

describe("Auth's built-in templates (supabase/auth templatemailer.go, test/fixtures/auth-default-templates.json)", () => {
  const printing = (texts: Record<string, string>) => Object.keys(texts).filter((k) => m.printsCode(texts[k]));
  it('since v2.190.0: only reauthentication prints the code, in its subject and its body', () => {
    expect(printing(DEFAULTS.since_v2_190_0.subjects)).toEqual(['reauthentication']);
    expect(printing(DEFAULTS.since_v2_190_0.bodies)).toEqual(['reauthentication']);
    expect(m.DEFAULT_BODY_CODE_TYPES).toEqual(['reauthentication']);
    expect(m.AUTH_DEFAULT_SUBJECTS).toEqual(DEFAULTS.since_v2_190_0.subjects);
  });
  it('before v2.190.0: the five link emails and reauthentication print it in the body, no subject does', () => {
    expect(printing(DEFAULTS.before_v2_190_0.subjects)).toEqual([]);
    expect(printing(DEFAULTS.before_v2_190_0.bodies)).toEqual([...LINK_TYPES, 'reauthentication']);
    expect(m.OLD_DEFAULT_BODY_CODE_TYPES).toEqual([...LINK_TYPES, 'reauthentication']);
  });
  it("writes Auth's own code-free bodies for the five link emails", () => {
    for (const t of LINK_TYPES) {
      expect(m.AUTH_LINK_BODIES[t]).toBe(DEFAULTS.since_v2_190_0.bodies[t]);
      expect(m.printsCode(m.AUTH_LINK_BODIES[t])).toBe(false);
      expect(linkCount(m.AUTH_LINK_BODIES[t], 'ConfirmationURL')).toBe(1);
    }
  });
  it('tells the versions apart', () => {
    expect(['v2.198.0', '2.190.0', 'v2.190.1', 'v2.191.0', 'v3.0.0'].map((v) => m.authDefaultsEra(v))).toEqual(['new', 'new', 'new', 'new', 'new']);
    expect(['v2.189.9', 'v2.188.1', 'v1.999.0'].map((v) => m.authDefaultsEra(v))).toEqual(['old', 'old', 'old']);
    expect([undefined, '', 'GoTrue', 'v2'].map((v) => m.authDefaultsEra(v))).toEqual(['unknown', 'unknown', 'unknown', 'unknown']);
  });
  it('counts a pre-release of exactly 2.190.0 as unknown, and orders the others as releases', () => {
    expect(['v2.190.0-rc.4', '2.190.0-beta', 'v2.190.0-0'].map((v) => m.authDefaultsEra(v))).toEqual(['unknown', 'unknown', 'unknown']);
    expect(['v2.190.1-rc.1', 'v2.191.0-rc.2', 'v2.190.0+build.7'].map((v) => m.authDefaultsEra(v))).toEqual(['new', 'new', 'new']);
    expect(['v2.189.0-rc.1', 'v2.189.9-rc.9'].map((v) => m.authDefaultsEra(v))).toEqual(['old', 'old']);
    expect(m.authVersionLine('v2.190.0-rc.4')).toBe("Auth v2.190.0-rc.4 is a pre-release of v2.190.0, which may have either set of built-in templates: counting every built-in template that prints the code in any version (reauthentication's subject and body; before v2.190.0 also the five link emails' bodies).");
  });
  it("reads Auth's version from the health answer, digits only", () => {
    const health = (version: unknown) => [{ name: 'db', healthy: true, status: 'ACTIVE_HEALTHY' }, { name: 'auth', healthy: true, status: 'ACTIVE_HEALTHY', info: { name: 'GoTrue', version, description: 'GoTrue is a user registration and authentication API' } }];
    expect(m.pickAuthVersion(health('v2.198.0'))).toBe('v2.198.0');
    expect(m.pickAuthVersion(health('2.177.0-rc.1'))).toBe('v2.177.0-rc.1');
    expect(m.pickAuthVersion(health('2.190.0-rc.4'))).toBe('v2.190.0-rc.4');
    expect(m.pickAuthVersion(health('v2.1.0-rc::error::x'))).toBe('v2.1.0-rc');
    expect(m.pickAuthVersion(health('::error::v2.1.0'))).toBe('v2.1.0');
    expect(m.pickAuthVersion(health(7))).toBeUndefined();
    expect(m.pickAuthVersion([{ name: 'db' }])).toBeUndefined();
    expect(m.pickAuthVersion({ name: 'auth' })).toBeUndefined();
    expect(m.authVersionLine('v2.198.0')).toBe("Auth v2.198.0: of Auth's built-in templates, only reauthentication's subject and body print the code.");
    expect(m.authVersionLine('v2.180.0')).toContain('older than v2.190.0');
    expect(m.authVersionLine(undefined)).toContain('cannot be read');
  });
  it('counts an empty template by its built-in default, both versions when unknown', () => {
    expect(m.defaultPrintsCode('subject', 'reauthentication', 'new')).toBe(true);
    expect(m.defaultPrintsCode('subject', 'reauthentication', 'old')).toBe(false);
    expect(m.defaultPrintsCode('subject', 'reauthentication', 'unknown')).toBe(true);
    expect(m.defaultPrintsCode('content', 'reauthentication', 'old')).toBe(true);
    expect(m.defaultPrintsCode('content', 'magic_link', 'new')).toBe(false);
    expect(m.defaultPrintsCode('content', 'magic_link', 'old')).toBe(true);
    expect(m.defaultPrintsCode('content', 'magic_link', 'unknown')).toBe(true);
    expect(m.defaultPrintsCode('subject', 'magic_link', 'unknown')).toBe(false);
    expect(m.defaultPrintsCode('content', 'password_changed_notification', 'unknown')).toBe(false);
    expect(m.defaultPrintsCode('subject', 'not_a_type', 'unknown')).toBe(false);
  });
});

/** Every template key, empty: Auth's built-in defaults. */
const EMPTY = Object.fromEntries(TYPES.flatMap((t) => [[`mailer_subjects_${t}`, null], [`mailer_templates_${t}_content`, '']]));
/** The project as the GET answers it, with secrets as the API shows them and every template empty. */
const PROJECT = {
  site_url: 'https://how-of-happiness.netlify.app',
  smtp_host: 'smtp.resend.com', smtp_user: 'resend',
  smtp_pass: 'c2f1b0a9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d9c8b7a6f5e4d3c2b1',
  external_google_secret: 'google-secret-digest-0123456789',
  mailer_otp_length: 10, mailer_otp_exp: 3600,
  security_update_password_require_reauthentication: false,
  ...EMPTY,
};
/** Custom templates with marker text that must never reach the log. */
const CUSTOM = {
  mailer_subjects_magic_link: 'SECRET-SUBJECT-ML {{ .Token }} is your code',
  mailer_templates_magic_link_content: '<h2>SECRET-ML heading</h2>\n<p>SECRET-ML <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next={{ .RedirectTo }}">Sign in</a></p>\n<p>SECRET-ML Or enter the code: <strong>{{.Token}}</strong></p>\n',
  mailer_templates_reauthentication_content: '<h2>Confirm reauthentication</h2>\n\n<p>SECRET-RA Enter the code: {{ .Token }}</p>',
  mailer_subjects_reauthentication: 'Confirm reauthentication',
  mailer_templates_recovery_content: '<h2>SECRET-RC</h2><p><a href="{{ .ConfirmationURL }}">Reset</a></p>',
};

describe('templateStates and templateLines (inspect)', () => {
  it('reports every template key, set or empty, and whether it prints the code', () => {
    const states = m.templateStates({ ...PROJECT, ...CUSTOM }, 'v2.198.0');
    expect(states).toHaveLength(26);
    const by = Object.fromEntries(states.map((s) => [s.key, s]));
    expect(by.mailer_subjects_magic_link).toEqual({ key: 'mailer_subjects_magic_link', kind: 'subject', type: 'magic_link', set: true, printsCode: true });
    expect(by.mailer_templates_magic_link_content).toMatchObject({ kind: 'content', set: true, printsCode: true });
    expect(by.mailer_subjects_reauthentication).toMatchObject({ set: true, printsCode: false });
    expect(by.mailer_templates_reauthentication_content).toMatchObject({ set: true, printsCode: true });
    expect(by.mailer_templates_recovery_content).toMatchObject({ set: true, printsCode: false });
    expect(by.mailer_templates_invite_content).toMatchObject({ set: false, printsCode: false });
    expect(states.filter((s) => s.printsCode).map((s) => s.key)).toEqual(['mailer_subjects_magic_link', 'mailer_templates_magic_link_content', 'mailer_templates_reauthentication_content']);
  });
  it('counts the built-in defaults when every template is empty', () => {
    const printing = (v: string | undefined) => m.templateStates(PROJECT, v).filter((s) => s.printsCode).map((s) => s.key);
    expect(printing('v2.198.0')).toEqual(['mailer_subjects_reauthentication', 'mailer_templates_reauthentication_content']);
    expect(printing('v2.180.0')).toEqual(['invite', 'confirmation', 'recovery', 'magic_link', 'email_change', 'reauthentication'].map((t) => `mailer_templates_${t}_content`));
    expect(printing(undefined)).toHaveLength(7);
    expect(m.templateStates(null, 'v2.198.0')).toEqual([]);
  });
  it('ignores keys that are not email templates', () => {
    const keys = m.templateStates({ mailer_otp_length: 10, mailer_notifications_password_changed_enabled: true, sms_template: 'Your code is {{ .Code }}', mailer_subjects_x: 'x' }, 'v2.198.0').map((s) => s.key);
    expect(keys).toEqual(['mailer_subjects_x']);
    expect(m.templateKeyInfo('mailer_templates_email_change_content')).toEqual({ kind: 'content', type: 'email_change' });
    expect(m.templateKeyInfo('mailer_otp_exp')).toBeNull();
  });
  it('prints names and booleans, never the text', () => {
    const lines = m.templateLines(m.templateStates({ ...PROJECT, ...CUSTOM }, 'v2.198.0'));
    expect(lines).toContain('  mailer_subjects_magic_link: set; prints code: true');
    expect(lines).toContain("  mailer_subjects_invite: empty (Auth's default); prints code: false");
    expect(lines.at(-1)).toBe('  3 template(s) print a code: configure-auth --templates-no-code --dry-run, then without --dry-run');
    expect(lines.join('\n')).not.toMatch(/SECRET|\{\{|Enter the code|reauthentication</);
    expect(m.templateLines(m.templateStates({ ...PROJECT, mailer_templates_reauthentication_content: '<p>Hi</p>', mailer_subjects_reauthentication: 'Hi' }, 'v2.198.0')).at(-1)).toBe('  No template prints a code.');
    expect(m.templateLines([])).toEqual(['  (no mailer_subjects_* or mailer_templates_*_content key in the answer)']);
  });
});

describe('withoutCode and codeFreeTemplate: the code goes, the links and the rest stay', () => {
  it("takes the code line out of every link email Auth sent before v2.190.0, and keeps the rest", () => {
    for (const t of LINK_TYPES) {
      const before = DEFAULTS.before_v2_190_0.bodies[t];
      const r = m.withoutCode(before);
      expect(r.error, t).toBeUndefined();
      expect(m.printsCode(r.text)).toBe(false);
      expect(r.text).toBe(before.replace(/\n<p>Alternatively, enter the code: \{\{ \.Token \}\}<\/p>/, ''));
      expect(linkCount(r.text as string, 'ConfirmationURL')).toBe(1);
    }
  });
  it('keeps a token-hash link, the site and the redirect, and every other element', () => {
    const r = m.withoutCode(CUSTOM.mailer_templates_magic_link_content);
    expect(r.text).toBe('<h2>SECRET-ML heading</h2>\n<p>SECRET-ML <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next={{ .RedirectTo }}">Sign in</a></p>\n');
    for (const v of ['SiteURL', 'TokenHash', 'RedirectTo']) expect(linkCount(r.text as string, v)).toBe(1);
  });
  it('takes out the innermost element, a line, or a <br> line, and each code there is', () => {
    expect(m.withoutCode('<div><p>Hi</p><p>Code: <b>{{.Token}}</b></p><a href="{{ .ConfirmationURL }}">Go</a></div>').text).toBe('<div><p>Hi</p><a href="{{ .ConfirmationURL }}">Go</a></div>');
    expect(m.withoutCode('Hi\nCode: {{ .Token }}\nGo to {{ .ConfirmationURL }}\n').text).toBe('Hi\nGo to {{ .ConfirmationURL }}\n');
    expect(m.withoutCode('Hi<br>Code: {{ .Token }}<br/>Go to {{ .ConfirmationURL }}').text).toBe('Hi<br>Go to {{ .ConfirmationURL }}');
    expect(m.withoutCode('<p>A {{ .Token }}</p>\n<ul><li>B {{ .TokenNew }}</li><li>C</li></ul>\n<p>D</p>').text).toBe('<ul><li>C</li></ul>\n<p>D</p>');
    expect(m.withoutCode('<P>A</P>\n<P class="x">{{ .Token }}</P>\n\n\n<p>B</p>').text).toBe('<P>A</P>\n\n<p>B</p>');
    expect(m.withoutCode('<p>A</p>\n{{ if .Token }}<p>Code {{ .Token }}</p>{{ end }}\n<p>B</p>').text).toBe('<p>A</p>\n<p>B</p>');
    expect(m.withoutCode('</p><p>A</p>\n<p>{{ .Token }}').text).toBe('</p><p>A</p>');
  });
  it('refuses, with a reason and never the text, when a link or the template would break', () => {
    expect(m.withoutCode('<p>Click <a href="{{ .ConfirmationURL }}">here</a> or use {{ .Token }}</p><p>Thanks</p>')).toEqual({ error: 'taking the code out would take a link out too' });
    expect(m.withoutCode('<p><a href="{{ .SiteURL }}/verify?code={{ .Token }}">Go</a></p><p>Hi</p>')).toEqual({ error: 'taking the code out would take a link out too' });
    expect(m.withoutCode('<p>Hi</p><p>Enter {{ .Token }} at {{ .SiteURL }}</p>')).toEqual({ error: 'taking the code out would take a link out too' });
    expect(m.withoutCode('<p>Your code: {{ .Token }}</p>')).toEqual({ error: 'nothing but the code would be left' });
    expect(m.withoutCode('{{ if .X }}<p>a</p>\n<p>Code {{ .Token }} {{ end }}</p>')).toEqual({ error: 'the block around the code holds an {{ end }} whose {{ if }}, {{ range }} or {{ with }} is outside it' });
    expect(m.withoutCode('<a href="{{ .ConfirmationURL }}"></a>\n<p>{{ .Token }}</p>').text).toBe('<a href="{{ .ConfirmationURL }}"></a>');
  });
  it('keeps the if/else/end structure: the depth never below zero, no {{ else }} at depth zero, back to zero at the end', () => {
    const outside = 'the block around the code holds an {{ else }} whose {{ if }}, {{ range }} or {{ with }} is outside it';
    expect(m.withoutCode('{{ if .A }}<p>x {{ else }} {{ .Token }}</p>{{ end }}<p>keep</p>')).toEqual({ error: outside });
    expect(m.withoutCode('{{ if .A }}<p>x {{- else if .B -}} {{ .Token }}</p>{{ end }}<p>keep</p>')).toEqual({ error: outside });
    expect(m.withoutCode('<div>{{ end }}{{ .Token }}{{ if .B }}</div>')).toEqual({ error: 'the block around the code holds an {{ end }} whose {{ if }}, {{ range }} or {{ with }} is outside it' });
    expect(m.withoutCode('<p>A</p><p>{{ .Token }} {{ range .Data }}</p>x{{ end }}')).toEqual({ error: 'the block around the code opens an {{ if }}, {{ range }} or {{ with }} whose {{ end }} is outside it' });
    expect(m.cutProblem('<p>{{ if .A }}a{{ else }}{{ .Token }}{{ end }}</p>')).toBeUndefined();
    expect(m.cutProblem('<p>{{/* {{ end }} */}}{{ .Token }}</p>')).toBeUndefined();
  });
  it('never takes a wrapper out with the code: another block element in the cut is refused', () => {
    const wrapper = 'taking the code out would take another block element out too';
    expect(m.withoutCode('<div><h2>T</h2>Your code {{ .Token }} and important words</div><p>More</p>')).toEqual({ error: wrapper });
    expect(m.withoutCode('<td><p>Intro</p>Code {{ .Token }}</td><p>More</p>')).toEqual({ error: wrapper });
    expect(m.withoutCode('<p>A</p><ul><li>B</li></ul> {{ .Token }}\n<p>More</p>')).toEqual({ error: wrapper });
    expect(m.withoutCode('<td>Code {{ .Token }} <p>{{ .TokenNew }}</p></td><p>More</p>').text).toBe('<p>More</p>');
  });
  it('takes the label just before the code out too, when it is only a label', () => {
    expect(m.withoutCode('<p>Sign in: <a href="{{ .ConfirmationURL }}">link</a></p>\n<p>Or enter this code:</p>\n<p>{{ .Token }}</p>').text).toBe('<p>Sign in: <a href="{{ .ConfirmationURL }}">link</a></p>');
    expect(m.withoutCode('<p>Hi</p><p>Or enter this CODE:</p><p><b>{{ .Token }}</b></p>').text).toBe('<p>Hi</p>');
    expect(m.withoutCode('Sign in: {{ .ConfirmationURL }}\nOr use this code:\n\n{{ .Token }}\n').text).toBe('Sign in: {{ .ConfirmationURL }}\n');
    // Not a label: it has a link, an action, more than one element, a tag on a plain line, or no "code:".
    expect(m.withoutCode('<p>Or <a href="{{ .ConfirmationURL }}">sign in</a>, or enter this code:</p>\n<p>{{ .Token }}</p>').text).toBe('<p>Or <a href="{{ .ConfirmationURL }}">sign in</a>, or enter this code:</p>');
    expect(m.withoutCode('<p>Hi {{ .Email }}, your code:</p><p>{{ .Token }}</p>').text).toBe('<p>Hi {{ .Email }}, your code:</p>');
    expect(m.withoutCode('<div><p>Intro</p><p>Your code:</p></div><p>{{ .Token }}</p>').text).toBe('<div><p>Intro</p><p>Your code:</p></div>');
    expect(m.withoutCode('Intro <b>x</b> code:\n{{ .Token }}').text).toBe('Intro <b>x</b> code:');
    expect(m.withoutCode('<p>Thanks</p>\n<p>{{ .Token }}</p>').text).toBe('<p>Thanks</p>');
    expect(m.withoutCode('Your code:<br>{{ .Token }}<br>Thanks').text).toBe('Your code:<br>Thanks');
  });
  it('gives reauthentication the plain email in the words of the hook, and other subjects their built-in subject', () => {
    expect(m.CODE_OFF_SENTENCE).toBe(CODE_ONLY_REFUSAL_MESSAGE);
    expect(m.codeFreeTemplate({ kind: 'subject', type: 'reauthentication', set: false }, null)).toEqual({ text: 'Email confirmation codes are off', how: 'default' });
    expect(m.codeFreeTemplate({ kind: 'content', type: 'reauthentication', set: true }, CUSTOM.mailer_templates_reauthentication_content)).toEqual({ text: '<p>Email confirmation codes are off. Sign out and back in, then make the change.</p>\n', how: 'replaced' });
    expect(m.codeFreeTemplate({ kind: 'subject', type: 'magic_link', set: true }, CUSTOM.mailer_subjects_magic_link)).toEqual({ text: 'Your sign-in link', how: 'replaced' });
    expect(m.codeFreeTemplate({ kind: 'subject', type: 'new_type', set: true }, '{{ .Token }}')).toEqual({ error: 'no code-free subject is known for this type' });
    expect(m.codeFreeTemplate({ kind: 'content', type: 'confirmation', set: false }, '')).toEqual({ text: DEFAULTS.since_v2_190_0.bodies.confirmation, how: 'default' });
    expect(m.codeFreeTemplate({ kind: 'content', type: 'password_changed_notification', set: false }, '')).toEqual({ error: 'no code-free body is known for this type' });
    expect(m.codeFreeTemplate({ kind: 'content', type: 'magic_link', set: true }, '<p>A</p><p>{{ .Token }}</p>')).toEqual({ text: '<p>A</p>', how: 'cut' });
    expect(m.codeFreeTemplate({ kind: 'content', type: 'magic_link', set: true }, '<p>{{ .Token }}</p>')).toEqual({ error: 'nothing but the code would be left' });
    for (const t of [m.CODE_OFF_SUBJECT, m.CODE_OFF_BODY]) expect(m.printsCode(t)).toBe(false);
  });
});

describe('templatesPatch: only the template keys that print a code', () => {
  it('sends the two reauthentication keys for an empty project on today\'s Auth, and nothing else', () => {
    const { patch, problems } = m.templatesPatch(PROJECT, 'v2.198.0');
    expect(problems).toEqual([]);
    expect(patch).toEqual({ mailer_subjects_reauthentication: m.CODE_OFF_SUBJECT, mailer_templates_reauthentication_content: m.CODE_OFF_BODY });
  });
  it('adds the five link bodies when Auth is older or its version unknown, every one code-free and with its link', () => {
    for (const v of ['v2.180.0', undefined]) {
      const { patch } = m.templatesPatch(PROJECT, v);
      for (const t of LINK_TYPES) expect(patch[`mailer_templates_${t}_content`]).toBe(m.AUTH_LINK_BODIES[t]);
      expect(Object.keys(patch)).toHaveLength(v ? 6 : 7);
    }
  });
  it('rewrites set templates, keeps their links, and leaves code-free ones and every other key alone', () => {
    const { patch, problems } = m.templatesPatch({ ...PROJECT, ...CUSTOM }, 'v2.198.0');
    expect(problems).toEqual([]);
    expect(Object.keys(patch).sort()).toEqual(['mailer_subjects_magic_link', 'mailer_templates_magic_link_content', 'mailer_templates_reauthentication_content']);
    for (const text of Object.values(patch)) expect(m.printsCode(text)).toBe(false);
    expect(linkCount(patch.mailer_templates_magic_link_content, 'TokenHash')).toBe(1);
    expect(Object.keys(patch).every((k) => m.TEMPLATE_KEY.test(k))).toBe(true);
  });
  it('sends nothing when no template prints a code', () => {
    const done = { ...PROJECT, mailer_subjects_reauthentication: m.CODE_OFF_SUBJECT, mailer_templates_reauthentication_content: m.CODE_OFF_BODY };
    expect(m.templatesPatch(done, 'v2.198.0')).toEqual({ patch: {}, changes: [], problems: [] });
  });
  it('counts, per key, the characters removed, kept and written', () => {
    const { changes } = m.templatesPatch({ ...PROJECT, ...CUSTOM, mailer_subjects_reauthentication: null }, 'v2.198.0');
    const ml = CUSTOM.mailer_templates_magic_link_content;
    const kept = (m.withoutCode(ml).text as string).length;
    expect(changes).toEqual([
      { key: 'mailer_subjects_magic_link', how: 'replaced', removed: CUSTOM.mailer_subjects_magic_link.length, kept: 0, written: 'Your sign-in link'.length },
      { key: 'mailer_templates_magic_link_content', how: 'cut', removed: ml.length - kept, kept, written: kept },
      { key: 'mailer_subjects_reauthentication', how: 'default', removed: 0, kept: 0, written: 32 },
      { key: 'mailer_templates_reauthentication_content', how: 'replaced', removed: CUSTOM.mailer_templates_reauthentication_content.length, kept: 0, written: 85 },
    ]);
    expect(changes.map((c) => m.changeLine(c))).toEqual([
      `  mailer_subjects_magic_link: prints code -> no code (replaced: ${CUSTOM.mailer_subjects_magic_link.length} characters removed, 0 kept, 17 written)`,
      `  mailer_templates_magic_link_content: prints code -> no code (cut: ${ml.length - kept} characters removed, ${kept} kept)`,
      "  mailer_subjects_reauthentication: prints code -> no code (empty, Auth's default: 32 characters written)",
      `  mailer_templates_reauthentication_content: prints code -> no code (replaced: ${CUSTOM.mailer_templates_reauthentication_content.length} characters removed, 0 kept, 85 written)`,
    ]);
  });
  it('lists the templates it cannot rewrite safely, by key and reason', () => {
    const bad = { ...PROJECT, mailer_templates_invite_content: '<p>Join with {{ .Token }} at <a href="{{ .ConfirmationURL }}">here</a></p>' };
    expect(m.templatesPatch(bad, 'v2.198.0').problems).toEqual([{ key: 'mailer_templates_invite_content', reason: 'taking the code out would take a link out too' }]);
  });
});

describe('configureAuthFlagProblem: only the flags configure-auth knows; --templates-no-code runs alone', () => {
  it('refuses a flag it does not know, a near miss above all, naming it', () => {
    const known = 'it takes --dry-run, --google, --email-rate=N, --otp-length=N or --templates-no-code';
    expect(m.configureAuthFlagProblem(['--template-no-code'])).toBe(`configure-auth does not know "--template-no-code"; ${known}`);
    for (const typo of ['--templates-no-codes', '--templates_no_code', '--no-code', '--dryrun', '--dry_run', '--Dry-run', '--otp_length=10', '--otp-lenght=10', '--email_rate=200', '--rate=200', '--googel', '--write', '--'])
      expect(m.configureAuthFlagProblem(['--dry-run', typo]), typo).toContain(`configure-auth does not know ${JSON.stringify(typo.split('=')[0])}`);
    expect(m.configureAuthFlagProblem(['--otp_length=10', '--templates-no-code', '--x=secret'])).toBe(`configure-auth does not know "--otp_length", "--x"; ${known}`);
  });
  it('refuses a value on a switch', () => {
    expect(m.configureAuthFlagProblem(['--google=yes'])).toBe('--google takes no value');
    expect(m.configureAuthFlagProblem(['--dry-run=false', '--otp-length=10'])).toBe('--dry-run takes no value');
  });
  it('lets every flag the workflow and the docs use through', () => {
    for (const set of [[], ['--dry-run'], ['--google'], ['--google', '--dry-run'], ['--email-rate=200'], ['--otp-length=10'], ['--otp-length=10', '--dry-run'], ['--otp-length=10', '--google', '--email-rate=200'], ['--templates-no-code'], ['--templates-no-code', '--dry-run'], ['--otp-length'], ['--email-rate']])
      expect(m.configureAuthFlagProblem(set), set.join(' ')).toBeUndefined();
    expect(m.CONFIGURE_AUTH_SWITCHES).toEqual(['--dry-run', '--google', '--templates-no-code']);
    expect(m.CONFIGURE_AUTH_VALUES).toEqual(['--email-rate', '--otp-length']);
  });
  it('allows it alone or with --dry-run, and leaves other runs to the other checks', () => {
    expect(m.configureAuthFlagProblem(['--templates-no-code'])).toBeUndefined();
    expect(m.configureAuthFlagProblem(['--dry-run', '--templates-no-code'])).toBeUndefined();
    expect(m.configureAuthFlagProblem(['--otp-length=10', '--google'])).toBeUndefined();
    expect(m.configureAuthFlagProblem([])).toBeUndefined();
  });
  it('refuses it with --otp-length, --google, --email-rate or a value, naming flags but no values', () => {
    const alone = '--templates-no-code runs alone (with --dry-run at most), not with';
    expect(m.configureAuthFlagProblem(['--templates-no-code', '--otp-length=10'])).toBe(`${alone} --otp-length: run --otp-length, --google or --email-rate in a run of its own`);
    expect(m.configureAuthFlagProblem(['--templates-no-code', '--google', '--email-rate=200', '--dry-run'])).toBe(`${alone} --google, --email-rate: run --otp-length, --google or --email-rate in a run of its own`);
    expect(m.configureAuthFlagProblem(['--templates-no-code', '--otp-length'])).toContain('not with --otp-length:');
    expect(m.configureAuthFlagProblem(['--templates-no-code=yes'])).toBe('--templates-no-code takes no value');
  });
});

describe('configure-auth --templates-no-code and inspect, run as the workflow runs them (fake Management API)', () => {
  // A child process with the workflow's env (fake values) and a fetch that
  // answers from memory and logs every call: no network. The PATCH body is
  // what Supabase would receive.
  const ADMIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'supabase-admin.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-templates-'));
  const mock = path.join(dir, 'fake-api.mjs');
  fs.writeFileSync(
    mock,
    `import fs from 'node:fs';
const state = JSON.parse(process.env.FAKE_AUTH_CONFIG);
const base = '/v1/projects/abcdefghijklmnopqrst';
globalThis.fetch = async (url, init = {}) => {
  const method = init.method || 'GET';
  const u = new URL(String(url));
  fs.appendFileSync(process.env.FAKE_CALL_LOG, JSON.stringify({ method, path: u.pathname + u.search, body: init.body ?? null }) + '\\n');
  const json = (v) => new Response(JSON.stringify(v), { status: 200 });
  if (u.origin !== 'https://api.supabase.com') return new Response('not in the fake', { status: 599 });
  if (u.pathname === base + '/config/auth') {
    if (method === 'GET') return json(state);
    if (method === 'PATCH') { if (!process.env.FAKE_IGNORE_PATCH) Object.assign(state, JSON.parse(init.body)); return json({}); }
  }
  if (u.pathname === base + '/health' && method === 'GET') {
    if (!process.env.FAKE_AUTH_VERSION) return new Response('{"message":"unavailable"}', { status: 503 });
    return json([{ name: 'auth', healthy: true, status: 'ACTIVE_HEALTHY', info: { name: 'GoTrue', version: process.env.FAKE_AUTH_VERSION, description: 'GoTrue' } }]);
  }
  if (method === 'GET' && u.pathname === base) return json({ name: 'hintwise', region: 'us-west-1', status: 'ACTIVE_HEALTHY' });
  if (method === 'GET' && u.pathname === base + '/postgrest') return json({ db_schema: 'public,platform', jwt_secret: 'jwt-secret-value' });
  if (u.pathname === base + '/database/query' || u.pathname === base + '/functions' || u.pathname === base + '/secrets') return json([]);
  return new Response('not in the fake', { status: 599 });
};
`,
  );
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  let n = 0;
  const run = (args: string[], config: Record<string, unknown> = PROJECT, extra: Record<string, string> = { FAKE_AUTH_VERSION: 'v2.198.0' }) => {
    const log = path.join(dir, `calls-${n++}.jsonl`);
    const r = spawnSync(process.execPath, ['--import', pathToFileURL(mock).href, ADMIN, ...args], {
      encoding: 'utf8',
      // The workflow's "Run" step env, with fake values (supabase-admin.yml).
      env: {
        SUPABASE_ACCESS_TOKEN: 'sbp_fake',
        SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
        RESEND_API: 're_live_key',
        HINTWISE_AUTH_GOOGLE_ID: '985338662899-new',
        HINTWISE_AUTH_GOOGLE_SECRET: 'google-secret',
        CLOUDFLARE_API_TOKEN: 'cf_fake',
        CLOUDFLARE_ZONE_ID: 'zone_fake',
        FAKE_AUTH_CONFIG: JSON.stringify(config),
        FAKE_CALL_LOG: log,
        ...extra,
      },
    });
    const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { method: string; path: string; body: string | null }) : [];
    return { status: r.status, out: r.stdout, err: r.stderr, calls };
  };
  const SECRETS = ['re_live_key', PROJECT.smtp_pass, PROJECT.external_google_secret, 'google-secret', 'sbp_fake', 'cf_fake', 'jwt-secret-value'];
  const noLeak = ({ out, err }: { out: string; err: string }) => {
    for (const s of SECRETS) expect(out + err).not.toContain(s);
    expect(out + err).not.toMatch(/SECRET-|\{\{ ?\.|Enter the code|Email confirmation codes are off\.|is your verification code/);
  };

  it('dry run: GETs only, and lists each key as "prints code -> no code"', () => {
    const r = run(['configure-auth', '--templates-no-code', '--dry-run']);
    expect(r.status).toBe(0);
    expect(r.calls.map((c) => c.method)).toEqual(['GET', 'GET']);
    expect(r.calls.map((c) => c.path)).toEqual(['/v1/projects/abcdefghijklmnopqrst/health?services=auth', '/v1/projects/abcdefghijklmnopqrst/config/auth']);
    expect(r.out.split('\n').filter(Boolean)).toEqual([
      '--templates-no-code: only the Auth email templates that print a code are sent; every other auth setting is left as it is.',
      "Auth v2.198.0: of Auth's built-in templates, only reauthentication's subject and body print the code.",
      'Would change 2 key(s):',
      "  mailer_subjects_reauthentication: prints code -> no code (empty, Auth's default: 32 characters written)",
      "  mailer_templates_reauthentication_content: prints code -> no code (empty, Auth's default: 85 characters written)",
      'Dry run: nothing sent.',
    ]);
    noLeak(r);
  });
  it('PATCHes exactly the template keys that print a code, with RESEND_API set and smtp_pass a digest', () => {
    const r = run(['configure-auth', '--templates-no-code'], { ...PROJECT, ...CUSTOM });
    expect(r.status).toBe(0);
    expect(r.calls.map((c) => c.method)).toEqual(['GET', 'GET', 'PATCH', 'GET']);
    const body = JSON.parse(r.calls[2].body as string) as Record<string, string>;
    expect(Object.keys(body).sort()).toEqual(['mailer_subjects_magic_link', 'mailer_templates_magic_link_content', 'mailer_templates_reauthentication_content']);
    expect(body).not.toHaveProperty('smtp_pass');
    for (const text of Object.values(body)) expect(m.printsCode(text)).toBe(false);
    expect(body.mailer_templates_magic_link_content).toContain('token_hash={{ .TokenHash }}');
    expect(r.out).toContain(`Changing 3 key(s):\n  mailer_subjects_magic_link: prints code -> no code (replaced: ${CUSTOM.mailer_subjects_magic_link.length} characters removed, 0 kept, 17 written)\n`);
    expect(r.out).toMatch(/\n {2}mailer_templates_magic_link_content: prints code -> no code \(cut: \d+ characters removed, \d+ kept\)\n/);
    expect(r.out).toContain('After: mailer_subjects_magic_link set, prints code: false; mailer_templates_magic_link_content set, prints code: false; mailer_templates_reauthentication_content set, prints code: false');
    noLeak(r);
  });
  it('sends nothing when no template prints a code', () => {
    const done = { ...PROJECT, mailer_subjects_reauthentication: m.CODE_OFF_SUBJECT, mailer_templates_reauthentication_content: m.CODE_OFF_BODY };
    const r = run(['configure-auth', '--templates-no-code'], done);
    expect(r.status).toBe(0);
    expect(r.calls.map((c) => c.method)).toEqual(['GET', 'GET']);
    expect(r.out).toContain('No Auth email template prints a code; nothing to change.');
  });
  it('counts both versions of the defaults in the dry run when the version cannot be read', () => {
    const r = run(['configure-auth', '--templates-no-code', '--dry-run'], PROJECT, {});
    expect(r.status).toBe(0);
    expect(r.out).toContain("Auth's version cannot be read");
    expect(r.out).toContain('Would change 7 key(s):');
    expect(r.calls.map((c) => c.method)).toEqual(['GET', 'GET']);
    const rc = run(['configure-auth', '--templates-no-code', '--dry-run'], PROJECT, { FAKE_AUTH_VERSION: '2.190.0-rc.4' });
    expect(rc.status).toBe(0);
    expect(rc.out).toContain('Auth v2.190.0-rc.4 is a pre-release of v2.190.0');
    expect(rc.out).toContain('Would change 7 key(s):');
  });
  it('the real run sends nothing, and exits 1, when the version is not known', () => {
    for (const extra of [{}, { FAKE_AUTH_VERSION: 'v2.190.0-rc.4' }, { FAKE_AUTH_VERSION: 'GoTrue' }] as Record<string, string>[]) {
      const r = run(['configure-auth', '--templates-no-code'], PROJECT, extra);
      expect(r.status).toBe(1);
      expect(r.calls.map((c) => c.path)).toEqual(['/v1/projects/abcdefghijklmnopqrst/health?services=auth']);
      expect(r.out).toContain("::error::--templates-no-code: nothing sent: Auth's version is not known; run it again once the version line names a release");
      expect(r.out).not.toContain('Changing');
    }
  });
  it('refuses a flag configure-auth does not know before any API call, whatever else is given', () => {
    for (const flags of [['--template-no-code'], ['--template-no-code', '--dry-run'], ['--dryrun'], ['--otp_length=10'], ['--google=yes'], ['--templates-no-code', '--dryrun']]) {
      const r = run(['configure-auth', ...flags]);
      expect(r.status, flags.join(' ')).toBe(1);
      expect(r.calls).toEqual([]);
      expect(r.out).toMatch(/^::error::(configure-auth does not know|--google takes no value)/m);
      expect(r.out).not.toContain('smtp');
    }
    const bare = run(['configure-auth', '--email-rate']);
    expect(bare.status).toBe(1);
    expect(bare.calls).toEqual([]);
    expect(bare.out).toContain('::error::--email-rate wants a whole number of emails an hour, got (nothing)');
  });
  it('refuses bad combinations before any API call', () => {
    for (const flags of [['--otp-length=10'], ['--google'], ['--email-rate=200'], ['--otp-length=10', '--dry-run']]) {
      const r = run(['configure-auth', '--templates-no-code', ...flags]);
      expect(r.status, flags.join(' ')).toBe(1);
      expect(r.calls).toEqual([]);
      expect(r.out).toContain('::error::--templates-no-code runs alone (with --dry-run at most), not with');
    }
    const v = run(['configure-auth', '--templates-no-code=1']);
    expect(v.status).toBe(1);
    expect(v.calls).toEqual([]);
  });
  it('sends nothing, and exits 1, when a template cannot be rewritten safely', () => {
    const bad = { ...PROJECT, mailer_templates_invite_content: '<p>SECRET-IN Join with {{ .Token }} at <a href="{{ .ConfirmationURL }}">here</a></p>' };
    const r = run(['configure-auth', '--templates-no-code'], bad);
    expect(r.status).toBe(1);
    expect(r.calls.map((c) => c.method)).toEqual(['GET', 'GET']);
    expect(r.out).toContain("Would change 2 key(s):\n  mailer_subjects_reauthentication: prints code -> no code (empty, Auth's default: 32 characters written)");
    expect(r.out).toContain('  mailer_templates_invite_content: prints code -> taking the code out would take a link out too');
    expect(r.out).toContain('::error::--templates-no-code: nothing sent; mailer_templates_invite_content cannot be rewritten safely');
    noLeak(r);
  });
  it('exits 1 when Auth still answers a template that prints the code after the PATCH', () => {
    const r = run(['configure-auth', '--templates-no-code'], PROJECT, { FAKE_AUTH_VERSION: 'v2.198.0', FAKE_IGNORE_PATCH: '1' });
    expect(r.status).toBe(1);
    expect(r.out).toContain('::error::--templates-no-code: after the PATCH, mailer_subjects_reauthentication, mailer_templates_reauthentication_content still print a code or did not change');
  });
  it('leaves --otp-length alone exactly as it was', () => {
    const r = run(['configure-auth', '--otp-length=10', '--dry-run'], { ...PROJECT, mailer_otp_length: 6 });
    expect(r.status).toBe(0);
    expect(r.calls.map((c) => c.path)).toEqual(['/v1/projects/abcdefghijklmnopqrst/config/auth']);
    expect(r.out).not.toContain('template');
  });
  it('inspect lists every template, set or empty and prints code or not, never the text', () => {
    const r = run(['inspect'], { ...PROJECT, ...CUSTOM });
    expect(r.status).toBe(0);
    const at = r.out.indexOf("Auth email templates (set or empty, and whether each prints Auth's code; never the text):");
    expect(at).toBeGreaterThan(0);
    const section = r.out.slice(at).split('\n\n')[0].split('\n');
    expect(section[1]).toBe("  Auth v2.198.0: of Auth's built-in templates, only reauthentication's subject and body print the code.");
    expect(section.filter((l) => /^ {2}mailer_/.test(l))).toHaveLength(26);
    expect(section).toContain('  mailer_templates_reauthentication_content: set; prints code: true');
    expect(section).toContain("  mailer_subjects_invite: empty (Auth's default); prints code: false");
    expect(section.at(-1)).toBe('  3 template(s) print a code: configure-auth --templates-no-code --dry-run, then without --dry-run');
    expect(r.out).toContain('security_update_password_require_reauthentication: false');
    expect(r.calls.every((c) => c.method === 'GET' || c.path.endsWith('/database/query'))).toBe(true);
    noLeak(r);
  });
});
