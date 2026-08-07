import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync, execSync } from 'child_process';

import { preflight } from '../../../src/commands/preflight/checks';
import { exitCodeFor, formatReport } from '../../../src/commands/preflight';

// Only `execSync` (used by `resolveOnPath` to check for `gh`/`glab`) is mocked — `git
// remote get-url origin` runs for real via `execFileSync` against real tmpdir git repos,
// same as every other check in this file exercises the real filesystem.
jest.mock('child_process', () => ({
    ...jest.requireActual('child_process'),
    execSync: jest.fn(),
}));
const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;

/** Turn a tmpdir into a real git repo with (optionally) an `origin` remote. */
function gitRepo(dir: string, remoteUrl?: string): void {
    execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
    if (remoteUrl) execFileSync('git', ['remote', 'add', 'origin', remoteUrl], { cwd: dir, stdio: 'pipe' });
}

/** CLAUDE.md: no test may reach the real ~/.awm. Everything here is a tmpdir. */
function project(opts: {
    context?: string[];
    manifest?: unknown;
    /** Fake local binaries, as `node_modules/.bin/<name>`. */
    bins?: string[];
    files?: string[];
} = {}): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-preflight-'));
    for (const f of opts.context ?? ['AGENTS.md']) fs.writeFileSync(path.join(dir, f), '# ctx\n');
    for (const f of opts.files ?? []) {
        fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
        fs.writeFileSync(path.join(dir, f), '');
    }
    for (const b of opts.bins ?? []) {
        fs.mkdirSync(path.join(dir, 'node_modules', '.bin'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'node_modules', '.bin', b), '');
    }
    if (opts.manifest !== undefined) {
        fs.mkdirSync(path.join(dir, '.awm'), { recursive: true });
        fs.writeFileSync(
            path.join(dir, '.awm', 'sensors.json'),
            typeof opts.manifest === 'string' ? opts.manifest : JSON.stringify(opts.manifest),
        );
    }
    return dir;
}

const dirs: string[] = [];
const make = (o?: Parameters<typeof project>[0]) => { const d = project(o); dirs.push(d); return d; };
afterAll(() => dirs.forEach(d => fs.rmSync(d, { recursive: true, force: true })));

const check = (r: ReturnType<typeof preflight>, id: string) => r.checks.find(c => c.id === id)!;

