/**
 * Pure analysis of an HTML string. No network, no Node APIs: this module is
 * also bundled into the paste-HTML web UI.
 */

import { countersSection } from './detectors/counters.js';
import { headingsSection } from './detectors/headings.js';
import { hiddenSection } from './detectors/hidden.js';
import { jsonLdSection } from './detectors/jsonld.js';
import { metaSection } from './detectors/meta.js';
import { querySection } from './detectors/query.js';
import { extractScripts, scriptsSection } from './detectors/scripts.js';
import { type Document, parseHtml } from './dom.js';
import { overallScore, type Report, type Section } from './types.js';

/** Kept in sync with package.json (a test checks it). */
export const VERSION = '0.1.1';

export type { Finding, Report, Section, Severity } from './types.js';
/** Parse HTML into the Document that analyzeDocument expects (htmlparser2, entities decoded). */
export { parseHtml };

export interface HtmlAnalysisOptions {
  /** URL the HTML was served from: resolves script URLs and checks the canonical. */
  pageUrl?: string;
  /** Buyer query for the "would an AI recommend you" check. */
  query?: string;
  /** llms.txt text to include in the query check. */
  llmsTxt?: string;
}

/** Run every markup-only detector on a parsed document. */
export function analyzeDocument(doc: Document, opts: HtmlAnalysisOptions = {}): Section[] {
  const sections: Section[] = [
    metaSection(doc, opts.pageUrl),
    headingsSection(doc),
    jsonLdSection(doc),
    countersSection(doc),
    hiddenSection(doc),
  ];
  if (opts.query) sections.push(querySection(doc, opts.query, opts.llmsTxt));
  return sections;
}

/** Paste-HTML mode: everything that can be judged from the markup alone. */
export function analyzeHtml(html: string, opts: HtmlAnalysisOptions = {}): Report {
  const doc = parseHtml(html);
  const sections = analyzeDocument(doc, opts);
  sections.push(scriptsSection(extractScripts(doc, opts.pageUrl), { fetched: false }));
  return {
    tool: 'crawlsee',
    version: VERSION,
    input: opts.pageUrl ?? '(pasted HTML)',
    fetchedAt: new Date().toISOString(),
    score: overallScore(sections),
    sections,
  };
}
