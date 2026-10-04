import { attr, body, byTag, crawlerText, type Document, findAll } from '../dom.js';
import { type Finding, type Section, section } from '../types.js';
import { extractHeadings } from './headings.js';
import { allJsonLdNodes, extractJsonLd } from './jsonld.js';
import { extractMeta } from './meta.js';

/**
 * Buyer vocabulary. Answer engines match the words a buyer types, so each
 * query term expands to the phrasings a buyer (and a page that ranks) uses.
 * Hand-written and heuristic on purpose: no LLM calls, no paid APIs.
 */
export const SYNONYMS: readonly (readonly string[])[] = [
  [
    'freelance',
    'freelancer',
    'freelancing',
    'contract work',
    'contract role',
    'contractor',
    'for hire',
    'hire',
    'hiring',
    'work with',
    'available for',
    'consultant',
    'consulting',
    'independent',
    'fractional',
    'open to work',
  ],
  ['engineer', 'developer', 'dev', 'programmer', 'coder', 'software engineer', 'builder'],
  [
    'web3',
    'blockchain',
    'crypto',
    'onchain',
    'on-chain',
    'smart contract',
    'smart contracts',
    'solidity',
    'ethereum',
    'evm',
    'solana',
    'defi',
    'dapp',
  ],
  ['designer', 'ui', 'ux', 'product designer'],
  ['agency', 'studio', 'firm', 'consultancy'],
  ['ai', 'llm', 'machine learning', 'ml', 'agents', 'ai agents', 'genai'],
  ['frontend', 'front-end', 'front end', 'react', 'next.js', 'nextjs'],
  ['backend', 'back-end', 'back end', 'api', 'node', 'node.js'],
  ['fullstack', 'full-stack', 'full stack'],
  ['mobile', 'ios', 'android', 'react native', 'app developer', 'phone', 'iphone', 'smartphone'],
  ['seo', 'search engine optimization'],
  ['remote', 'worldwide', 'anywhere'],
  ['cheap', 'affordable', 'pricing', 'rates', 'cost', 'price'],
  ['best', 'top', 'expert', 'senior', 'experienced', 'specialist'],
  ['startup', 'startups', 'saas', 'founders'],
  ['issue', 'issues', 'bug', 'bugs', 'ticket', 'tickets'],
  ['tracker', 'tracking', 'tracker app'],
  ['task', 'tasks', 'todo', 'todos', 'to-do'],
  ['coding', 'code', 'programming', 'software development'],
  ['notes', 'note', 'note-taking', 'notes app'],
];

/** Seller-speak that buyers never type, and what to say instead. */
const SELLER_SPEAK: [RegExp, string][] = [
  [/select engagements?/i, '"available for freelance / contract work"'],
  [/open to (new )?opportunities/i, '"available for hire" or "open to freelance work"'],
  [/\bcollaborations?\b/i, '"freelance projects" or "contract work"'],
  [/\bpartner(ing|ships?)? with\b/i, '"work with" or "hire"'],
  [/\bcraft(ing)?\b/i, '"build" or "develop"'],
  [/\bsolutions\b/i, 'the concrete service name ("smart contract development")'],
  [/\bbespoke\b/i, '"custom"'],
  [/\bventures?\b/i, 'the plain thing you do ("startups", "products")'],
];

const STOP = new Set([
  'a',
  'an',
  'the',
  'for',
  'to',
  'of',
  'in',
  'on',
  'at',
  'by',
  'from',
  'into',
  'and',
  'or',
  'with',
  'without',
  'who',
  'what',
  'how',
  'which',
  'is',
  'are',
  'can',
  'do',
  'does',
  'my',
  'me',
  'i',
  'you',
  'your',
  'it',
  'this',
  'that',
  'best',
  'top',
  'find',
  'need',
  'want',
  'looking',
  'someone',
  'good',
  'near',
  'tool',
  'way',
]);

const AVAILABILITY = /\b(available|open|taking|accepting)\b[^.\n]{0,30}\b(freelance|hire|contract|work|projects?|clients?|engagements?)\b/i;

