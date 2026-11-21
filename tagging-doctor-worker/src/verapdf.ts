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
  /** The 20 rules with the most failed checks (AC-30). */
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

export function parseReport(json: string, top = 20): Validation | null {
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
