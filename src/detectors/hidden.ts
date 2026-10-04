import { type AnyNode, attr, body, byTag, crawlerText, type Document, type Element, findAll } from '../dom.js';
import { type Finding, type Section, section } from '../types.js';

export interface HiddenBlock {
  reason: string;
  text: string;
  containsH1: boolean;
  containsHeading: boolean;
  chars: number;
  tag: string;
}

const STYLE_RULES: [RegExp, string][] = [
  [/(?:^|;)\s*opacity\s*:\s*0(?:\.0+)?\s*(?:!important\s*)?(?:;|$)/i, 'style opacity:0'],
  [/(?:^|;)\s*display\s*:\s*none/i, 'style display:none'],
  [/(?:^|;)\s*visibility\s*:\s*hidden/i, 'style visibility:hidden'],
];

/** Tailwind-style utility classes that hide at load (only the unprefixed form). */
const CLASS_RULES: [RegExp, string][] = [
  [/(?:^|\s)opacity-0(?:\s|$)/, 'class opacity-0'],
  [/(?:^|\s)invisible(?:\s|$)/, 'class invisible'],
];

function hiddenReason(el: Element): string | undefined {
  const style = attr(el, 'style') ?? '';
  for (const [re, label] of STYLE_RULES) if (re.test(style)) return label;
  const cls = attr(el, 'class') ?? '';
  for (const [re, label] of CLASS_RULES) if (re.test(cls)) return label;
  if (el.attribs && 'hidden' in el.attribs) {
    // Next.js streams Suspense content into <div hidden id="S:0"> then moves it in with JS.
    const id = attr(el, 'id') ?? '';
    return /^S:\d+$/.test(id) ? 'hidden attribute (streamed Suspense chunk)' : 'hidden attribute';
  }
  return undefined;
}

export function findHidden(doc: Document): HiddenBlock[] {
  const out: HiddenBlock[] = [];
  const visit = (node: AnyNode) => {
    if (node.type !== 'tag') {
      (node as { children?: AnyNode[] }).children?.forEach(visit);
      return;
    }
    const el = node as Element;
    if (['script', 'style', 'noscript', 'template', 'svg', 'dialog'].includes(el.name)) return;
    const reason = hiddenReason(el);
    if (reason) {
      const text = crawlerText(el).text.replace(/\n/g, ' ');
      if (text.length >= 15) {
        const heads = findAll(el, byTag('h1', 'h2', 'h3'));
        out.push({
          reason,
          text: text.length > 120 ? `${text.slice(0, 117)}...` : text,
          chars: text.length,
          containsH1: heads.some((h) => h.name === 'h1'),
          containsHeading: heads.length > 0,
          tag: el.name,
        });
      }
      return; // don't double-count descendants
    }
    el.children.forEach(visit);
  };
  body(doc).forEach(visit);
  return out;
}

export function hiddenSection(doc: Document): Section {
  const blocks = findHidden(doc);
  const f: Finding[] = [];
  const fade = (b: HiddenBlock) => /opacity|invisible|visibility/.test(b.reason);
  const why = 'Text is in the HTML, so crawlers read it, but Lighthouse sees no LCP until hydration and no-JS visitors see nothing.';
  const fix = 'Fix: animate from a visible state, or use CSS animations that do not depend on hydration.';
  const h1 = blocks.filter((b) => b.containsH1);
  for (const b of h1)
    f.push({
      id: 'hidden.h1',
      severity: 'fail',
      message: `Your H1 is invisible until JavaScript runs (${b.reason})`,
      detail: [`"${b.text}"`, why, fix],
    });
  const headingBlocks = blocks.filter((b) => !b.containsH1 && b.containsHeading && fade(b));
  if (headingBlocks.length)
    f.push({
      id: 'hidden.headings',
      severity: 'warn',
      message: `${headingBlocks.length} block(s) with H2/H3 headings are invisible until JavaScript runs`,
      detail: [...headingBlocks.map((b) => `${b.reason}: "${b.text}"`), ...(h1.length ? [] : [why, fix])],
    });
  const minor = blocks.filter((b) => !b.containsH1 && !(b.containsHeading && fade(b)));
  if (minor.length) {
    const chars = minor.reduce((n, b) => n + b.chars, 0);
    f.push({
      id: 'hidden.other',
      severity: chars > 2000 && minor.some(fade) ? 'warn' : 'info',
      message: `${minor.length} other block(s) hidden at load (${chars.toLocaleString('en-US')} chars)`,
      detail: minor.slice(0, 6).map((b) => `${b.reason}: "${b.text}"`),
    });
  }
  if (!blocks.length)
    f.push({ id: 'hidden.none', severity: 'pass', message: 'No text hidden at load by inline styles or utility classes' });
  return section('hidden', 'Hidden at load', f, { weight: 1, data: { blocks } });
}
