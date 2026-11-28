/**
 * Writes test/fixtures/veraPDF.json (AC-3): each fixture's veraPDF result,
 * from the veraPDF the hub's image carries (1.30.4), run with the checker's
 * Java flags when the fixture is first made. The fixture's sha256 is kept with
 * its result, so a change to the generator fails test/fixtures.test.ts until
 * veraPDF has been run on the new bytes.
 *
 * Run inside the spike image (heard-as-check-worker/spike/README.md), or with
 * any veraPDF 1.30.4:  VERAPDF='<command>' node test/fixtures/verapdf.ts [names...]
 * An existing entry is kept unless its fixture is named or its bytes changed.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURES, generateAll, OUT_DIR } from './generate.ts';

export interface VeraEntry {
  sha256: string;
  bytes: number;
  pages: number;
  mustPass: boolean;
  profile: string;
  verapdf: string;
  compliant: boolean;
  failedRules: number;
  failedClauses: string[];
  /** Why veraPDF gave no validation result (password.pdf: an encrypted file is not validated). */
  note?: string;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(HERE, 'veraPDF.json');

interface Report {
  report: {
    buildInformation: { releaseDetails: { id: string; version: string }[] };
    jobs: { validationResult?: VR | VR[]; taskException?: { exceptionMessage?: string } }[];
  };
}
interface VR {
  compliant: boolean;
  profileName: string;
  details: { failedRules: number; ruleSummaries: { clause: string; testNumber: number }[] };
}

const command = (process.env.VERAPDF ?? '/opt/verapdf/verapdf').split(' ');
const only = process.argv.slice(2);
const known: Record<string, VeraEntry> = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
const out: Record<string, VeraEntry> = {};
for (const m of generateAll(OUT_DIR)) {
  const f = FIXTURES.find((x) => x.name === m.name)!;
  const old = known[m.name];
  if (old && old.sha256 === m.sha256 && !only.includes(m.name)) {
    out[m.name] = { ...old, mustPass: f.mustPass };
    continue;
  }
  let raw: string;
  try {
    raw = execFileSync(command[0], [...command.slice(1), '--flavour', 'ua1', '--format', 'json', m.file], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) {
    // veraPDF exits 1 when the file is not compliant; its report is still on stdout.
    raw = (e as { stdout?: string }).stdout ?? '';
  }
  let report: Report;
  try {
    report = JSON.parse(raw) as Report;
  } catch {
    // deep-tree.pdf: veraPDF overflows its stack (-Xss512k) on the 100,000-deep tree and its report is cut off.
    out[m.name] = { sha256: m.sha256, bytes: m.bytes, pages: m.pages, mustPass: f.mustPass, profile: 'PDF/UA-1', verapdf: '1.30.4', compliant: false, failedRules: 0, failedClauses: [], note: 'no report: veraPDF stopped before its report ended' };
    console.log(`${m.name}\tno report`);
    continue;
  }
  const vr = [report.report.jobs[0].validationResult].flat()[0];
  const core = report.report.buildInformation.releaseDetails.find((r) => r.id === 'core');
  if (!vr) {
    // No result: veraPDF does not validate an encrypted file (password.pdf), and runs out of its 192 MB heap on many-glyphs.pdf.
    const ex = report.report.jobs[0].taskException?.exceptionMessage;
    const note = ex ? `not validated: ${ex.slice(0, 160)}` : 'not validated: veraPDF does not validate an encrypted file';
    out[m.name] = { sha256: m.sha256, bytes: m.bytes, pages: m.pages, mustPass: f.mustPass, profile: 'PDF/UA-1', verapdf: core?.version ?? 'unknown', compliant: false, failedRules: 0, failedClauses: [], note };
    console.log(`${m.name}\tnot validated`);
    continue;
  }
  out[m.name] = {
    sha256: m.sha256,
    bytes: m.bytes,
    pages: m.pages,
    mustPass: f.mustPass,
    profile: vr.profileName.replace(/ validation profile$/, ''),
    verapdf: core?.version ?? 'unknown',
    compliant: vr.compliant,
    failedRules: vr.details.failedRules,
    failedClauses: [...new Set(vr.details.ruleSummaries.map((r) => `${r.clause}-${r.testNumber}`))].sort(),
  };
  console.log(`${m.name}\t${vr.compliant ? 'compliant' : 'not compliant'}\t${out[m.name].failedClauses.join(' ')}`);
}
fs.writeFileSync(FILE, `${JSON.stringify(out, null, 2)}\n`);
