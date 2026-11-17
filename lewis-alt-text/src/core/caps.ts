/**
 * Plain words for a reached spending cap of the HintWise key
 * (docs/new-app-guide.md, "What the app shows on a 429"). No imports, so the
 * page and the command-line tool share it.
 */

/** Local time, with the weekday when it is not today. */
export function formatReset(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'later';
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === now.toDateString() ? time : `${d.toLocaleDateString([], { weekday: 'long' })} ${time}`;
}

export function capMessage(scope: string, resetsAt: string | null | undefined, format: (iso: string) => string = formatReset): string {
  let what: string;
  if (scope === 'user-day') what = 'Your daily HintWise allowance is used up.';
  else if (scope.startsWith('app-user-week')) what = 'Your weekly allowance in this app is used up.';
  else if (scope.startsWith('app-user')) what = 'Your daily allowance in this app is used up.';
  else what = "This app's shared allowance is used up.";
  const when = resetsAt ? ` It renews at ${format(resetsAt)}.` : '';
  return `${what}${when} You can use your own Anthropic key in the meantime.`;
}
