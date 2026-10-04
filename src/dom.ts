import type { AnyNode, Document, Element } from 'domhandler';
import { parseDocument } from 'htmlparser2';

export type { AnyNode, Document, Element };

export function parseHtml(html: string): Document {
  return parseDocument(html, { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true });
}

export function isElement(node: AnyNode): node is Element {
  return node.type === 'tag' || node.type === 'script' || node.type === 'style';
}

/** Elements whose contents no crawler treats as page text. */
const SKIP = new Set(['script', 'style', 'noscript', 'template', 'svg', 'math', 'head', 'iframe', 'object', 'canvas']);

/**
 * Elements that start a new line of text for a crawler. Everything else is
 * inline: adjacent inline elements with no whitespace between them are read
 * as one word, no matter what CSS (flex gap, margin) does visually.
 */
export const BLOCK = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'body',
  'br',
  'dd',
  'details',
  'dialog',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hgroup',
  'hr',
  'html',
  'li',
  'main',
  'nav',
  'ol',
  'option',
  'p',
  'pre',
  'section',
  'summary',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
  'caption',
  'legend',
  'menu',
  'search',
]);

export function findAll(root: AnyNode | AnyNode[], pred: (el: Element) => boolean): Element[] {
  const out: Element[] = [];
  const stack: AnyNode[] = Array.isArray(root) ? [...root].reverse() : [root];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (isElement(node) && pred(node)) out.push(node);
    const kids = (node as { children?: AnyNode[] }).children;
    if (kids) for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
  return out;
}

export function findFirst(root: AnyNode | AnyNode[], pred: (el: Element) => boolean): Element | undefined {
  return findAll(root, pred)[0];
}

export const byTag =
  (...tags: string[]) =>
  (el: Element) =>
    tags.includes(el.name);

export function attr(el: Element | undefined, name: string): string | undefined {
  return el?.attribs?.[name];
}

/** Raw text of a script/style element. */
export function rawText(el: Element): string {
  return el.children.map((c) => ('data' in c ? (c as { data: string }).data : '')).join('');
}

export interface Glue {
  /** Index in the produced text where the two pieces touch. */
  at: number;
  left: string;
  right: string;
}

export interface CrawlerText {
  /** Text the way a non-rendering crawler concatenates it. Blocks are separated by "\n". */
  text: string;
  /** Places where two different elements' text was glued with no whitespace. */
  glue: Glue[];
}

interface Piece {
  text: string;
  owner: Element | null;
}

function collectPieces(node: AnyNode, out: (Piece | 'break')[], owner: Element | null): void {
  if (node.type === 'text') {
    out.push({ text: (node as unknown as { data: string }).data, owner });
    return;
  }
  if (!isElement(node)) {
    // Document root or CDATA: recurse into children if any.
    const kids = (node as { children?: AnyNode[] }).children;
    if (kids) for (const k of kids) collectPieces(k, out, owner);
    return;
  }
  if (SKIP.has(node.name)) return;
  const block = BLOCK.has(node.name);
  if (block) out.push('break');
  for (const k of node.children) collectPieces(k, out, node);
  if (block) out.push('break');
}

const LEFT_GLUE = /[\p{L}\p{M}][,.;:!?)'"’]?$/u;
const RIGHT_LETTER = /^[\p{L}]/u;
/**
 * Scripts written without spaces between words. `<span>日本語</span><span>ページ</span>` reads
 * correctly with no whitespace, so a boundary touching one of these is never glue.
 */
const UNSPACED =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}\p{Script=Tibetan}]/u;
const LAST_LETTER = /([\p{L}])[\p{M}]*[,.;:!?)'"’]?$/u;

/** `note<sup>a</sup>`, `1<sup>st</sup>`, `H<sub>2</sub>O`: footnote markers and formulas sit flush on purpose. */
function inSupSub(owner: Element | null): boolean {
  if (owner === null) return false;
  return [owner, ...ancestors(owner)].some((el) => el.name === 'sup' || el.name === 'sub');
}

