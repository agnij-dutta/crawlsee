import { attr, type Document, findAll, rawText } from '../dom.js';
import { type Finding, type Section, section } from '../types.js';

export interface JsonLdBlock {
  valid: boolean;
  error?: string;
  types: string[];
  raw: string;
  data?: unknown;
}

type Obj = Record<string, unknown>;

function collectNodes(value: unknown, out: Obj[] = []): Obj[] {
  if (Array.isArray(value)) {
    for (const v of value) collectNodes(v, out);
  } else if (value && typeof value === 'object') {
    const o = value as Obj;
    if ('@type' in o) out.push(o);
    if (Array.isArray(o['@graph'])) collectNodes(o['@graph'], out);
    for (const [k, v] of Object.entries(o)) if (k !== '@graph' && v && typeof v === 'object') collectNodes(v, out);
  }
  return out;
}

const typesOf = (o: Obj): string[] => {
  const t = o['@type'];
  return (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === 'string');
};

export function extractJsonLd(doc: Document): JsonLdBlock[] {
  return findAll(doc, (el) => el.name === 'script' && (attr(el, 'type') ?? '').toLowerCase().trim() === 'application/ld+json').map((el) => {
    const raw = rawText(el).trim();
    try {
      const data = JSON.parse(raw);
      const types = [...new Set(collectNodes(data).flatMap(typesOf))];
      return { valid: true, types, raw, data };
    } catch (e) {
      return { valid: false, error: (e as Error).message, types: [], raw };
    }
  });
}

/** Minimal "would Google/answer engines use this" checks for common types. */
const REQUIRED: Record<string, string[]> = {
  Organization: ['name', 'url'],
  Person: ['name'],
  WebSite: ['name', 'url'],
  Article: ['headline'],
  BlogPosting: ['headline'],
  Product: ['name'],
  FAQPage: ['mainEntity'],
  BreadcrumbList: ['itemListElement'],
  LocalBusiness: ['name', 'address'],
  ProfessionalService: ['name'],
  Service: ['name'],
  SoftwareApplication: ['name'],
};

export function allJsonLdNodes(blocks: JsonLdBlock[]): Obj[] {
  return blocks.filter((b) => b.valid).flatMap((b) => collectNodes(b.data));
}

export function jsonLdSection(doc: Document): Section {
  const blocks = extractJsonLd(doc);
  const f: Finding[] = [];
  if (blocks.length === 0) {
    f.push({
      id: 'jsonld.missing',
      severity: 'warn',
      message: 'No JSON-LD. Answer engines lean on it to know who you are (Person/Organization) and what you offer (Service, FAQPage)',
    });
    return section('jsonld', 'Structured data (JSON-LD)', f, { weight: 1, data: { blocks: [] } });
  }
  const invalid = blocks.filter((b) => !b.valid);
  for (const b of invalid)
    f.push({ id: 'jsonld.invalid', severity: 'fail', message: `JSON-LD block does not parse: ${b.error}`, detail: [b.raw.slice(0, 160)] });

  const types = [...new Set(blocks.flatMap((b) => b.types))];
  if (types.length) f.push({ id: 'jsonld.types', severity: 'pass', message: `${blocks.length} block(s), types: ${types.join(', ')}` });
  else if (!invalid.length) f.push({ id: 'jsonld.notypes', severity: 'warn', message: 'JSON-LD present but no @type found' });

  for (const node of allJsonLdNodes(blocks)) {
    for (const t of typesOf(node)) {
      const missing = (REQUIRED[t] ?? []).filter((k) => node[k] === undefined || node[k] === '');
      if (missing.length) f.push({ id: 'jsonld.fields', severity: 'warn', message: `${t} is missing ${missing.join(', ')}` });
      if (t === 'FAQPage') {
        const qs = ([] as unknown[]).concat(node.mainEntity ?? []) as Obj[];
        const bad = qs.filter((q) => !q?.name || !(q.acceptedAnswer as Obj | undefined)?.text);
        if (bad.length)
          f.push({
            id: 'jsonld.faq',
            severity: 'warn',
            message: `FAQPage has ${bad.length} question(s) without name or acceptedAnswer.text`,
          });
        else f.push({ id: 'jsonld.faq.ok', severity: 'pass', message: `FAQPage with ${qs.length} question(s)` });
      }
    }
  }
  if (!types.some((t) => ['Person', 'Organization', 'LocalBusiness', 'ProfessionalService', 'Corporation'].includes(t)))
    f.push({
      id: 'jsonld.entity',
      severity: 'info',
      message: 'No Person or Organization node: nothing tells engines who is behind this page',
    });

  return section('jsonld', 'Structured data (JSON-LD)', f, {
    weight: 1,
    data: { blocks: blocks.map(({ valid, error, types }) => ({ valid, error, types })) },
  });
}
