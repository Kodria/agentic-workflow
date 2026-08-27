import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync, execSync } from 'child_process';

import { preflight } from '../../../src/commands/preflight/checks';
import { exitCodeFor, formatReport } from '../../../src/commands/preflight';
import { runSensors } from '../../../src/commands/sensors/run';
import { checkCurrentness } from '../../../src/core/currentness/check';

// Only `execSync` (used by `resolveOnPath` to check for `gh`/`glab`) is mocked — `git
// remote get-url origin` runs for real via `execFileSync` against real tmpdir git repos,
// same as every other check in this file exercises the real filesystem.
jest.mock('child_process', () => ({
    ...jest.requireActual('child_process'),
    execSync: jest.fn(),
}));
jest.mock('../../../src/commands/sensors/run', () => ({
    ...jest.requireActual('../../../src/commands/sensors/run'),
    runSensors: jest.fn(),
}));
jest.mock('../../../src/core/currentness/check', () => ({
    checkCurrentness: jest.fn(),
}));
const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;
const mockRunSensors = runSensors as jest.MockedFunction<typeof runSensors>;
const mockCheckCurrentness = checkCurrentness as jest.MockedFunction<typeof checkCurrentness>;

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

let previousAwmHome: string | undefined;
const awmHomes: string[] = [];
beforeEach(() => {
    previousAwmHome = process.env.AWM_HOME;
    const awmHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-preflight-home-'));
    awmHomes.push(awmHome);
    process.env.AWM_HOME = awmHome;
});
afterEach(() => {
    if (previousAwmHome === undefined) delete process.env.AWM_HOME;
    else process.env.AWM_HOME = previousAwmHome;
});
afterAll(() => awmHomes.forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));

function installRegistry(manifest: Record<string, unknown>, name = 'test-registry'): void {
    const awmHome = process.env.AWM_HOME!;
    const root = path.join(awmHome, 'registries', name);
    fs.mkdirSync(path.join(root, 'skills'), { recursive: true });
    const config = fs.existsSync(path.join(awmHome, 'registries.json'))
        ? JSON.parse(fs.readFileSync(path.join(awmHome, 'registries.json'), 'utf8'))
        : [];
    config.push({ name, remote: `https://example.invalid/${name}.git` });
    fs.writeFileSync(path.join(awmHome, 'registries.json'), JSON.stringify(config));
    fs.writeFileSync(path.join(root, 'awm-registry.json'), JSON.stringify(manifest));
}

function writeValidKernel(dir: string): void {
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), '<!-- AWM:CONTEXT-KERNEL:START v1 -->\nagent rules\n<!-- AWM:CONTEXT-KERNEL:END v1 -->\n');
    fs.writeFileSync(path.join(dir, 'CONSTITUTION.md'), '<!-- AWM:CONTEXT-KERNEL:START v1 -->\n<!-- awm-context:CTX-PROCESS-001 -->\nprocess rules\n<!-- AWM:CONTEXT-KERNEL:END v1 -->\n');
    const card = path.join(dir, 'docs', 'awm', 'context', 'releases.md');
    fs.mkdirSync(path.dirname(card), { recursive: true });
    fs.writeFileSync(card, '<!-- awm-context:CTX-RELEASE-001 -->\nrelease rules\n');
    fs.mkdirSync(path.join(dir, '.awm', 'context'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.awm', 'context', 'index.json'), JSON.stringify({
        schema: 1,
        kernelFiles: ['AGENTS.md', 'CONSTITUTION.md'],
        maxFixedBytes: 33_740,
        entries: [
            { id: 'CTX-PROCESS-001', tier: 'kernel', path: 'CONSTITUTION.md', anchor: 'awm-context:CTX-PROCESS-001', when: 'always' },
            { id: 'CTX-RELEASE-001', tier: 'selective', path: 'docs/awm/context/releases.md', anchor: 'awm-context:CTX-RELEASE-001', when: 'release automation' },
        ],
    }));
}

function writePartialKernel(dir: string): void {
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), '<!-- AWM:CONTEXT-KERNEL:START v1 -->\nagent rules\n');
}

const check = (r: Awaited<ReturnType<typeof preflight>>, id: string) => r.checks.find(c => c.id === id)!;

