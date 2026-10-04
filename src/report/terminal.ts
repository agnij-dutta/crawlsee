import type { Report, Section, Severity } from '../types.js';

export interface Paint {
  bold: (s: string) => string;
  dim: (s: string) => string;
  red: (s: string) => string;
  yellow: (s: string) => string;
  green: (s: string) => string;
  cyan: (s: string) => string;
}

export function makePaint(enabled: boolean): Paint {
  const wrap = (open: number, close: number) => (s: string) => (enabled ? `\x1b[${open}m${s}\x1b[${close}m` : s);
  return { bold: wrap(1, 22), dim: wrap(2, 22), red: wrap(31, 39), yellow: wrap(33, 39), green: wrap(32, 39), cyan: wrap(36, 39) };
}

const ICON: Record<Severity, string> = { pass: '✓', info: '·', warn: '!', fail: '✗' };

function scoreColor(p: Paint, score: number) {
  return score >= 85 ? p.green : score >= 60 ? p.yellow : p.red;
}

function bar(score: number, width = 20): string {
  const filled = Math.round((score / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function wrapLine(text: string, width: number, indent: string): string[] {
  if (text.length <= width) return [text];
  const out: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (`${line} ${word}`.trim().length > width && line) {
      out.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out.map((l, i) => (i === 0 ? l : indent + l));
}

function renderSection(s: Section, p: Paint, verbose: boolean, width: number): string[] {
  const lines: string[] = [];
  const score = s.score === null ? p.dim('  -') : scoreColor(p, s.score)(String(s.score).padStart(3));
  lines.push(`${score}  ${p.bold(s.title)}${s.note ? p.dim(`  (${s.note})`) : ''}`);
  for (const f of s.findings) {
    const color = f.severity === 'fail' ? p.red : f.severity === 'warn' ? p.yellow : f.severity === 'pass' ? p.green : p.dim;
    const msg = wrapLine(f.message, width - 8, '       ');
    lines.push(`     ${color(ICON[f.severity])} ${msg.join('\n')}`);
    const detail = f.detail ?? [];
    const max = verbose ? detail.length : 8;
    for (const d of detail.slice(0, max))
      lines.push(p.dim(`         ${!verbose && d.length > width - 10 ? `${d.slice(0, width - 13)}...` : d}`));
    if (detail.length > max) lines.push(p.dim(`         ... ${detail.length - max} more (use --verbose)`));
  }
  return lines;
}

export function renderTerminal(r: Report, opts: { color: boolean; verbose?: boolean; width?: number }): string {
  const p = makePaint(opts.color);
  const width = Math.min(opts.width ?? 100, 120);
  const out: string[] = [];
  out.push('');
  out.push(`${p.bold('crawlsee')} ${p.dim(`v${r.version}`)}  ${p.cyan(r.input)}`);
  if (r.finalUrl && r.finalUrl.replace(/\/$/, '') !== r.input.replace(/\/$/, '')) out.push(p.dim(`         final URL: ${r.finalUrl}`));
  out.push(p.dim('what crawlers and AI answer engines read, before any JavaScript runs'));
  out.push('');
  out.push(`${p.bold('Overall')}  ${scoreColor(p, r.score)(`${bar(r.score)} ${r.score}/100`)}`);
  out.push('');
  for (const s of r.sections) {
    out.push(...renderSection(s, p, !!opts.verbose, width));
    out.push('');
  }
  const fails = r.sections.flatMap((s) => s.findings).filter((f) => f.severity === 'fail').length;
  const warns = r.sections.flatMap((s) => s.findings).filter((f) => f.severity === 'warn').length;
  out.push(p.dim(`${fails} fail, ${warns} warn. Scores are heuristics; read the findings, not just the number.`));
  out.push('');
  return out.join('\n');
}