/**
 * Build the text a crawler sees for `root`, and detect "glued words":
 * two inline elements whose text touches with no whitespace in between,
 * e.g. `<span>We</span><span>buy</span>` read as "Webuy".
 *
 * JSX drops whitespace that contains a newline, so one word per line in
 * JSX produces exactly this, while CSS gap keeps it looking fine.
 */
export function crawlerText(root: AnyNode | AnyNode[]): CrawlerText {
  const pieces: (Piece | 'break')[] = [];
  for (const r of Array.isArray(root) ? root : [root]) collectPieces(r, pieces, null);

  let text = '';
  const glue: Glue[] = [];
  let pendingBreak = false;
  let last: Piece | null = null;

  for (const p of pieces) {
    if (p === 'break') {
      pendingBreak = true;
      continue;
    }
    const norm = p.text.replace(/\s+/g, ' ');
    if (norm === '') continue;
    if (norm === ' ') {
      if (!pendingBreak && text && !text.endsWith(' ') && !text.endsWith('\n')) text += ' ';
      continue;
    }
    if (pendingBreak) {
      text = text.replace(/ +$/, '');
      if (text && !text.endsWith('\n')) text += '\n';
      pendingBreak = false;
      text += norm.replace(/^ /, '');
    } else {
      if (last && text && !/[\s]$/.test(text) && !norm.startsWith(' ') && last.owner !== p.owner) {
        const leftSeg = last.text.trim();
        const rightSeg = norm.trim();
        // Per-letter split animations (<span>H</span><span>i</span>) still form a real word.
        const charSplit = leftSeg.length <= 1 && rightSeg.length <= 1;
        const digitWord = /\d$/.test(text) && /^[\p{Ll}]{3,}/u.test(rightSeg); // "4years", not footnote "1Smith"
        const unspaced = UNSPACED.test(LAST_LETTER.exec(text)?.[1] ?? '') || UNSPACED.test(rightSeg[0] ?? '');
        const marker = inSupSub(last.owner) || inSupSub(p.owner);
        if (!charSplit && !unspaced && !marker && ((LEFT_GLUE.test(text) && RIGHT_LETTER.test(rightSeg)) || digitWord)) {
          glue.push({ at: text.length, left: leftSeg, right: rightSeg });
        }
      }
      text += text === '' ? norm.replace(/^ /, '') : norm;
    }
    last = { text: norm, owner: p.owner };
  }
  return { text: text.trimEnd(), glue };
}

/** The whitespace-delimited tokens of `text` that contain a glue point, e.g. "Webuy,operate,andscale". */
export function gluedTokens(ct: CrawlerText): string[] {
  const tokens: string[] = [];
  const re = /\S+/g;
  for (let m = re.exec(ct.text); m !== null; m = re.exec(ct.text)) {
    const start = m.index;
    const end = start + m[0].length;
    if (ct.glue.some((g) => g.at > start && g.at < end)) tokens.push(m[0]);
  }
  return tokens;
}

/**
 * Tag-stripped text with a space at every element boundary: what `grep`
 * sees after `sed 's/<[^>]*>/ /g'`. Used for stats and counters.
 */
export function spacedText(root: AnyNode | AnyNode[]): string {
  const parts: string[] = [];
  const walk = (n: AnyNode) => {
    if (n.type === 'text') parts.push((n as unknown as { data: string }).data);
    else if (isElement(n)) {
      if (SKIP.has(n.name)) return;
      parts.push(' ');
      n.children.forEach(walk);
      parts.push(' ');
    } else (n as { children?: AnyNode[] }).children?.forEach(walk);
  };
  (Array.isArray(root) ? root : [root]).forEach(walk);
  return parts.join('').replace(/\s+/g, ' ').trim();
}

/** Split crawler text into lines (blocks) for diffing. */
export function textBlocks(root: AnyNode | AnyNode[]): string[] {
  return crawlerText(root)
    .text.split('\n')
    .filter((l) => l.trim().length > 0);
}

export function ancestors(el: AnyNode): Element[] {
  const out: Element[] = [];
  let p = el.parent;
  while (p && isElement(p as AnyNode)) {
    out.push(p as Element);
    p = p.parent;
  }
  return out;
}

export function body(doc: Document): AnyNode[] {
  const b = findFirst(doc, byTag('body'));
  return b ? [b] : doc.children;
}
