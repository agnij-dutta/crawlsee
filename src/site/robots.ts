export interface RobotsGroup {
  agents: string[];
  rules: { allow: boolean; path: string }[];
}

export interface Robots {
  groups: RobotsGroup[];
  sitemaps: string[];
}

export function parseRobots(txt: string): Robots {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (key === 'allow' || key === 'disallow') {
      lastWasAgent = false;
      if (!current) continue;
      if (key === 'disallow' && value === '') continue; // empty disallow = allow all
      current.rules.push({ allow: key === 'allow', path: value });
    } else if (key === 'sitemap') {
      sitemaps.push(value);
    } else {
      lastWasAgent = false;
    }
  }
  return { groups, sitemaps };
}

function ruleMatches(rulePath: string, path: string): boolean {
  const anchored = rulePath.endsWith('$');
  const body = anchored ? rulePath.slice(0, -1) : rulePath;
  const re = body
    .split('*')
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${re}${anchored ? '$' : ''}`).test(path);
}

/** Groups that apply to a bot: the most specific matching user-agent groups, else `*` (RFC 9309). */
export function groupsFor(robots: Robots, bot: string): RobotsGroup[] {
  const b = bot.toLowerCase();
  const exact = robots.groups.filter((g) => g.agents.includes(b));
  if (exact.length) return exact;
  const specific = robots.groups.filter((g) => g.agents.some((a) => a !== '*' && a.length >= 4 && b.startsWith(a)));
  if (specific.length) return specific;
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
  for (const r of rules) {
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
