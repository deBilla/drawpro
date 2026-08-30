/**
 * Scoring types shared by the deterministic suites and the agent runner.
 *
 * Every check carries a `guards` line — what breaks in the real world when it
 * fails. A suite whose failures cannot be described that way is measuring its
 * own implementation, and is worth deleting rather than fixing.
 */

export interface CheckResult {
  id: string;
  title: string;
  guards: string;
  pass: boolean;
  /** Evidence, shown only on failure. Truncated: some of these are whole scenes. */
  detail?: string;
  /** A failed check that ends the run for its suite, however the rest went. */
  critical?: boolean;
}

export interface SuiteResult {
  name: string;
  description: string;
  checks: CheckResult[];
  error?: string;
}

export class Grader {
  readonly checks: CheckResult[] = [];

  check(
    spec: { id: string; title: string; guards: string; critical?: boolean },
    pass: boolean,
    detail?: string,
  ): boolean {
    this.checks.push({
      ...spec,
      pass,
      detail: pass ? undefined : (detail ?? '').slice(0, 400),
    });
    return pass;
  }
}

export interface Suite {
  name: string;
  description: string;
  run(grader: Grader): Promise<void>;
}

export function tally(suites: SuiteResult[]): {
  passed: number;
  total: number;
  criticalFailures: CheckResult[];
} {
  const all = suites.flatMap((s) => s.checks);
  return {
    passed: all.filter((c) => c.pass).length,
    total: all.length,
    criticalFailures: all.filter((c) => !c.pass && c.critical),
  };
}
