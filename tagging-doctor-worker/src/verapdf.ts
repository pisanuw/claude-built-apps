/** Reads veraPDF's JSON report (`--format json`) into the job's result (pure). */

export interface Clause {
  specification: string;
  clause: string;
  testNumber: number;
  failedChecks: number;
  description: string;
}

export interface Validation {
  profile: string;
  verapdfVersion: string;
  compliant: boolean;
  failedRules: number;
  failedChecks: number;
  /**
   * Every rule that failed, the most failed checks first, up to MAX_RULES
   * (R4a.1-8 a: the compare needs whole lists to say "fixed" or "new"; the
   * page shows the 20 most frequent, AC-30). `failedRules` above tells a
   * list that was cut.
   */
  clauses: Clause[];
}

interface Report {
  report?: {
    buildInformation?: { releaseDetails?: { id?: string; version?: string }[] };
    jobs?: {
      validationResult?: {
        profileName?: string;
        compliant?: boolean;
        details?: {
          failedRules?: number;
          failedChecks?: number;
          ruleSummaries?: { specification?: string; clause?: string; testNumber?: number; failedChecks?: number; description?: string }[];
        };
      }[];
    }[];
  };
}

/** A bound on the rules sent, far above what one PDF/UA-2 report holds, so a job's answer stays small (each description is cut at 500 characters). */
export const MAX_RULES = 200;

export function parseReport(json: string, top = MAX_RULES): Validation | null {
  let data: Report;
  try {
    data = JSON.parse(json) as Report;
  } catch {
    return null;
  }
  const result = data.report?.jobs?.[0]?.validationResult?.[0];
  if (!result || typeof result.compliant !== 'boolean') return null;
  const details = result.details ?? {};
  const version = data.report?.buildInformation?.releaseDetails?.find((r) => r.id === 'core')?.version ?? 'unknown';
  const clauses = (details.ruleSummaries ?? [])
    .map((r) => ({
      specification: String(r.specification ?? ''),
      clause: String(r.clause ?? ''),
      testNumber: Number(r.testNumber ?? 0),
      failedChecks: Number(r.failedChecks ?? 0),
      description: String(r.description ?? '').slice(0, 500),
    }))
    .sort((a, b) => b.failedChecks - a.failedChecks)
    .slice(0, top);
  return {
    profile: String(result.profileName ?? 'unknown'),
    verapdfVersion: `veraPDF ${version}`,
    compliant: result.compliant,
    failedRules: Number(details.failedRules ?? 0),
    failedChecks: Number(details.failedChecks ?? 0),
    clauses,
  };
}
