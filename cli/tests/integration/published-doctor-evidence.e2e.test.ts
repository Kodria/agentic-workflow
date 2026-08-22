import { spawnSync, type SpawnSyncReturns } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const cliVersion = process.env.AWM_PUBLISHED_CLI_VERSION;
const registryTag = process.env.AWM_PUBLISHED_REGISTRY_TAG;
const registryRemote = process.env.AWM_PUBLISHED_REGISTRY_REMOTE ?? 'https://github.com/Kodria/awm-baseline-registry.git';
const enabled = Boolean(cliVersion && registryTag);
const acceptance = enabled ? describe : describe.skip;

function command(cwd: string, executable: string, args: string[], env = process.env): SpawnSyncReturns<string> {
    return spawnSync(executable, args, { cwd, encoding: 'utf8', env });
}

/** Published evidence accepts only exact versions and immutable git tags. */
export function assertImmutableArtifacts(version: string | undefined, tag: string | undefined, remote: string): void {
    if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('published CLI version must be an exact immutable semver');
    if (version.includes('file:') || version.includes('/') || version.includes('@')) throw new Error('published CLI must not be a workspace, file dependency, or mutable tag');
    if (!tag || !/^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) throw new Error('published registry ref must be an exact immutable tag');
    if (!/^https:\/\/github\.com\/Kodria\/awm-baseline-registry\.git$/.test(remote)) throw new Error('published registry remote must be the canonical immutable release remote');
}

function json(result: SpawnSyncReturns<string>): Record<string, unknown> {
    if (!result.stdout.trim()) throw new Error(`missing JSON output: ${result.stderr}`);
    return JSON.parse(result.stdout) as Record<string, unknown>;
}

acceptance('published doctor and evidence acceptance (R8.7)', () => {
    jest.setTimeout(10 * 60_000);

    test('installs exact npm and registry artifacts into a fresh consumer and executes the dashboard/evidence contract', () => {
        assertImmutableArtifacts(cliVersion, registryTag, registryRemote);
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-published-doctor-'));
        try {
            const artifacts = path.join(root, 'artifacts');
            const registry = path.join(root, 'registry');
            const project = path.join(root, 'project');
            const home = path.join(root, 'home');
            fs.mkdirSync(project, { recursive: true }); fs.mkdirSync(home, { recursive: true });
            expect(command(root, 'npm', ['install', '--prefix', artifacts, '--ignore-scripts', '--no-audit', '--no-fund', `agentic-workflow-manager@${cliVersion}`]).status).toBe(0);
            expect(command(root, 'git', ['clone', '--depth', '1', '--branch', registryTag!, registryRemote, registry]).status).toBe(0);
            expect(command(registry, 'git', ['describe', '--exact-match', '--tags', 'HEAD']).stdout.trim()).toBe(registryTag);
            const cliRoot = path.join(artifacts, 'node_modules', 'agentic-workflow-manager');
            expect(JSON.parse(fs.readFileSync(path.join(cliRoot, 'package.json'), 'utf8'))).toEqual(expect.objectContaining({ version: cliVersion }));
            expect(fs.existsSync(path.join(cliRoot, 'dist', 'src', 'index.js'))).toBe(true);
            fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'published-doctor-fixture', private: true }));
            fs.writeFileSync(path.join(project, 'plan.md'), '# published evidence fixture\n');
            expect(command(project, 'git', ['init']).status).toBe(0);
            expect(command(project, 'git', ['config', 'user.email', 'published@example.invalid']).status).toBe(0);
            expect(command(project, 'git', ['config', 'user.name', 'Published acceptance']).status).toBe(0);
            expect(command(project, 'git', ['add', '.']).status).toBe(0);
            expect(command(project, 'git', ['commit', '-m', 'fixture']).status).toBe(0);
            const branch = command(project, 'git', ['branch', '--show-current']).stdout.trim();
            expect(branch).not.toBe('');
            expect(command(project, 'git', ['remote', 'add', 'origin', 'https://github.com/example/published-doctor-fixture.git']).status).toBe(0);
            const env = { ...process.env, AWM_HOME: home, AWM_NO_UPDATE_CHECK: '1' };
            const invoke = (...args: string[]) => command(project, process.execPath, [path.join(cliRoot, 'dist', 'src', 'index.js'), ...args], env);
            expect([0, 1]).toContain(invoke('doctor').status);
            const report = invoke('doctor', '--json');
            expect([0, 1]).toContain(report.status); expect(json(report)).toHaveProperty('providers');
            expect([0, 1]).toContain(invoke('doctor', '--full').status);
            const html = invoke('doctor', '--html', 'doctor.html');
            expect([0, 1]).toContain(html.status);
            expect(fs.readFileSync(path.join(project, 'doctor.html'), 'utf8')).toContain("script-src 'none'");
            // Seed a completed durable journal using the downloaded package's own
            // journal store: this stays on the published-artifact boundary while
            // making capture exercise its real CLI path, not an injected helper.
            const journalScript = [
                `const store=require(${JSON.stringify(path.join(cliRoot, 'dist', 'src', 'core', 'journal', 'store.js'))});`,
                'store.initJournal(process.argv[1], process.argv[2]);',
                'const state=store.readJournal(process.argv[1], process.argv[2]).state;',
                "state.cycle={...state.cycle,status:'COMPLETE',completedAt:'2026-08-22T10:00:01.000Z'};",
                'store.writeJournal(process.argv[1], process.argv[2], state);',
            ].join('');
            expect(command(project, process.execPath, ['-e', journalScript, project, branch], env).status).toBe(0);
            const capture = invoke('evidence', 'capture', '--plan', 'plan.md');
            expect(capture.status).toBe(0);
            expect(capture.stdout.trim()).toMatch(/^[a-f0-9]{64}$/);
            expect(fs.existsSync(path.join(project, '.awm', 'evidence', 'cycles', `${capture.stdout.trim()}.json`))).toBe(true);
            // The retrospective/ledger lifecycle happens after the durable
            // observation, never instead of it.
            expect(invoke('ledger', 'add', '--branch', branch, '--polarity', 'finding', '--class', 'quality', '--signature', 'published-retro-contract', '--severity', 'important', '--desc', 'published acceptance').status).toBe(0);
            expect(invoke('ledger', 'archive', '--branch', branch).status).toBe(0);
            const retro = fs.readFileSync(path.join(registry, 'skills', 'harness-retro', 'SKILL.md'), 'utf8');
            expect(retro).toMatch(/evidence capture|CycleEvidenceV1/i);
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });
});

describe('published artifact provenance guard', () => {
    test.each(['file:../cli', '../cli', 'latest', 'workspace:*', '8.4.0@latest'])('rejects mutable CLI reference %s', (version) => {
        expect(() => assertImmutableArtifacts(version, 'v3.2.0', registryRemote)).toThrow(/published CLI/i);
    });
    test.each(['main', 'HEAD', '', 'v3', 'refs/heads/main'])('rejects mutable registry ref %s', (tag) => {
        expect(() => assertImmutableArtifacts('8.4.0', tag, registryRemote)).toThrow(/registry ref/i);
    });
});
