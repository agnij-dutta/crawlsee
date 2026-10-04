import { type AnyNode, ancestors, body, type Document, type Element, findAll, isElement, spacedText } from '../dom.js';
import { type Finding, type Section, section } from '../types.js';

export interface ZeroStat {
  /** Tag-stripped text of the stat, e.g. "0 M+ Views/Month". */
  context: string;
  /** The zero token as served, e.g. "0 M+". */
  token: string;
  strength: 'strong' | 'weak';
  /** Counter attributes/classes found nearby (data-target, .counter...). */
  evidence: string[];
  /** The zero sits alone in its own element, the way counter components render. */
  isolated: boolean;
  /** Filled in when a rendered pass shows what it animates to. */
  renderedAs?: string;
  /** Set when a rendered pass still shows zero in the same spot: a real zero, not a counter. */
  staysZero?: boolean;
}

/** 0+, 0K, 0 M+, $0M: nobody writes these on purpose. */
const STRONG = /(?<![\d.,])([$€£]?0(?:[.,]0+)?\s*(?:[KMBkmb]\s*\+?|\+)(?![\w]))/;
/** 0%, 0x, "0 clients": legit sometimes, so only flagged with supporting evidence. */
const WEAK = /(?<![\d.,\w])([$€£]?0(?:[.,]0+)?\s*(?:%|x\b|(?=\s+[A-Za-z][\w/-]{2,})))/;

const COUNTER_ATTR = /^data-(count|counter|target|to|end|end-value|value|number|countup|from|duration)$/;
const COUNTER_CLASS =
  /(^|[\s_-])(count|counter|countup|count-up|odometer|ticker|animated-?number|number-?flow|number-?ticker|tally)(?=[\s_-]|$)/i;

function evidenceFor(el: Element): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(el.attribs ?? {})) {
    if (COUNTER_ATTR.test(k)) out.push(`${k}="${v}"`);
    if (k === 'class' && COUNTER_CLASS.test(v)) out.push(`class="${v.length > 50 ? `${v.slice(0, 47)}...` : v}"`);
  }
  return out;
}

/** Smallest ancestor whose text includes a real word (the stat's label), capped at 160 chars. */
function nearestContext(textNode: AnyNode): Element | undefined {
  const anc = ancestors(textNode);
  let prev = anc[0];
  for (const a of anc) {
    const t = spacedText(a);
    if (t.length > 160) return prev;
    if (/[A-Za-z]{2,}/.test(t)) return a;
    prev = a;
  }
  return prev;
}

function textNodes(root: AnyNode[]): AnyNode[] {
  const out: AnyNode[] = [];
  const walk = (n: AnyNode) => {
    if (n.type === 'text') out.push(n);
    else if (isElement(n)) {
      if (['script', 'style', 'noscript', 'template', 'svg'].includes(n.name)) return;
      n.children.forEach(walk);
    } else (n as { children?: AnyNode[] }).children?.forEach(walk);
  };
  root.forEach(walk);
  return out;
}

export function findZeroStats(doc: Document): ZeroStat[] {
  const found = new Map<string, ZeroStat>();
  for (const tn of textNodes(body(doc))) {
    const data = (tn as unknown as { data: string }).data;
    if (!/(?<![\d.,])0(?!\d)/.test(data)) continue;
    const ctxEl = nearestContext(tn);
    if (!ctxEl) continue;
    const context = spacedText(ctxEl);
    const strong = STRONG.exec(context);
    const weak = strong ? null : WEAK.exec(context);
    const m = strong ?? weak;
    if (!m) continue;
    const evidence = [
      ...ancestors(tn)
        .slice(0, ancestors(tn).indexOf(ctxEl) + 1)
        .flatMap(evidenceFor),
      ...findAll(ctxEl, () => true).flatMap(evidenceFor),
    ];
    const key = context;
    const token = m[1].trim();
    const isolated = /^[$€£]?0(?:[.,]0+)?\s*[KMBkmb%+x]?\+?$/.test(data.trim());
    // "0 M+" is strong when the zero sits in its own element (that is how counters render it), but the
    // same spaced shape inside running text is prose: "$0 + VAT", "0 B used".
    const spacedInProse = /\s/.test(token) && !isolated;
    if (!found.has(key))
      found.set(key, {
        context,
        token,
        strength: strong && !spacedInProse ? 'strong' : 'weak',
        evidence: [...new Set(evidence)],
        isolated,
      });
  }
  const all = [...found.values()];
  const isolatedWeak = all.filter((z) => z.strength === 'weak' && z.isolated).length;
  // "0% fees" in a sentence is a real claim. A zero alone in its own element, repeated across
  // several stats or wrapped in counter markup, is a counter that has not run yet.
  return all.filter((z) => z.strength === 'strong' || z.evidence.length > 0 || (z.isolated && isolatedWeak >= 2));
}

