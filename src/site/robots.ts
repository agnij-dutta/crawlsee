export interface RobotsGroup {
  agents: string[];
  rules: { allow: boolean; path: string }[];
}

export interface Robots {
  groups: RobotsGroup[];
  sitemaps: string[];
}

/**
 * The product token of a user-agent line: "GPTBot/1.1" -> "gptbot". RFC 9309 section 2.2.1 defines it
 * as letters, "-" and "_", matched case-insensitively.
 */
function productToken(value: string): string {
  if (value.startsWith('*')) return '*';
  return (value.match(/^[A-Za-z_-]+/)?.[0] ?? '').toLowerCase();
}

/**
 * Parse robots.txt into groups (RFC 9309 section 2.1). Consecutive user-agent lines share one group,
 * and only an allow/disallow rule ends that run: other lines (Crawl-delay, Sitemap, unknown keys)
 * neither start nor split a group, as in Google's open-source parser.
 */
export function parseRobots(txt: string): Robots {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | null = null;
  let inAgentRun = false;
  for (const rawLine of txt.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === 'user-agent') {
      if (!current || !inAgentRun) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      const token = productToken(value);
      if (token && !current.agents.includes(token)) current.agents.push(token);
      inAgentRun = true;
    } else if (key === 'allow' || key === 'disallow') {
      inAgentRun = false;
      if (!current) continue;
      if (value === '') continue; // an empty rule matches nothing (RFC 9309 section 2.2.2)
      current.rules.push({ allow: key === 'allow', path: value });
    } else if (key === 'sitemap') {
      sitemaps.push(value);
    }
  }
  return { groups, sitemaps };
}

/** Percent-encode non-ASCII so a rule written as "/café" matches the encoded path "/caf%C3%A9" (section 2.2.2). */
const encodeRule = (rule: string) => rule.replace(/[^\p{ASCII}]+/gu, (c) => encodeURIComponent(c));

/**
 * Rule matching with "*" (any run of characters) and a trailing "$" (end of path), RFC 9309 section 2.2.3.
 * A hand-rolled matcher rather than a RegExp: robots.txt is untrusted input, and a rule like
 * "/*a*a*a...b" turns a regex into catastrophic backtracking. This runs in O(rule x path).
 */
export function ruleMatches(rulePath: string, path: string): boolean {
  const anchored = rulePath.endsWith('$');
  // An unanchored rule is a prefix match, which is the same as a trailing "*".
  const pattern = anchored ? rulePath.slice(0, -1) : `${rulePath}*`;
  let p = 0;
  let s = 0;
  let star = -1;
  let resume = 0;
  while (s < path.length) {
    if (p < pattern.length && pattern[p] !== '*' && pattern[p] === path[s]) {
      p++;
      s++;
    } else if (p < pattern.length && pattern[p] === '*') {
      star = p++;
      resume = s;
    } else if (star !== -1) {
      p = star + 1;
      s = ++resume;
    } else return false;
  }
  while (p < pattern.length && pattern[p] === '*') p++;
  return p === pattern.length;
}

/**
 * Groups that apply to a bot (RFC 9309 section 2.2.1): every group whose product token equals the bot's,
 * case-insensitively, merged; otherwise the "*" groups. Tokens are compared whole, so a group for
 * "Applebot" does not apply to "Applebot-Extended".
 */
export function groupsFor(robots: Robots, bot: string): RobotsGroup[] {
  const b = productToken(bot);
  const exact = robots.groups.filter((g) => g.agents.includes(b));
  if (exact.length) return exact;
  return robots.groups.filter((g) => g.agents.includes('*'));
}

export interface BotVerdict {
  allowed: boolean;
  /** The rule that decided it, or why. */
  reason: string;
  /** Whether a group names this bot explicitly. */
  explicit: boolean;
}

/** Longest matching rule wins; on a tie, allow wins (Google/RFC 9309 behaviour). */
export function isAllowed(robots: Robots, bot: string, path: string): BotVerdict {
  const groups = groupsFor(robots, bot);
  const explicit = groups.some((g) => g.agents.some((a) => a !== '*'));
  const rules = groups.flatMap((g) => g.rules);
  let best: { allow: boolean; path: string } | null = null;
  for (const rule of rules) {
    const r = { allow: rule.allow, path: encodeRule(rule.path) };
    if (!r.path || !ruleMatches(r.path, path)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  if (!best) return { allowed: true, reason: groups.length ? 'no matching rule' : 'no group applies', explicit };
  return { allowed: best.allow, reason: `${best.allow ? 'Allow' : 'Disallow'}: ${best.path}`, explicit };
}

export interface BotInfo {
  name: string;
  owner: string;
  role: 'search' | 'answer' | 'training' | 'user-fetch';
  /** What blocking it costs you. */
  impact: 'fail' | 'warn' | 'info';
}

export const AI_BOTS: BotInfo[] = [
  { name: 'Googlebot', owner: 'Google Search + AI Overviews', role: 'search', impact: 'fail' },
  { name: 'Bingbot', owner: 'Bing, and ChatGPT search via the Bing index', role: 'search', impact: 'fail' },
  { name: 'OAI-SearchBot', owner: 'ChatGPT search', role: 'answer', impact: 'fail' },
  { name: 'ChatGPT-User', owner: 'ChatGPT browsing on a user request', role: 'user-fetch', impact: 'warn' },
  { name: 'PerplexityBot', owner: 'Perplexity answers', role: 'answer', impact: 'warn' },
  { name: 'Claude-SearchBot', owner: 'Claude search', role: 'answer', impact: 'warn' },
  { name: 'GPTBot', owner: 'OpenAI training', role: 'training', impact: 'info' },
  { name: 'ClaudeBot', owner: 'Anthropic training', role: 'training', impact: 'info' },
  { name: 'Google-Extended', owner: 'Gemini training and grounding', role: 'training', impact: 'info' },
  { name: 'Applebot-Extended', owner: 'Apple Intelligence training', role: 'training', impact: 'info' },
  { name: 'CCBot', owner: 'Common Crawl (feeds many models)', role: 'training', impact: 'info' },
];
