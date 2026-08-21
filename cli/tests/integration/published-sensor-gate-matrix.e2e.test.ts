import crypto from 'crypto';
import { spawnSync, type SpawnSyncReturns } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * This acceptance gate is deliberately opt-in. It downloads two release
 * artifacts and installs fixture dependencies, so normal unit/PR runs must not
 * accidentally treat a mutable checkout as publication evidence.
 *
 * Run it with:
 *   AWM_RUN_PUBLISHED_SENSOR_GATE_MATRIX=1 npm test -- published-sensor-gate-matrix
 */
const enabled = process.env.AWM_RUN_PUBLISHED_SENSOR_GATE_MATRIX === '1';
const acceptance = enabled ? describe : describe.skip;
const cliVersion = process.env.AWM_PUBLISHED_CLI_VERSION ?? '8.1.5';
const registryTag = process.env.AWM_PUBLISHED_REGISTRY_TAG ?? 'v3.0.0';
const registryRemote = process.env.AWM_PUBLISHED_REGISTRY_REMOTE ?? 'https://github.com/Kodria/awm-baseline-registry.git';
// Keep the shorter name used by the release orchestrator, while accepting the
// original explicit name for local invocation.
const reportFile = process.env.AWM_PUBLISHED_MATRIX_REPORT ?? process.env.AWM_PUBLISHED_SENSOR_GATE_MATRIX_REPORT;

type CommandRecord = {
    name: string;
    argv: string[];
    exit: number | null;
    signal: NodeJS.Signals | null;
    stdoutHash: string;
    stderrHash: string;
    output?: Record<string, unknown>;
};

type Fixture = { root: string; project: string; awmHome: string };

function hash(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function writeJson(file: string, value: unknown): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function assertProcess(result: SpawnSyncReturns<string>, description: string): void {
    if (result.error || result.status !== 0 || result.signal !== null) {
        throw new Error(`${description} failed: status=${String(result.status)} signal=${String(result.signal)} error=${result.error?.message ?? 'none'}\n${result.stderr}`);
    }
}

function command(cwd: string, executable: string, args: string[], env: NodeJS.ProcessEnv = process.env): SpawnSyncReturns<string> {
    return spawnSync(executable, args, { cwd, encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 });
}

function installArtifacts(root: string): { cliRoot: string; registryRoot: string } {
    const artifacts = path.join(root, 'artifacts');
    fs.mkdirSync(artifacts, { recursive: true });
    writeJson(path.join(artifacts, 'package.json'), { private: true, name: 'published-sensor-gate-artifacts' });
    assertProcess(command(artifacts, 'npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', `agentic-workflow-manager@${cliVersion}`]), `npm install agentic-workflow-manager@${cliVersion}`);
    const registryRoot = path.join(root, 'registry');
    assertProcess(command(root, 'git', ['clone', '--depth', '1', '--branch', registryTag, registryRemote, registryRoot]), `git clone ${registryTag}`);
    const actualVersion = (JSON.parse(fs.readFileSync(path.join(artifacts, 'node_modules', 'agentic-workflow-manager', 'package.json'), 'utf8')) as { version?: string }).version;
    if (actualVersion !== cliVersion) throw new Error(`npm resolved CLI ${String(actualVersion)} instead of immutable ${cliVersion}`);
    const actualTag = command(registryRoot, 'git', ['describe', '--exact-match', '--tags', 'HEAD']);
    assertProcess(actualTag, `verify registry tag ${registryTag}`);
    if (actualTag.stdout.trim() !== registryTag) throw new Error(`registry checkout resolved ${actualTag.stdout.trim()} instead of ${registryTag}`);
    return { cliRoot: path.join(artifacts, 'node_modules', 'agentic-workflow-manager'), registryRoot };
}

function createFixture(root: string, registryRoot: string, name: string): Fixture {
    const fixtureRoot = path.join(root, name);
    const project = path.join(fixtureRoot, 'project');
    const awmHome = path.join(fixtureRoot, 'awm-home');
    fs.mkdirSync(project, { recursive: true });
    fs.mkdirSync(path.join(awmHome, 'registries'), { recursive: true });
    fs.cpSync(registryRoot, path.join(awmHome, 'registries', 'baseline'), { recursive: true });
    writeJson(path.join(awmHome, 'registries.json'), [{ name: 'baseline', remote: registryRemote }]);
    writeJson(path.join(project, 'package.json'), { name: `published-${name}`, private: true });
    // The real v3 pack requires an ESLint 8 eslintrc project. These dependencies
    // belong to the isolated fixture, never to the CLI under test.
    assertProcess(command(project, 'npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--save-dev', 'eslint@8.57.1']), `install ESLint fixture for ${name}`);
    fs.writeFileSync(path.join(project, '.eslintrc.js'), 'module.exports = { env: { node: true, es2022: true } };\n');
    fs.writeFileSync(path.join(project, 'clean.js'), 'const answer = 42;\nconsole.log(answer);\n');
    return { root: fixtureRoot, project, awmHome };
}

