import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { beforeAll, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
// Bundled into node_modules/.cache so dependency resolution still finds the repo's node_modules.
const cli = `${root}node_modules/.cache/crawlsee-test/cli.mjs`;

beforeAll(async () => {
  await build({
    entryPoints: [`${root}src/cli.ts`],
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    outfile: cli,
    logLevel: 'silent',
  });
});

const run = (...args: string[]) =>
  spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });

describe('cli', () => {
  it('prints the version', () => {
    const r = run('--version');
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('prints help without promising an unpublished npx package', () => {
    const r = run('--help');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('--fail-under <n>');
    expect(r.stdout).not.toContain('npx crawlsee');
    expect(r.stdout).not.toContain('npm i -g playwright');
  });

  it('analyzes a saved HTML file offline', () => {
    const r = run('--html', 'test/fixtures/glued-h1.html');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('H1 has glued words');
  });

  it('prints valid JSON with --json', () => {
    const r = run('--html', 'test/fixtures/zero-counters.html', '--json');
    expect(JSON.parse(r.stdout).sections.find((s: { id: string }) => s.id === 'counters').score).toBe(0);
  });

  it('exits 1 when the score is under --fail-under', () => {
    expect(run('--html', 'test/fixtures/zero-counters.html', '--fail-under', '99').status).toBe(1);
  });

  it.each([
    [['--timeout', 'abc', 'x.com'], /--timeout expects a number/],
    [['--fail-under', '101', 'x.com'], /--fail-under expects a number from 0 to 100/],
    [['--bogus'], /Unknown option '--bogus'/],
    [[], /missing <url>/],
    [['--html', 'does-not-exist.html'], /cannot read does-not-exist.html: ENOENT/],
    [['ftp://example.com'], /only http and https/],
  ])('rejects bad input %j with exit 2', (args, message) => {
    const r = run(...args);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(message);
  });
});
