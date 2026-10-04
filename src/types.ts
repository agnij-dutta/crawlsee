/** Severity of a single finding. `pass` and `info` never cost points. */
export type Severity = 'pass' | 'info' | 'warn' | 'fail';

export interface Finding {
  /** Stable machine id, e.g. `headings.glued-words`. */
  id: string;
  severity: Severity;
  message: string;
  /** Extra lines shown indented under the message. */
  detail?: string[];
}

export interface Section {
  id: string;
  title: string;
  /** 0-100, or null when the section was skipped. */
  score: number | null;
  /** Relative weight in the overall score. */
  weight: number;
  findings: Finding[];
  /** Structured data for --json consumers. */
  data?: Record<string, unknown>;
  /** Shown under the title, e.g. "heuristic". */
  note?: string;
}

export interface RedirectHop {
  url: string;
  status: number;
  location?: string;
}

export interface Report {
  tool: 'crawlsee';
  version: string;
  input: string;
  finalUrl?: string;
  fetchedAt: string;
  score: number;
  sections: Section[];
}

/** Points deducted per severity when a section does not compute its own score. */
const PENALTY: Record<Severity, number> = { pass: 0, info: 0, warn: 12, fail: 35 };

export function scoreFromFindings(findings: Finding[]): number {
  const lost = findings.reduce((sum, f) => sum + PENALTY[f.severity], 0);
  return Math.max(0, Math.min(100, 100 - lost));
}

export function section(
  id: string,
  title: string,
  findings: Finding[],
  opts: { weight?: number; score?: number | null; data?: Record<string, unknown>; note?: string } = {},
): Section {
  return {
    id,
    title,
    weight: opts.weight ?? 1,
    score: opts.score === undefined ? scoreFromFindings(findings) : opts.score,
    findings,
    ...(opts.data ? { data: opts.data } : {}),
    ...(opts.note ? { note: opts.note } : {}),
  };
}

export function overallScore(sections: Section[]): number {
  const scored = sections.filter((s) => s.score !== null && s.weight > 0);
  if (scored.length === 0) return 0;
  const totalWeight = scored.reduce((n, s) => n + s.weight, 0);
  const sum = scored.reduce((n, s) => n + (s.score as number) * s.weight, 0);
  return Math.round(sum / totalWeight);
}
