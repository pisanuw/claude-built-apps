/** Sending one email through the Resend API (key: function secret RESEND_API). */

export const RESEND_URL = 'https://api.resend.com/emails';

export interface EmailMessage {
  from: string;
  to: string[];
  /** Resend's reply_to: where a reply goes (support@hintwise.org on every email). */
  reply_to?: string;
  subject: string;
  text: string;
  html: string;
}

export type SendResult = { ok: true; id: string } | { ok: false; status: number; message: string };

export async function sendEmail(fetchFn: typeof fetch, apiKey: string, msg: EmailMessage): Promise<SendResult> {
  let res: Response;
  try {
    res = await fetchFn(RESEND_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(msg),
    });
  } catch (e) {
    return { ok: false, status: 0, message: `Resend unreachable: ${String((e as Error)?.message ?? e).slice(0, 200)}` };
  }
  const text = await res.text().catch(() => '');
  if (!res.ok) return { ok: false, status: res.status, message: `Resend ${res.status}: ${text.slice(0, 200)}` };
  try {
    const id = (JSON.parse(text) as { id?: unknown }).id;
    return { ok: true, id: typeof id === 'string' ? id : '' };
  } catch {
    return { ok: true, id: '' };
  }
}
