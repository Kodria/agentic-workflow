import fs from 'fs';
import os from 'os';
import path from 'path';

import { preflight } from '../../../src/commands/preflight/checks';
import { exitCodeFor, formatReport } from '../../../src/commands/preflight';

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

    it('tells the operator not to hand a broken harness to an unattended run', () => {
        const out = formatReport({
            status: 'not_configured',
            checks: [{ id: 'manifest', ok: false, detail: 'no .awm/sensors.json', remedy: 'run `awm sensors init`' }],
        });

        expect(out).toContain('unattended');
        expect(out).toContain('awm sensors init');
    });
});
