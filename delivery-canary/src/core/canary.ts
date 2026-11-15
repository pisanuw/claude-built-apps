/**
 * Canary orders (milestone 4), shared by the server and the page: the
 * variant ID a shop owner pastes, when the page looks for the canary's
 * email, and how a canary's outcome reads.
 */
export const VARIANT_RE = /^gid:\/\/shopify\/ProductVariant\/[0-9]{1,20}$/;

/** A variant ID from what was pasted: the gid, the number, or an admin URL ending /variants/<n>. '' otherwise. */
export function variantId(input: string): string {
  const s = input.trim();
  if (VARIANT_RE.test(s)) return s;
  const m = /^(?:https?:\/\/\S+\/variants\/)?([0-9]{1,20})(?:[/?#]\S*)?$/.exec(s);
  return m ? `gid://shopify/ProductVariant/${m[1]}` : '';
}

/**
 * Seconds after the order when the page looks in the seed inbox: six looks
 * over nine minutes (the seed check allows 12 an hour), soon at first since
 * most delivery emails arrive within a minute or two.
 */
export const WAIT_SCHEDULE_S = [45, 90, 150, 240, 360, 540] as const;

/** "1 min 42 s", "38 s", "2 h 5 min". */
export function transitText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}`;
  const m = Math.round(s / 60);
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
}

/** A transit time worth a warning: buyers start writing in after about five minutes. */
export const SLOW_TRANSIT_S = 300;
