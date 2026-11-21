/** Builds zips for tests, including the hostile ones a real zip tool would not make. */
import { crc32, deflateRawSync } from 'node:zlib';

export interface RawEntry {
  name: string;
  data?: string | Uint8Array;
  method?: 0 | 8;
  /** Overrides the uncompressed size written in the headers. */
  declaredSize?: number;
  symlink?: boolean;
  encrypted?: boolean;
  /** Overrides the method number written (for unsupported methods). */
  methodNumber?: number;
}

export function makeZip(entries: RawEntry[]): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const raw = typeof e.data === 'string' ? Buffer.from(e.data) : Buffer.from(e.data ?? new Uint8Array(0));
    const method = e.method ?? 0;
    const body = method === 8 ? deflateRawSync(raw) : raw;
    const name = Buffer.from(e.name);
    const size = e.declaredSize ?? raw.length;
    const crc = crc32(raw);
    const flags = e.encrypted ? 1 : 0;
    const methodNumber = e.methodNumber ?? method;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(methodNumber, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // made by Unix
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(methodNumber, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    const mode = e.symlink ? 0o120777 : e.name.endsWith('/') ? 0o40755 : 0o100644;
    central.writeUInt32LE((mode << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}