describe('preflight', () => {
    it('reports not_configured when no sensor manifest exists', () => {
        // The team-rollout case: a developer clones the repo and never runs
        // `awm sensors init`. Today nothing notices until an unattended run is already
        // in flight and every quality phase is consuming a gate that certifies nothing.
        const dir = make();

        const report = preflight(dir);

        expect(report.status).toBe('not_configured');
        expect(check(report, 'manifest').ok).toBe(false);
    });

    it('keeps not_configured and degraded apart', () => {
        // "You never set this up" and "you set it up and it broke" need different
        // remedies. Collapsing them is how an absent check reads as a passing one.
        const never = make();
        const broken = make({
            manifest: { pack: 'js-ts', sensors: { lint: { cmd: 'npx eslint .' } } },   // no local eslint
        });

        expect(preflight(never).status).toBe('not_configured');
        expect(preflight(broken).status).toBe('degraded');
    });

    it('is ready when the declared sensors can actually run', () => {
        const dir = make({
            manifest: { pack: 'js-ts', sensors: { lint: { cmd: 'npx eslint .' } } },
            bins: ['eslint'],
            files: ['package.json'],
        });

        const report = preflight(dir);

        expect(report.status).toBe('ready');
        expect(exitCodeFor(report)).toBe(0);
    });

    it('catches a sensor whose tool is not installed locally', () => {
        // This is the check that existed and nothing in the flow was calling.
        const dir = make({
            manifest: { pack: 'js-ts', sensors: { lint: { cmd: 'npx eslint .' } } },
            files: ['package.json'],
        });

        const report = preflight(dir);

        expect(report.status).toBe('degraded');
        expect(check(report, 'tools').detail).toContain('eslint');
    });

    it('accepts a deliberate opt-out, but only when it is written down', () => {
        // A repo may legitimately have no sensors — it just has to SAY so in a committed
        // file, so "we decided not to gate this" cannot be mistaken for "nobody set it up".
        const optedOut = make({
            manifest: { pack: 'generic', sensors: { security: { cmd: 'semgrep .', enabled: false } } },
        });

        const report = preflight(optedOut);

        expect(report.status).toBe('ready');
        expect(check(report, 'manifest').detail).toContain('opt-out');
    });

    it('flags a manifest stuck on generic while the tree has a real stack', () => {
        // The gate would run, report green, and have checked almost nothing.
        const dir = make({
            manifest: { pack: 'generic', sensors: {} },
            files: ['package.json'],
        });

        const report = preflight(dir);

        expect(report.status).toBe('degraded');
        expect(check(report, 'pack').ok).toBe(false);
    });

    it('flags a repo with no context contract at all', () => {
        const dir = make({
            context: [],
            manifest: { pack: 'generic', sensors: {} },
        });

        expect(check(preflight(dir), 'context').ok).toBe(false);
    });

    it('treats an unparseable manifest as a failure, not as absent', () => {
        const dir = make({ manifest: '{ not json' });

        const report = preflight(dir);

        expect(report.status).toBe('degraded');
        expect(check(report, 'manifest').detail).toContain('not valid JSON');
    });

    it('exits non-zero for anything but ready, so the caller need not parse JSON', () => {
        // Unlike `awm sensors run` — which exits 0 on not_certified because exit 2 blocks
        // Claude Code hooks — preflight is never a hook, so the verdict rides the exit code
        // instead of depending on every agent remembering to read a field.
        expect(exitCodeFor({ status: 'not_configured', checks: [] })).toBe(1);
        expect(exitCodeFor({ status: 'degraded', checks: [] })).toBe(1);
        expect(exitCodeFor({ status: 'ready', checks: [] })).toBe(0);
    });

    describe('host check (advisory — never changes the exit code)', () => {
        beforeEach(() => { mockExecSync.mockReset(); });

        it('reports github + gh available, and does not affect status', () => {
            const dir = make({ manifest: { pack: 'generic', sensors: {} } });
            gitRepo(dir, 'git@github.com:kodria/agentic-workflow.git');
            mockExecSync.mockImplementation(((cmd: string) => {
                if (cmd === 'command -v gh') return Buffer.from('/usr/bin/gh');
                throw new Error(`not found: ${cmd}`);
            }) as typeof execSync);

            const report = preflight(dir);

            expect(check(report, 'host').ok).toBe(true);
            expect(check(report, 'host').detail).toBe('github detected, gh available');
            expect(report.status).toBe('ready');
        });

        it('is still ok:true (advisory only) when gitlab is detected but glab is not on PATH, and status stays ready', () => {
            // The only thing "wrong" in this fixture is the missing `glab` — proving the
            // advisory contract: it must not drag an otherwise-clean repo to `degraded`.
            const dir = make({ manifest: { pack: 'generic', sensors: {} } });
            gitRepo(dir, 'https://gitlab.com/kodria/agentic-workflow.git');
            mockExecSync.mockImplementation((() => {
                throw new Error('not found');
            }) as typeof execSync);

            const report = preflight(dir);

            expect(check(report, 'host').ok).toBe(true);
            expect(check(report, 'host').detail).toContain('glab not on PATH');
            expect(check(report, 'host').remedy).toContain('glab');
            expect(report.status).toBe('ready');
        });

        it('handles no origin remote gracefully — no throw, ok:true, minimal detail', () => {
            const dir = make({ manifest: { pack: 'generic', sensors: {} } });
            // Not a git repo at all — the common case for `execFileSync` failing here.

            const report = preflight(dir);

            expect(check(report, 'host').ok).toBe(true);
            expect(check(report, 'host').detail).toBe('no git remote detected — PR/MR automation not applicable');
            expect(check(report, 'host').remedy).toBeUndefined();
            expect(report.status).toBe('ready');
        });

        it('handles a git repo with no origin remote configured gracefully', () => {
            const dir = make({ manifest: { pack: 'generic', sensors: {} } });
            gitRepo(dir); // git init, no remote

            const report = preflight(dir);

            expect(check(report, 'host').ok).toBe(true);
            expect(check(report, 'host').detail).toContain('no git remote detected');
        });

        it('does not overclaim support for an unrecognized host', () => {
            const dir = make({ manifest: { pack: 'generic', sensors: {} } });
            gitRepo(dir, 'git@bitbucket.org:kodria/agentic-workflow.git');

            const report = preflight(dir);

            expect(check(report, 'host').ok).toBe(true);
            expect(check(report, 'host').detail).toContain('not recognized');
            expect(report.status).toBe('ready');
        });
    });

    it('tells the operator not to hand a broken harness to an unattended run', () => {
        const out = formatReport({
            status: 'not_configured',
            checks: [{ id: 'manifest', ok: false, detail: 'no .awm/sensors.json', remedy: 'run `awm sensors init`' }],
        });

        expect(out).toContain('unattended');
        expect(out).toContain('awm sensors init');
    });
});