function parseJson(result: SpawnSyncReturns<string>, description: string): Record<string, unknown> {
    if (!result.stdout.trim()) throw new Error(`${description} emitted no JSON; stderr=${result.stderr}`);
    return JSON.parse(result.stdout) as Record<string, unknown>;
}

function runCli(cliRoot: string, fixture: Fixture, ...args: string[]): SpawnSyncReturns<string> {
    return command(fixture.project, process.execPath, [path.join(cliRoot, 'dist', 'src', 'index.js'), ...args], {
        ...process.env,
        AWM_HOME: fixture.awmHome,
        AWM_NO_UPDATE_CHECK: '1',
    });
}

function record(records: CommandRecord[], name: string, argv: string[], result: SpawnSyncReturns<string>, output?: Record<string, unknown>): void {
    records.push({ name, argv, exit: result.status, signal: result.signal, stdoutHash: hash(result.stdout), stderrHash: hash(result.stderr), ...(output ? { output } : {}) });
}

function runJson(records: CommandRecord[], name: string, cliRoot: string, fixture: Fixture, ...args: string[]): { result: SpawnSyncReturns<string>; output: Record<string, unknown> } {
    const result = runCli(cliRoot, fixture, ...args);
    let output: Record<string, unknown>;
    try {
        output = parseJson(result, name);
    } catch (error) {
        // A missing JSON envelope is itself release evidence. Persist argv,
        // process status and hashes before surfacing the failed acceptance gate.
        record(records, name, args, result);
        throw error;
    }
    record(records, name, args, result, output);
    return { result, output };
}

function assertExitMatchesVerdict(result: SpawnSyncReturns<string>, output: Record<string, unknown>): void {
    expect(result.status).toBe(output.overall === 'pass' ? 0 : 1);
}

function writeReport(root: string, cliRoot: string, registryRoot: string, records: CommandRecord[]): void {
    const target = reportFile ? path.resolve(reportFile) : path.join(root, 'published-sensor-gate-matrix.json');
    writeJson(target, {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        cli: { version: cliVersion, packageHash: hash(fs.readFileSync(path.join(cliRoot, 'package.json'), 'utf8')) },
        registry: { tag: registryTag, packHash: hash(fs.readFileSync(path.join(registryRoot, 'sensor-packs', 'js-ts', 'pack.json'), 'utf8')) },
        commands: records,
    });
    process.stdout.write(`published sensor gate matrix: ${target}\n`);
}

