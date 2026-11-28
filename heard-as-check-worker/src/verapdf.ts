/**
 * veraPDF for the job (AC-12, AC-14, AC-15): run after Chromium has ended, as
 * the job user, with the checker's Java flags (a capped heap and metaspace,
 * and every connection sent to a closed port, loopback included), its temp
 * folder in the job, and the profile the file declares.
 */

/** No connection from Java reaches anything (the checker's JAVA_NO_NETWORK, tagging-doctor-worker/src/runner.ts). */
export const JAVA_NO_NETWORK = [
  '-Djava.net.useSystemProxies=false',
  '-Dhttp.nonProxyHosts=',
  '-DsocksNonProxyHosts=',
  '-Dftp.nonProxyHosts=',
  '-Dhttp.proxyHost=127.0.0.1',
  '-Dhttp.proxyPort=9',
  '-Dhttps.proxyHost=127.0.0.1',
  '-Dhttps.proxyPort=9',
  '-DsocksProxyHost=127.0.0.1',
  '-DsocksProxyPort=9',
];

/** The checker's heap and metaspace caps (the same numbers the spike measured, D-13). */
export const JAVA_FLAGS = [
  '-Xmx192m',
  '-Xss512k',
  '-XX:MaxMetaspaceSize=96m',
  '-XX:ReservedCodeCacheSize=32m',
  '-XX:+UseSerialGC',
  '-XX:TieredStopAtLevel=1',
  '-XX:-UsePerfData',
];

/** PDF/UA-1 or PDF/UA-2 as the file declares through `pdfuaid:part`; PDF/UA-1 when it declares none (AC-51). */
export function flavour(declared: number | null): 'ua1' | 'ua2' {
  return declared === 2 ? 'ua2' : 'ua1';
}

/** veraPDF's command line (no shell). Pure. */
export function verapdfArgs(pdf: string, tmp: string, home: string, verapdfHome: string, declared: number | null): string[] {
  return [
    'java',
    ...JAVA_FLAGS,
    ...JAVA_NO_NETWORK,
    `-Djava.io.tmpdir=${tmp}`,
    `-Duser.home=${home}`,
    '-Dfile.encoding=UTF8',
    '-classpath',
    `${verapdfHome}/bin/*`,
    '--add-exports=java.base/sun.security.pkcs=ALL-UNNAMED',
    'org.verapdf.apps.GreenfieldCliWrapper',
    '--flavour',
    flavour(declared),
    '--format',
    'json',
    '--maxfailuresdisplayed',
    '1',
    pdf,
  ];
}

export interface Clause {
  specification: string;
  clause: string;
  testNumber: number;
  failedChecks: number;
  description: string;
}

export interface Validation {
  profile: string;
  version: string;
  compliant: boolean;
  failedRules: number;
  /** The 10 most frequent failed clauses (AC-51). */
  clauses: Clause[];
  /** False when the file declares no PDF/UA part, so PDF/UA-1 was used (AC-51's sentence is the page's, M5). */
  declared: boolean;
}

interface Report {
  report?: {
    buildInformation?: { releaseDetails?: { id?: string; version?: string }[] };
    jobs?: {
      validationResult?:
        | { profileName?: string; compliant?: boolean; details?: { failedRules?: number; ruleSummaries?: Record<string, unknown>[] } }
        | { profileName?: string; compliant?: boolean; details?: { failedRules?: number; ruleSummaries?: Record<string, unknown>[] } }[];
    }[];
  };
}

/** Reads veraPDF's JSON report; null when there is none (veraPDF failed). Pure. */
export function parseReport(json: string, declared: number | null, top = 10): Validation | null {
  let data: Report;
  try {
    data = JSON.parse(json) as Report;
  } catch {
    return null;
  }
  const vr = data.report?.jobs?.[0]?.validationResult;
  const result = Array.isArray(vr) ? vr[0] : vr;
  if (!result || typeof result.compliant !== 'boolean') return null;
  const details = result.details ?? {};
  const version = data.report?.buildInformation?.releaseDetails?.find((r) => r.id === 'core')?.version ?? 'unknown';
  const clauses = (details.ruleSummaries ?? [])
    .map((r) => ({
      specification: String(r.specification ?? ''),
      clause: String(r.clause ?? ''),
      testNumber: Number(r.testNumber ?? 0),
      failedChecks: Number(r.failedChecks ?? 0),
      description: String(r.description ?? '').slice(0, 300),
    }))
    .sort((a, b) => b.failedChecks - a.failedChecks)
    .slice(0, top);
  return {
    profile: String(result.profileName ?? 'unknown').slice(0, 200),
    version: `veraPDF ${version}`.slice(0, 60),
    compliant: result.compliant,
    failedRules: Number(details.failedRules ?? 0),
    clauses,
    declared: declared === 1 || declared === 2,
  };
}