export interface QueryConcept {
  term: string;
  variants: string[];
  /** Where it matched, best placement first. */
  foundIn: string[];
  matched?: string;
  weight: number;
}

export interface QueryResult {
  query: string;
  score: number;
  concepts: QueryConcept[];
  exactPhrase: boolean;
  availability: boolean;
  faqPage: boolean;
  sellerSpeak: { phrase: string; suggest: string }[];
  suggestions: string[];
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function contains(text: string, phrase: string): boolean {
  const p = escapeRe(phrase.toLowerCase()).replace(/-|\s+/g, '[\\s-]?');
  // Unicode-aware word edges, so "développeur" or "разработчик" match as whole words.
  return new RegExp(`(?<![\\p{L}\\p{N}])${p}(?:s|es)?(?![\\p{L}\\p{N}])`, 'iu').test(text);
}

function variantsFor(term: string): string[] {
  const t = term.toLowerCase();
  const group = SYNONYMS.find((g) => g.includes(t) || g.includes(t.replace(/s$/, '')));
  return group ? [t, ...group.filter((v) => v !== t)] : [t];
}

export interface QueryCorpus {
  title: string;
  h1: string;
  description: string;
  headings: string;
  body: string;
  jsonld: string;
  llmsTxt: string;
}

export function buildCorpus(doc: Document, llmsTxt = ''): QueryCorpus {
  const meta = extractMeta(doc);
  const hs = extractHeadings(doc);
  const nodes = allJsonLdNodes(extractJsonLd(doc));
  return {
    title: meta.title ?? '',
    h1: hs
      .filter((h) => h.level === 1)
      .map((h) => h.text)
      .join(' '),
    description: [meta.description, meta.og.description].filter(Boolean).join(' '),
    headings: hs
      .filter((h) => h.level > 1)
      .map((h) => h.text)
      .join(' '),
    body: crawlerText(body(doc)).text,
    jsonld: JSON.stringify(nodes),
    llmsTxt,
  };
}

/** Placement weights: title/H1 count most, llms.txt and JSON-LD count, body counts least. */
const PLACES: [keyof QueryCorpus, string, number][] = [
  ['title', 'title', 1],
  ['h1', 'H1', 1],
  ['description', 'meta description', 0.85],
  ['headings', 'H2/H3', 0.8],
  ['jsonld', 'JSON-LD', 0.75],
  ['llmsTxt', 'llms.txt', 0.7],
  ['body', 'body text', 0.6],
];

/** Links to pages that usually carry the buyer vocabulary (/hire, /services...). */
export function hireLinks(doc: Document): string[] {
  const re = /^(?:https?:\/\/[^/]+)?\/(hire|hire-me|services|work-with-me|work-with-us|consulting|pricing|freelance)\/?$/i;
  return [
    ...new Set(
      findAll(doc, byTag('a'))
        .map((a) => attr(a, 'href') ?? '')
        .filter((h) => re.test(h)),
    ),
  ];
}

export function analyzeQuery(query: string, corpus: QueryCorpus, links: string[] = []): QueryResult {
  const terms = query
    .toLowerCase()
    .split(/[^\p{L}\p{M}\p{N}.+#-]+/u)
    .map((t) => t.replace(/^[.-]+|[.-]+$/g, ''))
    .filter((t) => t && !STOP.has(t));
  const concepts: QueryConcept[] = [...new Set(terms)].map((term) => {
    const variants = variantsFor(term);
    const foundIn: string[] = [];
    let weight = 0;
    let matched: string | undefined;
    for (const [key, label, w] of PLACES) {
      const hit = variants.find((v) => contains(corpus[key], v));
      if (hit) {
        foundIn.push(label);
        if (w > weight) {
          weight = w;
          matched = hit;
        }
      }
    }
    return { term, variants, foundIn, matched, weight };
  });

  const all = Object.values(corpus).join('\n');
  const exactPhrase = contains(all, query.trim());
  const availability = AVAILABILITY.test(all);
  const faqPage = /"FAQPage"/.test(corpus.jsonld);
  const visible = [corpus.title, corpus.h1, corpus.description, corpus.headings, corpus.body, corpus.llmsTxt].join('\n');
  const sellerSpeak = SELLER_SPEAK.filter(([re]) => re.test(visible)).map(([re, suggest]) => ({
    phrase: (visible.match(re) ?? [''])[0],
    suggest,
  }));

  const coverage = concepts.length ? concepts.reduce((n, c) => n + c.weight, 0) / concepts.length : 0;
  const hiring = /freelanc|hire|contract|consult|available|agency|service/i.test(query);
  let score = coverage * 80 + (exactPhrase ? 10 : 0) + (faqPage ? 5 : 0) + (!hiring || availability ? 5 : 0);
  score = Math.round(Math.max(0, Math.min(100, score)));

  const suggestions: string[] = [];
  const missing = concepts.filter((c) => c.weight === 0);
  for (const c of missing)
    suggestions.push(
      c.variants.length > 1
        ? `Nothing on the page says "${c.term}" or a synonym (${c.variants.slice(1, 5).join(', ')}). Add the buyer's word.`
        : `Nothing on the page says "${c.term}". If buyers search with it, use it.`,
    );
  for (const c of concepts.filter((c) => c.weight > 0 && c.weight < 0.8))
    suggestions.push(`"${c.matched}" only appears in ${c.foundIn.join(', ')}. Put it in the title, H1 or meta description.`);
  if (!exactPhrase) suggestions.push(`Use the phrase as buyers type it, verbatim, somewhere visible: "${query.trim()}".`);
  if (hiring && !availability)
    suggestions.push(
      'No availability statement. Say it plainly, e.g. "Available for freelance and contract work" (and repeat it in llms.txt).',
    );
  if (hiring && !faqPage && links.length)
    suggestions.push(
      `This page links to ${links.join(', ')}. Answer engines may cite that page instead: run crawlsee on it with the same --query.`,
    );
  else if (hiring && !faqPage)
    suggestions.push(
      'Add a /hire (or /services) page with FAQPage JSON-LD answering "Is X available for freelance work?", "What does it cost?", "How do I start?".',
    );
  for (const s of sellerSpeak) suggestions.push(`You say "${s.phrase}". Buyers type ${s.suggest}.`);
  if (!corpus.llmsTxt)
    suggestions.push(
      hiring
        ? 'No llms.txt text was read. Publish one with a short "Availability" section in buyer words.'
        : 'No llms.txt text was read. Publish one that says what this is in the words people search with.',
    );

  return { query, score, concepts, exactPhrase, availability, faqPage, sellerSpeak, suggestions };
}

export function querySection(doc: Document, query: string, llmsTxt = ''): Section {
  const r = analyzeQuery(query, buildCorpus(doc, llmsTxt), hireLinks(doc));
  const f: Finding[] = r.concepts.map((c) => ({
    id: 'query.concept',
    severity: c.weight >= 0.8 ? 'pass' : c.weight > 0 ? 'warn' : 'fail',
    message:
      c.weight > 0
        ? `"${c.term}": matched "${c.matched}" in ${c.foundIn.join(', ')}`
        : `"${c.term}": not found${c.variants.length > 1 ? ` (tried ${c.variants.slice(0, 6).join(', ')})` : ''}`,
  }));
  f.push({
    id: 'query.exact',
    severity: r.exactPhrase ? 'pass' : 'info',
    message: r.exactPhrase ? 'Exact query phrase appears' : 'Exact query phrase does not appear',
  });
  if (r.suggestions.length)
    f.push({ id: 'query.suggestions', severity: 'info', message: 'Suggested phrases and fixes', detail: r.suggestions });
  return section('query', `Would an AI recommend you for "${query}"?`, f, {
    weight: 1.5,
    score: r.score,
    data: { ...r },
    note: 'heuristic: vocabulary overlap with buyer phrasing, no LLM calls',
  });
}