describe('preflight', () => {
    beforeEach(() => {
        mockCheckCurrentness.mockResolvedValue({
            checkedAt: '2026-08-26T00:00:00.000Z',
            compatibility: { status: 'not-checked' },
            components: [{
                component: 'cli', installed: '9.3.0', latest: '9.3.0', channel: 'stable',
                source: 'https://registry.npmjs.org/agentic-workflow-manager',
                checkedAt: '2026-08-26T00:00:00.000Z', status: 'current',
                detail: 'Installed version matches npm dist-tags.latest.', remedy: 'No action required.',
            }],
        });
    });

    afterEach(() => {
        mockRunSensors.mockReset();
        mockCheckCurrentness.mockReset();
    });

    it('does not add a row when no registry declares the schema', async () => {
        installRegistry({ minCliVersion: '9.2.1' });
        const report = await preflight(make({
            manifest: { pack: 'generic', sensors: { security: { enabled: false } } },
        }));

        expect(report.checks.map(c => c.id)).not.toContain('context-kernel');
    });

    it('blocks preflight when an active registry declares an invalid context kernel schema', async () => {
        installRegistry({ projectContextSchema: 2 });
        const report = await preflight(make({
            manifest: { pack: 'generic', sensors: { security: { enabled: false } } },
        }));

        expect(report.status).toBe('degraded');
        expect(exitCodeFor(report)).toBe(1);
        expect(check(report, 'context-kernel')).toMatchObject({
            ok: false,
            advisory: false,
            detail: expect.stringMatching(/projectContextSchema.*exactly 1.*2/),
        });
    });

    it('fails closed when an earlier active registry manifest is malformed before a valid declaration', async () => {
        installRegistry({ projectContextSchema: 2 }, 'malformed');
        installRegistry({ projectContextSchema: 1 }, 'valid');

        const report = await preflight(make({
            manifest: { pack: 'generic', sensors: { security: { enabled: false } } },
        }));

        expect(report.status).toBe('degraded');
        expect(exitCodeFor(report)).toBe(1);
        expect(check(report, 'context-kernel')).toMatchObject({
            ok: false,
            advisory: false,
            detail: expect.stringMatching(/malformed.*awm-registry\.json.*projectContextSchema.*exactly 1/i),
        });
    });

    it('keeps legacy ready but renders a persistent warning and remedy', async () => {
        installRegistry({ projectContextSchema: 1 });
        const report = await preflight(make({
            manifest: { pack: 'generic', sensors: { security: { enabled: false } } },
        }));

        expect(report.status).toBe('ready');
        expect(report.checks).toContainEqual(expect.objectContaining({
            id: 'context-kernel', ok: false, advisory: true,
            detail: expect.stringMatching(/legacy full context/),
            remedy: expect.stringMatching(/project-context-init/),
        }));
        expect(formatReport(report)).toMatch(/⚠.*context-kernel.*legacy full context/s);
        expect(exitCodeFor(report)).toBe(0);
        expect(JSON.parse(JSON.stringify(report))).toEqual(expect.objectContaining({
            status: 'ready',
            checks: expect.arrayContaining([expect.objectContaining({
                id: 'context-kernel', ok: false, advisory: true,
                detail: expect.any(String), remedy: expect.any(String),
            })]),
        }));
    });

    it('keeps an unconfigured legacy project not_configured while the context kernel remains advisory', async () => {
        installRegistry({ projectContextSchema: 1 });

        const report = await preflight(make());

        expect(report.status).toBe('not_configured');
        expect(check(report, 'manifest')).toMatchObject({ ok: false, detail: 'no .awm/sensors.json' });
        expect(check(report, 'context-kernel')).toMatchObject({
            ok: false,
            advisory: true,
            detail: expect.stringMatching(/legacy full context/),
        });
        expect(exitCodeFor(report)).toBe(1);
    });

    it('passes a valid kernel', async () => {
        installRegistry({ projectContextSchema: 1 });
        const dir = make({ manifest: { pack: 'generic', sensors: { security: { enabled: false } } } });
        writeValidKernel(dir);

        const report = await preflight(dir);

        expect(report).toEqual(expect.objectContaining({ status: 'ready' }));
        expect(check(report, 'context-kernel')).toMatchObject({ ok: true });
        expect(check(report, 'context-kernel')).not.toHaveProperty('advisory');
    });

    it('degrades partial or invalid migration', async () => {
        installRegistry({ projectContextSchema: 1 });
        const dir = make({ manifest: { pack: 'generic', sensors: { security: { enabled: false } } } });
        writePartialKernel(dir);

        const report = await preflight(dir);

        expect(report.status).toBe('degraded');
        expect(exitCodeFor(report)).toBe(1);
        expect(report.checks).toContainEqual(expect.objectContaining({
            id: 'context-kernel', advisory: false, ok: false,
        }));
        expect(formatReport(report)).toMatch(/Harness degraded — it has blocking preflight failures\./);
        expect(formatReport(report)).not.toMatch(/declares sensors it cannot run/);
    });

    it('degrades an invalid kernel even when no sensor manifest exists', async () => {
        installRegistry({ projectContextSchema: 1 });
        const dir = make();
        writePartialKernel(dir);

        const report = await preflight(dir);

        expect(report.status).toBe('degraded');
        expect(check(report, 'manifest')).toMatchObject({ ok: false, detail: 'no .awm/sensors.json' });
        expect(check(report, 'context-kernel')).toMatchObject({ ok: false, advisory: false });
        expect(exitCodeFor(report)).toBe(1);
    });

    it('keeps default preflight static and does not dispatch sensors', async () => {
        const dir = make({
            manifest: { pack: 'generic', sensors: { security: { enabled: false } } },
        });

        await preflight(dir);

        expect(mockRunSensors).not.toHaveBeenCalled();
        expect(mockCheckCurrentness).not.toHaveBeenCalled();
    });

    it('adds authoritative currentness only when strict mode is explicitly requested', async () => {
        const dir = make({ manifest: { pack: 'generic', sensors: { security: { enabled: false } } } });

        const report = await preflight(dir, { requireCurrent: true });

        expect(mockCheckCurrentness).toHaveBeenCalledWith(dir);
        expect(report).toMatchObject({
            status: 'ready',
            currentness: expect.objectContaining({
                components: [expect.objectContaining({ component: 'cli', status: 'current' })],
            }),
        });
        expect(report.checks).toContainEqual(expect.objectContaining({ id: 'currentness', ok: true }));
        expect(formatReport(report)).toContain('Currentness: current');
        expect(JSON.parse(JSON.stringify(report))).toHaveProperty('currentness.components');
    });

    it('returns a complete strict report instead of throwing for a malformed local registry inventory', async () => {
        fs.writeFileSync(path.join(process.env.AWM_HOME!, 'registries.json'), '{not-json');
        mockCheckCurrentness.mockResolvedValue({
            checkedAt: '2026-08-26T00:00:00.000Z', compatibility: { status: 'not-checked' },
            components: [{
                component: 'registry:inventory', installed: null, latest: null, channel: 'stable',
                source: '[configured registry inventory]', checkedAt: '2026-08-26T00:00:00.000Z', status: 'unverifiable',
                detail: 'Authoritative currentness could not be verified.',
                remedy: 'Repair the local registry inventory and rerun strict preflight.',
            }],
        });

        const report = await preflight(make({ manifest: { pack: 'generic', sensors: { security: { enabled: false } } } }), { requireCurrent: true });

        expect(report.status).toBe('degraded');
        expect(report.currentness?.components).toEqual(expect.arrayContaining([
            expect.objectContaining({ component: 'registry:inventory', status: 'unverifiable', remedy: expect.stringMatching(/Repair the local registry inventory/) }),
        ]));
        expect(JSON.parse(JSON.stringify(report))).toHaveProperty('currentness.components');
    });

    it.each(['stale', 'pinned-behind', 'unverifiable'] as const)('fails strict preflight for a %s component with its exact remedy', async (status) => {
        const dir = make({ manifest: { pack: 'generic', sensors: { security: { enabled: false } } } });
        mockCheckCurrentness.mockResolvedValue({
            checkedAt: '2026-08-26T00:00:00.000Z', compatibility: { status: 'not-checked' },
            components: [{
                component: 'registry:baseline', installed: 'v1.0.0', latest: 'v1.1.0', channel: 'stable',
                source: 'https://example.test/baseline.git', checkedAt: '2026-08-26T00:00:00.000Z', status,
                detail: 'Authoritative currentness failed.',
                remedy: status === 'pinned-behind' ? 'awm unpin baseline && awm update --yes' : 'awm update --yes',
            }],
        });

        const report = await preflight(dir, { requireCurrent: true });

        expect(report.status).toBe('degraded');
        expect(exitCodeFor(report)).toBe(1);
        expect(report.checks).toContainEqual(expect.objectContaining({ id: 'currentness', ok: false }));
        expect(formatReport(report)).toContain(status === 'pinned-behind' ? 'awm unpin baseline && awm update --yes' : 'awm update --yes');
    });

    it('keeps compatibility failure distinct when authoritative currentness is current', async () => {
        installRegistry({ minCliVersion: '999.0.0' }, 'requires-new-cli');
        const dir = make({ manifest: { pack: 'generic', sensors: { security: { enabled: false } } } });

        const report = await preflight(dir, { requireCurrent: true });

        expect(report.status).toBe('degraded');
        expect(report.checks).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'compatibility', ok: false, detail: expect.stringContaining('requires-new-cli requires CLI >= 999.0.0') }),
            expect.objectContaining({ id: 'currentness', ok: true }),
        ]));
    });

    it('retains both empirical sensor and currentness verdicts when both gates are requested', async () => {
        const dir = make({ manifest: { pack: 'generic', sensors: { security: { enabled: false } } } });
        mockRunSensors.mockResolvedValue({ overall: 'pass', sensors: [] });

        const report = await preflight(dir, { verifySensors: true, requireCurrent: true });

        expect(mockRunSensors).toHaveBeenCalledWith({ cwd: dir, all: true });
        expect(mockCheckCurrentness).toHaveBeenCalledWith(dir);
        expect(report.checks).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'sensors-execution', ok: true }),
            expect.objectContaining({ id: 'currentness', ok: true }),
        ]));
    });

    it('rejects an array passed as public preflight options before filesystem work', async () => {
        await expect(preflight(process.cwd(), [] as unknown as { verifySensors?: boolean }))
            .rejects.toThrow('preflight options must contain optional boolean verifySensors and requireCurrent');
    });

    it('requires an empirical sensor pass when verification is requested', async () => {
        const dir = make({
            manifest: { pack: 'generic', sensors: { security: { enabled: false } } },
        });
        mockRunSensors.mockResolvedValue({
            overall: 'not_certified',
            sensors: [{
                name: 'lint', status: 'inconclusive', errors: [], skipReason: 'timeout after 30000ms',
                execution: { timeoutMs: 30000, timeoutSource: 'project', elapsedMs: 30012, requestedScope: 'full', effectiveScope: 'full' },
            }],
        });

        const report = await preflight(dir, { verifySensors: true });

        expect(mockRunSensors).toHaveBeenCalledWith({ cwd: dir, all: true });
        expect(report.status).toBe('degraded');
        expect(check(report, 'sensors-execution')).toMatchObject({
            ok: false,
            detail: expect.stringMatching(/lint.*30000ms.*elapsed.*timeout/i),
        });
    });

    it('does not invent a sensor or timeout when empirical verification has no executed sensors', async () => {
        const dir = make();
        mockRunSensors.mockResolvedValue({ overall: 'not_certified', sensors: [] });

        const report = await preflight(dir, { verifySensors: true });
        const execution = check(report, 'sensors-execution');

        expect(execution).toMatchObject({
            ok: false,
            detail: 'sensor verdict was not_certified; no sensor established an empirical pass',
        });
        expect(execution.detail).not.toMatch(/timeout|elapsed|named sensor/i);
        expect(execution.remedy).toContain('awm sensors init');
        expect(execution.remedy).not.toContain('named sensor');
    });

    it('reports not_configured when no sensor manifest exists', async () => {
        // The team-rollout case: a developer clones the repo and never runs
        // `awm sensors init`. Today nothing notices until an unattended run is already
        // in flight and every quality phase is consuming a gate that certifies nothing.
        const dir = make();

        const report = await preflight(dir);

        expect(report.status).toBe('not_configured');
        expect(check(report, 'manifest').ok).toBe(false);
    });

    it('keeps not_configured and degraded apart', async () => {
        // "You never set this up" and "you set it up and it broke" need different
        // remedies. Collapsing them is how an absent check reads as a passing one.
        const never = make();
        const broken = make({
            manifest: { pack: 'js-ts', sensors: { lint: { cmd: 'npx eslint .' } } },   // no local eslint
        });

        expect((await preflight(never)).status).toBe('not_configured');
        expect((await preflight(broken)).status).toBe('degraded');
    });

    it('is ready when the declared sensors can actually run', async () => {
        const dir = make({
            manifest: { pack: 'js-ts', sensors: { lint: { cmd: 'npx eslint .' } } },
            bins: ['eslint'],
            files: ['package.json'],
        });

        const report = await preflight(dir);

        expect(report.status).toBe('ready');
        expect(exitCodeFor(report)).toBe(0);
    });

    it('catches a sensor whose tool is not installed locally', async () => {
        // This is the check that existed and nothing in the flow was calling.
        const dir = make({
            manifest: { pack: 'js-ts', sensors: { lint: { cmd: 'npx eslint .' } } },
            files: ['package.json'],
        });

        const report = await preflight(dir);

        expect(report.status).toBe('degraded');
        expect(check(report, 'tools').detail).toContain('eslint');
    });

    it('accepts a deliberate opt-out, but only when it is written down', async () => {
        // A repo may legitimately have no sensors — it just has to SAY so in a committed
        // file, so "we decided not to gate this" cannot be mistaken for "nobody set it up".
        const optedOut = make({
            manifest: { pack: 'generic', sensors: { security: { cmd: 'semgrep .', enabled: false } } },
        });

        const report = await preflight(optedOut);

        expect(report.status).toBe('ready');
        expect(check(report, 'manifest').detail).toContain('opt-out');
    });

    it('flags a manifest with zero sensor entries as degraded, distinct from a deliberate opt-out', async () => {
        // Genuinely different manifest shape from the opt-out test above: no sensor
        // NAMES at all, vs. an opt-out which lists every known sensor explicitly with
        // `enabled: false`. This is the honest-floor case from init.ts — the registry
        // had no pack.json for the detected stack — and must never read as "opted out".
        const noPack = make({
            manifest: { pack: 'python', sensors: {} },
        });

        const report = await preflight(noPack);

        expect(report.status).toBe('degraded');
        expect(check(report, 'manifest').ok).toBe(false);
        expect(check(report, 'manifest').detail).not.toContain('opt-out');
        expect(check(report, 'manifest').detail).toContain('python');
        expect(check(report, 'manifest').remedy).toContain('python');
    });

    it('flags the tools check as failing (not "0/0 runnable") for a manifest with zero sensor entries', async () => {
        // Regression for Finding 6: `checkTools` independently inspects
        // `status.checks`, which is also `{}` for a zero-sensor manifest —
        // `Object.entries({}).filter(...)` is vacuously `[]`, so before the fix this
        // read as "0 broken out of 0 sensors" -> ok: true, a clean pass for a manifest
        // that checks nothing at all. `checkManifest`'s own `total === 0` gate happens
        // to also catch this exact manifest shape and keeps overall status degraded —
        // but `checkTools` must defend the same invariant on its own.
        const noPack = make({
            manifest: { pack: 'python', sensors: {} },
        });

        const report = await preflight(noPack);

        expect(check(report, 'tools').ok).toBe(false);
        expect(report.status).toBe('degraded');
    });

    it('flags a manifest stuck on generic while the tree has a real stack', async () => {
        // The gate would run, report green, and have checked almost nothing.
        const dir = make({
            manifest: { pack: 'generic', sensors: {} },
            files: ['package.json'],
        });

        const report = await preflight(dir);

        expect(report.status).toBe('degraded');
        expect(check(report, 'pack').ok).toBe(false);
    });

    it('flags a repo with no context contract at all', async () => {
        const dir = make({
            context: [],
            manifest: { pack: 'generic', sensors: {} },
        });

        expect(check(await preflight(dir), 'context').ok).toBe(false);
    });

    it('treats an unparseable manifest as a failure, not as absent', async () => {
        const dir = make({ manifest: '{ not json' });

        const report = await preflight(dir);

        expect(report.status).toBe('degraded');
        expect(check(report, 'manifest').detail).toContain('not valid JSON');
    });

    it('exits non-zero for anything but ready, so the caller need not parse JSON', async () => {
        // Unlike `awm sensors run` — which exits 0 on not_certified because exit 2 blocks
        // Claude Code hooks — preflight is never a hook, so the verdict rides the exit code
        // instead of depending on every agent remembering to read a field.
        expect(exitCodeFor({ status: 'not_configured', checks: [] })).toBe(1);
        expect(exitCodeFor({ status: 'degraded', checks: [] })).toBe(1);
        expect(exitCodeFor({ status: 'ready', checks: [] })).toBe(0);
    });

    describe('host check (advisory — never changes the exit code)', () => {
        // Fixtures below use a non-empty, deliberately-opted-out manifest (one sensor
        // entry, `enabled: false`), not `sensors: {}` — the host check is orthogonal to
        // sensor configuration, and an empty sensors object now fails `checkManifest`
        // (see the `total === 0` branch), which would drag `report.status` off 'ready'
        // for reasons unrelated to what these tests exercise.
        // `resolveOnPath` resuelve PATH en proceso (ya no invoca un shell — ver la
        // nota de seguridad en core/paths.ts), asi que la disponibilidad de `gh`/
        // `glab` se simula con un PATH aislado, no mockeando `execSync`. Ademas de
        // reflejar el mecanismo real, esto vuelve deterministas los casos de
        // "no esta en PATH", que antes dependian de que la maquina no lo tuviera.
        let pathDir: string;
        let originalPath: string | undefined;
        beforeEach(() => {
            pathDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-preflight-path-'));
            originalPath = process.env.PATH;
            process.env.PATH = pathDir;
        });
        afterEach(() => {
            if (originalPath === undefined) delete process.env.PATH;
            else process.env.PATH = originalPath;
            fs.rmSync(pathDir, { recursive: true, force: true });
        });
        function installOnPath(tool: string) {
            const f = path.join(pathDir, tool);
            fs.writeFileSync(f, '#!/bin/sh\nexit 0\n');
            fs.chmodSync(f, 0o755);
        }

        it('reports github + gh available, and does not affect status', async () => {
            const dir = make({ manifest: { pack: 'generic', sensors: { security: { enabled: false } } } });
            gitRepo(dir, 'git@github.com:kodria/agentic-workflow.git');
            installOnPath('gh');

            const report = await preflight(dir);

            expect(check(report, 'host').ok).toBe(true);
            expect(check(report, 'host').detail).toBe('github detected, gh available');
            expect(report.status).toBe('ready');
        });

        it('is still ok:true (advisory only) when gitlab is detected but glab is not on PATH, and status stays ready', async () => {
            // The only thing "wrong" in this fixture is the missing `glab` — proving the
            // advisory contract: it must not drag an otherwise-clean repo to `degraded`.
            const dir = make({ manifest: { pack: 'generic', sensors: { security: { enabled: false } } } });
            gitRepo(dir, 'https://gitlab.com/kodria/agentic-workflow.git');
            // PATH aislado y vacio => glab no resuelve.

            const report = await preflight(dir);

            expect(check(report, 'host').ok).toBe(true);
            expect(check(report, 'host').detail).toContain('glab not on PATH');
            expect(check(report, 'host').remedy).toContain('glab');
            expect(report.status).toBe('ready');
        });

        it('handles no origin remote gracefully — no throw, ok:true, minimal detail', async () => {
            const dir = make({ manifest: { pack: 'generic', sensors: { security: { enabled: false } } } });
            // Not a git repo at all — the common case for `execFileSync` failing here.

            const report = await preflight(dir);

            expect(check(report, 'host').ok).toBe(true);
            expect(check(report, 'host').detail).toBe('no git remote detected — PR/MR automation not applicable');
            expect(check(report, 'host').remedy).toBeUndefined();
            expect(report.status).toBe('ready');
        });

        it('handles a git repo with no origin remote configured gracefully', async () => {
            const dir = make({ manifest: { pack: 'generic', sensors: { security: { enabled: false } } } });
            gitRepo(dir); // git init, no remote

            const report = await preflight(dir);

            expect(check(report, 'host').ok).toBe(true);
            expect(check(report, 'host').detail).toContain('no git remote detected');
        });

        it('does not overclaim support for an unrecognized host', async () => {
            const dir = make({ manifest: { pack: 'generic', sensors: { security: { enabled: false } } } });
            gitRepo(dir, 'git@bitbucket.org:kodria/agentic-workflow.git');

            const report = await preflight(dir);

            expect(check(report, 'host').ok).toBe(true);
            expect(check(report, 'host').detail).toContain('not recognized');
            expect(report.status).toBe('ready');
        });

        it('does not misclassify a GitHub Enterprise host whose repo NAME contains "gitlab"', async () => {
            // The bug: a bare `remote.includes('gitlab')` matches the full remote URL
            // string, so an org/repo name containing "gitlab" false-positives even though
            // the actual host is unrelated. Hostname must be extracted first and matched
            // in isolation.
            const dir = make({ manifest: { pack: 'generic', sensors: { security: { enabled: false } } } });
            gitRepo(dir, 'git@github.enterprise.internal:kodria/gitlab-migration-tool.git');

            const report = await preflight(dir);

            expect(check(report, 'host').ok).toBe(true);
            expect(check(report, 'host').detail).toContain('not recognized');
            expect(report.status).toBe('ready');
        });

        it('does not misclassify a non-GitHub host whose repo NAME contains "github"', async () => {
            // Same class of bug on the github side: "something-github-tool" is a repo
            // name, not the host.
            const dir = make({ manifest: { pack: 'generic', sensors: { security: { enabled: false } } } });
            gitRepo(dir, 'https://example.com/kodria/something-github-tool.git');

            const report = await preflight(dir);

            expect(check(report, 'host').ok).toBe(true);
            expect(check(report, 'host').detail).toContain('not recognized');
            expect(report.status).toBe('ready');
        });

        it('does not misclassify a GitHub Enterprise host whose SSH USERNAME is "gitlab"', async () => {
            // The related bug: the scheme-based regex captured everything between
            // `scheme://` and the first `/`, including `userinfo@` — so an SSH username
            // of "gitlab" leaked into the matched "host" string and false-positived the
            // `.includes('gitlab')` check even though the real host is GitHub
            // Enterprise. `new URL(...).hostname` must exclude userinfo entirely.
            //
            // Note: `github.company-internal.com` legitimately contains the substring
            // "github.com" (from "company"), so — with the userinfo bug fixed — this
            // correctly classifies as github (checkHost's own substring matching is a
            // separate, pre-existing design, not part of this fix). The regression this
            // test guards is that it must never again read as gitlab.
            const dir = make({ manifest: { pack: 'generic', sensors: { security: { enabled: false } } } });
            gitRepo(dir, 'ssh://gitlab@github.company-internal.com:22/team/repo.git');
            // PATH real: estos casos no dependen de gh/glab.

            const report = await preflight(dir);

            expect(check(report, 'host').ok).toBe(true);
            expect(check(report, 'host').detail).toContain('github detected');
            expect(check(report, 'host').detail).not.toContain('gitlab');
            expect(report.status).toBe('ready');
        });

        it('does not misclassify a host whose injected credential/token contains "gitlab"', async () => {
            // A realistic CI credential-injection remote:
            // `git remote set-url origin https://x-access-token:$TOKEN@host/...`. If the
            // token or password happens to contain "gitlab", it must not leak into the
            // matched host either.
            const dir = make({ manifest: { pack: 'generic', sensors: { security: { enabled: false } } } });
            gitRepo(dir, 'https://user:gitlab@example-host.com/org/repo.git');

            const report = await preflight(dir);

            expect(check(report, 'host').ok).toBe(true);
            expect(check(report, 'host').detail).toContain('not recognized');
            expect(report.status).toBe('ready');
        });

        it('does not misclassify an SCP-style remote with a second "@" in it', async () => {
            // `user@host:path` shorthand has no scheme for `URL` to parse, so it falls
            // back to a regex. A second "@" (e.g. a malformed/adversarial remote) must
            // not let a bogus "host@evil"-shaped capture slip past the colon check —
            // the host-capture group excludes "@", so this fails to match at all and
            // falls through to "unrecognized" rather than misclassifying as gitlab.
            const dir = make({ manifest: { pack: 'generic', sensors: { security: { enabled: false } } } });
            gitRepo(dir, 'user@github.com@gitlab.evil:org/repo.git');

            const report = await preflight(dir);

            expect(check(report, 'host').ok).toBe(true);
            expect(check(report, 'host').detail).toContain('not recognized');
            expect(report.status).toBe('ready');
        });

        it('still detects github.com over HTTPS', async () => {
            const dir = make({ manifest: { pack: 'generic', sensors: { security: { enabled: false } } } });
            gitRepo(dir, 'https://github.com/org/repo.git');
            // PATH real: estos casos no dependen de gh/glab.

            const report = await preflight(dir);

            expect(check(report, 'host').detail).toContain('github detected');
        });

        it('still detects github.com over SSH shorthand', async () => {
            const dir = make({ manifest: { pack: 'generic', sensors: { security: { enabled: false } } } });
            gitRepo(dir, 'git@github.com:org/repo.git');
            // PATH real: estos casos no dependen de gh/glab.

            const report = await preflight(dir);

            expect(check(report, 'host').detail).toContain('github detected');
        });

        it('still detects gitlab over HTTPS', async () => {
            const dir = make({ manifest: { pack: 'generic', sensors: { security: { enabled: false } } } });
            gitRepo(dir, 'https://gitlab.example.com/org/repo.git');
            // PATH real: estos casos no dependen de gh/glab.

            const report = await preflight(dir);

            expect(check(report, 'host').detail).toContain('gitlab detected');
        });

        it('still detects gitlab over SSH shorthand', async () => {
            const dir = make({ manifest: { pack: 'generic', sensors: { security: { enabled: false } } } });
            gitRepo(dir, 'git@gitlab.example.com:org/repo.git');
            // PATH real: estos casos no dependen de gh/glab.

            const report = await preflight(dir);

            expect(check(report, 'host').detail).toContain('gitlab detected');
        });
    });

    describe('sensors-baseline check (advisory — never changes the exit code)', () => {
        it('nudges toward `awm sensors baseline` when sensors are configured but no baseline exists', async () => {
            // The team-rollout gap this addresses: a legacy repo adopts AWM, sensors get
            // configured, and the ratchet mechanism exists to snapshot pre-existing debt —
            // but nothing tells the operator it's there until they hit a wall of red
            // findings and go looking for it.
            const dir = make({
                manifest: { pack: 'js-ts', sensors: { lint: { cmd: 'npx eslint .' } } },
                bins: ['eslint'],
                files: ['package.json'],
            });

            const report = await preflight(dir);

            expect(check(report, 'sensors-baseline').ok).toBe(true);
            expect(check(report, 'sensors-baseline').detail).toContain('no baseline yet');
            expect(check(report, 'sensors-baseline').remedy).toContain('awm sensors baseline');
            expect(report.status).toBe('ready');
        });

        it('reports the no-advisory-needed state when a baseline already exists, without nudging', async () => {
            const dir = make({
                manifest: { pack: 'js-ts', sensors: { lint: { cmd: 'npx eslint .' } } },
                bins: ['eslint'],
                files: ['package.json'],
            });
            fs.mkdirSync(path.join(dir, '.awm'), { recursive: true });
            fs.writeFileSync(path.join(dir, '.awm', 'sensors.baseline.json'), JSON.stringify({ lint: [] }));

            const report = await preflight(dir);

            expect(check(report, 'sensors-baseline').ok).toBe(true);
            expect(check(report, 'sensors-baseline').detail).toBe('baseline present');
            expect(check(report, 'sensors-baseline').remedy).toBeUndefined();
            expect(report.status).toBe('ready');
        });

        it('is omitted entirely when there is no manifest at all — nothing to baseline without sensors', async () => {
            const dir = make();

            const report = await preflight(dir);

            expect(report.checks.find(c => c.id === 'sensors-baseline')).toBeUndefined();
            expect(report.status).toBe('not_configured');
        });

        it('does not nudge on a deliberate opt-out (every sensor disabled) — nothing to baseline', async () => {
            // Regression: the trigger condition originally checked only manifestExists, so a
            // repo that deliberately opted out (checkManifest's own documented pattern: every
            // sensor `enabled: false`) still got told to run `awm sensors baseline` — nothing
            // to baseline when there's nothing enabled to have findings in the first place.
            const dir = make({
                manifest: { pack: 'js-ts', sensors: { lint: { cmd: 'npx eslint .', enabled: false } } },
            });

            const report = await preflight(dir);

            expect(check(report, 'sensors-baseline').ok).toBe(true);
            expect(check(report, 'sensors-baseline').detail).toBe('no enabled sensors — nothing to baseline');
            expect(check(report, 'sensors-baseline').remedy).toBeUndefined();
        });

        it('does not nudge on an unparseable manifest — nothing to baseline', async () => {
            const dir = make({ manifest: '{not valid json' });

            const report = await preflight(dir);

            expect(check(report, 'sensors-baseline').ok).toBe(true);
            expect(check(report, 'sensors-baseline').detail).toBe('no enabled sensors — nothing to baseline');
            expect(check(report, 'sensors-baseline').remedy).toBeUndefined();
        });

        it('still nudges when the baseline path exists but is not a readable file (e.g. a stray directory)', async () => {
            // Regression: checking presence via `fs.existsSync` alone would have reported
            // "baseline present" here, reassuring the operator that debt is suppressed —
            // but the real gate (`readBaseline`, used by `partition()`) treats an unreadable
            // baseline path as "no baseline, nothing suppressed". The advisory must track
            // what the runtime actually does, not just whether something exists at the path.
            const dir = make({
                manifest: { pack: 'js-ts', sensors: { lint: { cmd: 'npx eslint .' } } },
                bins: ['eslint'],
                files: ['package.json'],
            });
            fs.mkdirSync(path.join(dir, '.awm', 'sensors.baseline.json'), { recursive: true });

            const report = await preflight(dir);

            expect(check(report, 'sensors-baseline').ok).toBe(true);
            expect(check(report, 'sensors-baseline').detail).toContain('no baseline yet');
            expect(check(report, 'sensors-baseline').remedy).toContain('awm sensors baseline');
        });
    });

    it('tells the operator not to hand a broken harness to an unattended run', async () => {
        const out = formatReport({
            status: 'not_configured',
            checks: [{ id: 'manifest', ok: false, detail: 'no .awm/sensors.json', remedy: 'run `awm sensors init`' }],
        });

        expect(out).toContain('unattended');
        expect(out).toContain('awm sensors init');
    });

    it('pads the id column to the widest id actually present, not a hardcoded width', async () => {
        // Regression: a literal `.padEnd(9)` silently misaligned once `sensors-baseline`
        // (16 chars) was added as a check id — every detail column shifted left of where
        // shorter ids' details landed. The width must be derived from the report itself.
        // Marker prefixes (@@) pin exactly where each detail column starts, independent
        // of the detail text's own content.
        const out = formatReport({
            status: 'ready',
            checks: [
                { id: 'host', ok: true, detail: '@@marker' },
                { id: 'sensors-baseline', ok: true, detail: '@@marker' },
            ],
        });
        const lines = out.split('\n').filter(l => l.includes('@@marker'));
        expect(lines).toHaveLength(2);
        expect(lines[0].indexOf('@@marker')).toBe(lines[1].indexOf('@@marker'));
        // And the column is genuinely sized to the longest id (16, 'sensors-baseline'),
        // not the old hardcoded 9 — the shorter id's row must carry visible padding.
        expect(lines[0]).toMatch(/host {12,}@@marker/);
    });

    it.each([
        ['native-gate', 'CI is the authority.', 'native_gate', 'native-gate-declared'],
        ['opt-out', 'No local gate is required.', 'ungated', 'opt-out-declared'],
    ] as const)('exposes stable authority metadata for %s', async (mode, declarationReason, status, reason) => {
        const dir = make({ manifest: { schemaVersion: 3, mode, reason: declarationReason } });

        const report = await preflight(dir);

        expect(report).toMatchObject({
            status,
            mode,
            reason,
            projectRoot: dir,
            manifestPath: path.join(dir, '.awm', 'sensors.json'),
            remedy: expect.any(String),
        });
        expect(exitCodeFor(report)).toBe(1);
        expect(report.status).not.toBe('ready');
    });

    it('derives manifest and tools checks from the same shared authority result', async () => {
        const dir = make({ manifest: '{not valid json' });

        const report = await preflight(dir);

        expect(report).toMatchObject({
            status: 'degraded',
            mode: 'invalid',
            reason: 'manifest-malformed',
            projectRoot: dir,
            manifestPath: path.join(dir, '.awm', 'sensors.json'),
            remedy: expect.any(String),
        });
        expect(check(report, 'manifest').detail).not.toContain('no .awm/sensors.json');
        expect(check(report, 'tools')).toBeUndefined();
    });
});
