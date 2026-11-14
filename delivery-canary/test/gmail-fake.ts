/**
 * A scripted IMAP server that answers like Gmail's (responses recorded from
 * Gmail's documented formats: special-use LIST flags, X-GM-RAW search,
 * X-GM-LABELS and BODY[]<0> literals). Tests hand its socket to the client.
 */
import { Duplex } from 'node:stream';

export interface FakeMessage {
  uid: number;
  box: 'all' | 'spam';
  date: string; // INTERNALDATE text
  labels: string; // the X-GM-LABELS list as Gmail writes it, e.g. '("\\\\Inbox" "Shop tests")'
  raw: string;
  /** RFC822.SIZE to report; defaults to the raw length. */
  size?: number;
  categories?: string[];
}

export interface FakeOptions {
  messages?: FakeMessage[];
  greeting?: string;
  /** The tagged answer to LOGIN; default success. */
  login?: string;
  /** LIST lines; default Gmail's English folders. */
  list?: string[];
  /** Overrides: return a response (TAG is replaced by the command's tag), or null for no answer at all. */
  override?: (cmd: string) => string | null | undefined;
  /** Split every reply into chunks of this many bytes (tests reassembly). */
  chunk?: number;
}

export const GMAIL_LIST = [
  '* LIST (\\HasNoChildren) "/" "INBOX"',
  '* LIST (\\HasChildren \\Noselect) "/" "[Gmail]"',
  '* LIST (\\All \\HasNoChildren) "/" "[Gmail]/All Mail"',
  '* LIST (\\Drafts \\HasNoChildren) "/" "[Gmail]/Drafts"',
  '* LIST (\\HasNoChildren \\Important) "/" "[Gmail]/Important"',
  '* LIST (\\HasNoChildren \\Sent) "/" "[Gmail]/Sent Mail"',
  '* LIST (\\HasNoChildren \\Junk) "/" "[Gmail]/Spam"',
  '* LIST (\\Flagged \\HasNoChildren) "/" "[Gmail]/Starred"',
  '* LIST (\\HasNoChildren \\Trash) "/" "[Gmail]/Trash"',
];

export function fakeGmail(opts: FakeOptions = {}): { socket: Duplex; sent: string[] } {
  const sent: string[] = [];
  const messages = opts.messages ?? [];
  let box: 'all' | 'spam' | '' = '';
  let pending = '';
  const socket: Duplex = new Duplex({
    read() {},
    write(chunk: Buffer, _enc, cb) {
      pending += chunk.toString('latin1');
      let end: number;
      while ((end = pending.indexOf('\r\n')) >= 0) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 2);
        const sp = line.indexOf(' ');
        const tag = line.slice(0, sp);
        const cmd = line.slice(sp + 1);
        sent.push(cmd);
        const reply = answer(cmd);
        if (reply !== null) send(reply.replace(/TAG/g, tag));
      }
      cb();
    },
  });
  const send = (text: string) => {
    const bytes = Buffer.from(text, 'latin1');
    const size = opts.chunk ?? bytes.length;
    setImmediate(() => {
      for (let i = 0; i < bytes.length; i += size) socket.push(bytes.subarray(i, i + size));
    });
  };
  const inBox = () => messages.filter((m) => m.box === box);

  function answer(cmd: string): string | null {
    const o = opts.override?.(cmd);
    if (o !== undefined) return o;
    if (cmd.startsWith('LOGIN ')) return opts.login ?? '* CAPABILITY IMAP4rev1 UNSELECT IDLE NAMESPACE QUOTA ID XLIST CHILDREN X-GM-EXT-1 UIDPLUS ENABLE MOVE CONDSTORE ESEARCH UTF8=ACCEPT LIST-EXTENDED LIST-STATUS LITERAL- SPECIAL-USE\r\nTAG OK canary@gmail.com authenticated (Success)\r\n';
    if (cmd === 'LIST "" "*"') return `${(opts.list ?? GMAIL_LIST).join('\r\n')}\r\nTAG OK Success\r\n`;
    if (cmd.startsWith('EXAMINE ')) {
      box = /Spam/.test(cmd) ? 'spam' : 'all';
      const n = inBox().length;
      return `* FLAGS (\\Answered \\Flagged \\Draft \\Deleted \\Seen $NotPhishing $Phishing)\r\n* OK [PERMANENTFLAGS ()] Flags permitted.\r\n* OK [UIDVALIDITY 11] UIDs valid.\r\n* ${n} EXISTS\r\n* 0 RECENT\r\n* OK [UIDNEXT 900] Predicted next UID.\r\nTAG OK [READ-ONLY] ${cmd.slice(8)} selected. (Success)\r\n`;
    }
    let m = /^UID SEARCH UID (\d+) X-GM-RAW "category:(\w+)"$/.exec(cmd);
    if (m) {
      const uid = Number(m[1]);
      const hit = inBox().find((x) => x.uid === uid && (x.categories ?? []).includes(m![2]));
      return `* SEARCH${hit ? ` ${uid}` : ''}\r\nTAG OK SEARCH completed (Success)\r\n`;
    }
    if (cmd.startsWith('UID SEARCH X-GM-RAW ')) return `* SEARCH${inBox().map((x) => ` ${x.uid}`).join('')}\r\nTAG OK SEARCH completed (Success)\r\n`;
    m = /^UID FETCH (\d+) \(UID INTERNALDATE\)$/.exec(cmd);
    if (m) {
      const x = inBox().find((y) => y.uid === Number(m![1]));
      return `${x ? `* 3 FETCH (UID ${x.uid} INTERNALDATE "${x.date}")\r\n` : ''}TAG OK Success\r\n`;
    }
    m = /^UID FETCH (\d+) \(UID INTERNALDATE RFC822\.SIZE X-GM-LABELS BODY\.PEEK\[\]<0\.(\d+)>\)$/.exec(cmd);
    if (m) {
      const x = inBox().find((y) => y.uid === Number(m![1]));
      if (!x) return 'TAG OK Success\r\n';
      const body = Buffer.from(x.raw, 'utf8').subarray(0, Number(m[2])).toString('latin1');
      return `* 3 FETCH (X-GM-LABELS ${x.labels} UID ${x.uid} INTERNALDATE "${x.date}" RFC822.SIZE ${x.size ?? Buffer.byteLength(x.raw)} BODY[]<0> {${Buffer.byteLength(body, 'latin1')}}\r\n${body})\r\nTAG OK Success\r\n`;
    }
    if (cmd === 'LOGOUT') return '* BYE LOGOUT Requested\r\nTAG OK 73 good day (Success)\r\n';
    return 'TAG BAD Unknown command\r\n';
  }

  send(opts.greeting ?? '* OK Gimap ready for requests from 203.0.113.5 a1b2c3\r\n');
  return { socket, sent };
}