acceptance('published sensor gate matrix', () => {
    jest.setTimeout(10 * 60_000);

    test('records real legacy, v2, changed, baseline, status and preflight evidence from immutable releases', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-published-sensor-gates-'));
        const records: CommandRecord[] = [];
        let artifacts: { cliRoot: string; registryRoot: string } | undefined;
        try {
            artifacts = installArtifacts(root);
            const { cliRoot, registryRoot } = artifacts;
            expect(fs.existsSync(path.join(cliRoot, 'dist', 'src', 'index.js'))).toBe(true);
            expect(fs.existsSync(path.join(registryRoot, 'sensor-packs', 'js-ts', 'pack.json'))).toBe(true);

            const v2 = createFixture(root, registryRoot, 'v2');
            const initialized = runCli(cliRoot, v2, 'sensors', 'init', '--registry-root', registryRoot, '--pack', 'js-ts');
            record(records, 'v2-init', ['sensors', 'init', '--registry-root', registryRoot, '--pack', 'js-ts'], initialized);
            assertProcess(initialized, 'v2 init');
            const status = runCli(cliRoot, v2, 'sensors', 'status');
            record(records, 'v2-status', ['sensors', 'status'], status);
            expect([0, 1]).toContain(status.status);
            const preflight = runJson(records, 'v2-preflight', cliRoot, v2, 'preflight', '--verify-sensors', '--json');
            expect(['ready', 'degraded', 'not_configured']).toContain(preflight.output.status);
            expect([0, 1]).toContain(preflight.result.status);

            const clean = runJson(records, 'v2-clean-fast', cliRoot, v2, 'sensors', 'run', '--fast');
            assertExitMatchesVerdict(clean.result, clean.output);
            // A v2 manifest can deliberately disable an otherwise applicable
            // sensor. Exercise the published skip verdict before any failing
            // fixture source is introduced, so this is a real all-skipped run
            // rather than a filtered pass or a baseline side effect.
            const v2ManifestPath = path.join(v2.project, '.awm', 'sensors.json');
            const disabledManifest = JSON.parse(fs.readFileSync(v2ManifestPath, 'utf8')) as { sensors: Record<string, { enabled?: boolean; fast?: boolean }> };
            const fastSensor = Object.entries(disabledManifest.sensors).find(([, sensor]) => sensor.fast === true);
            expect(fastSensor).toBeDefined();
            if (!fastSensor) throw new Error('published v2 js-ts pack has no fast sensor to disable');
            disabledManifest.sensors[fastSensor[0]].enabled = false;
            writeJson(v2ManifestPath, disabledManifest);
            const skipped = runJson(records, 'v2-disabled-fast', cliRoot, v2, 'sensors', 'run', '--fast');
            assertExitMatchesVerdict(skipped.result, skipped.output);
            expect(skipped.output.overall).toBe('skipped');
            disabledManifest.sensors[fastSensor[0]].enabled = true;
            writeJson(v2ManifestPath, disabledManifest);
            fs.writeFileSync(path.join(v2.project, 'failure.js'), 'missingPublishedSensorGateValue;\n');
            const failing = runJson(records, 'v2-failing-fast', cliRoot, v2, 'sensors', 'run', '--fast');
            assertExitMatchesVerdict(failing.result, failing.output);
            const baseline = runCli(cliRoot, v2, 'sensors', 'baseline');
            record(records, 'v2-baseline', ['sensors', 'baseline'], baseline);
            assertProcess(baseline, 'v2 baseline');
            const baselined = runJson(records, 'v2-baselined-fast', cliRoot, v2, 'sensors', 'run', '--fast');
            assertExitMatchesVerdict(baselined.result, baselined.output);

            assertProcess(command(v2.project, 'git', ['init']), 'git init changed fixture');
            assertProcess(command(v2.project, 'git', ['config', 'user.email', 'acceptance@example.invalid']), 'git user email');
            assertProcess(command(v2.project, 'git', ['config', 'user.name', 'Published acceptance']), 'git user name');
            assertProcess(command(v2.project, 'git', ['add', '.']), 'git add changed fixture');
            assertProcess(command(v2.project, 'git', ['commit', '-m', 'baseline']), 'git commit changed fixture');
            fs.writeFileSync(path.join(v2.project, 'clean.js'), 'const changed = 1;\nconsole.log(changed);\n');
            const changed = runJson(records, 'v2-changed-fast', cliRoot, v2, 'sensors', 'run', '--fast', '--changed');
            assertExitMatchesVerdict(changed.result, changed.output);
            expect(changed.output).toHaveProperty('changedScope');

            const legacy = createFixture(root, registryRoot, 'legacy');
            fs.mkdirSync(path.join(legacy.project, '.awm'), { recursive: true });
            writeJson(path.join(legacy.project, '.awm', 'sensors.json'), { pack: 'js-ts', sensors: { lint: { fast: true, cmd: 'npx eslint . --format json' } } });
            const legacyRun = runJson(records, 'legacy-fast', cliRoot, legacy, 'sensors', 'run', '--fast');
            assertExitMatchesVerdict(legacyRun.result, legacyRun.output);

            const outcomes = new Set(records.flatMap(record => record.output?.overall ? [`${String(record.output.overall)}:${String(record.exit)}`] : []));
            // The matrix's purpose is to make distinct real outcome/exit pairs
            // visible. Do not prescribe their values here: those are the release
            // artifact's evidence, recorded above for review.
            expect(outcomes.size).toBeGreaterThanOrEqual(4);
            writeReport(root, cliRoot, registryRoot, records);
        } catch (error) {
            // Do not turn a release mismatch into a synthetic success. When an
            // artifact is available, leave the exact partial trace for review.
            if (artifacts) writeReport(root, artifacts.cliRoot, artifacts.registryRoot, records);
            throw error;
        } finally {
            if (!reportFile) fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