export interface SplitStat {
  number: string;
  context: string;
}

/** Numbers that live in their own element, apart from their unit: `grep "12M+"` on raw HTML misses them. */
export function findSplitStats(doc: Document, limit = 6): SplitStat[] {
  const out: SplitStat[] = [];
  for (const tn of textNodes(body(doc))) {
    const num = (tn as unknown as { data: string }).data.trim();
    // Skip list ordinals ("01") and years ("2026").
    if (!/^[$€£]?\d[\d.,]*$/.test(num) || /^0\d/.test(num) || /^(19|20)\d\d$/.test(num) || /^[$€£]?0(?:[.,]0+)?$/.test(num)) continue;
    const parent = tn.parent as Element | null;
    if (!parent || !isElement(parent as AnyNode)) continue;
    if (spacedText(parent) !== num) continue;
    const ctxEl = nearestContext(tn);
    if (!ctxEl || ctxEl === parent) continue;
    const context = spacedText(ctxEl);
    const after = context.slice(context.indexOf(num) + num.length);
    // A unit or a lowercase noun ("4 years"); a capitalized word is usually a footnote or list label.
    if (!/^\s*([KMBkmb%+x](?![a-z])|[a-z]{2,})/.test(after)) continue;
    out.push({ number: num, context });
    if (out.length >= limit) break;
  }
  return out;
}

export function countersSection(doc: Document, found: ZeroStat[] = findZeroStats(doc)): Section {
  // A weak match ("0 stars") with no counter markup that still reads zero after rendering is a real zero.
  const zeros = found.filter((z) => !(z.staysZero && z.strength === 'weak' && z.evidence.length === 0));
  const splits = findSplitStats(doc);
  const f: Finding[] = [];
  for (const z of zeros) {
    const confirmed = z.renderedAs !== undefined;
    f.push({
      id: 'counters.zero-state',
      severity: z.strength === 'strong' || z.evidence.length || confirmed ? 'fail' : 'warn',
      message: `Crawlers, link previews and AI summaries read "${z.context}"`,
      detail: [
        ...(z.renderedAs ? [`browsers show "${z.renderedAs}" after JavaScript (confirmed by --render)`] : []),
        z.evidence.length ? `counter markup: ${z.evidence.slice(0, 3).join(' ')}` : 'looks like a JS counter that animates up from zero',
        'Fix: server-render the final number and animate from it (or animate a CSS transform, not the text).',
      ],
    });
  }
  if (!zeros.length) f.push({ id: 'counters.none', severity: 'pass', message: 'No zero-state counters in the served HTML' });
  if (splits.length)
    f.push({
      id: 'counters.split',
      severity: 'info',
      message: `${splits.length} stat(s) keep the number and its unit in separate elements`,
      detail: [
        ...splits.map((s) => `${s.number}  in  "${s.context}"`),
        'Harmless for crawlers, but `curl | grep "12M+"` fails: strip tags first, e.g. sed "s/<[^>]*>/ /g".',
      ],
    });
  return section('counters', 'Zero-state counters', f, { weight: 1, data: { zeros, splits } });
}
