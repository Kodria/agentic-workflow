import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const mockRunStructuredCommand = jest.fn();
const mockRunCommand = jest.fn();
jest.mock('../../../src/commands/sensors/exec', () => ({
    runCommand: (...args: unknown[]) => mockRunCommand(...args),
    runStructuredCommand: (...args: unknown[]) => mockRunStructuredCommand(...args),
}));

const { ok } = require('./exec-fixtures');

function git(cwd: string, args: string[]): string {
    return execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}

function structuredArgs(): string[] {
    const command = mockRunStructuredCommand.mock.calls[0]?.[0] as { args?: string[] } | undefined;
    if (!command || !Array.isArray(command.args)) throw new Error('expected structured command call');
    return command.args;
}

describe('runSensors readOnly tool-cache strip (issue #240)', () => {
    let project: string;
    let home: string;
    const version = '10.0.0';
    const cliNodeModules = path.join(__dirname, '..', '..', '..', 'node_modules');

    beforeEach(() => {
        jest.resetModules();
        mockRunStructuredCommand.mockReset();
        mockRunCommand.mockReset();
        mockRunStructuredCommand.mockResolvedValue(ok());
        mockRunCommand.mockResolvedValue(ok());
        project = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-ro-tool-cache-'));
        home = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-ro-tool-cache-home-'));
        process.env.AWM_HOME = home;
        fs.mkdirSync(path.join(project, '.awm'), { recursive: true });
        fs.mkdirSync(path.join(project, 'src'), { recursive: true });
        fs.writeFileSync(path.join(project, 'src', 'a.ts'), 'export const a = 1;\n');
        fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({
            scripts: { lint: 'eslint .' },
            devDependencies: { eslint: '^10.0.0' },
        }));
    });

    afterEach(() => {
        delete process.env.AWM_HOME;
        fs.rmSync(project, { recursive: true, force: true });
        fs.rmSync(home, { recursive: true, force: true });
    });

    const load = () => require('../../../src/commands/sensors/run');

    function writeProjectDeclared(executable: string, args: string[], resolution: 'node-modules-bin' | 'path' = 'node-modules-bin'): void {
        fs.writeFileSync(path.join(project, '.awm', 'sensors.json'), JSON.stringify({
            schemaVersion: 3,
            mode: 'project-sensors',
            pack: null,
            sensors: {
                lint: {
                    source: 'project',
                    enabled: true,
                    fast: true,
                    command: { executable, resolution, args },
                    formatter: 'exit-code',
                },
            },
        }));
        git(project, ['init', '-q', '-b', 'main']);
        git(project, ['add', '-A']);
        git(project, ['commit', '-qm', 'init']);
    }

    function writePackBoundEslintCache(): void {
        const registry = path.join(home, 'registries', 'baseline', 'sensor-packs', 'js-ts');
        fs.mkdirSync(registry, { recursive: true });
        fs.writeFileSync(path.join(registry, 'eslint.config.awm.mjs'), 'export default []');
        fs.writeFileSync(path.join(home, 'registries.json'), JSON.stringify([{ name: 'baseline', remote: 'https://example.test/baseline.git' }]));
        fs.mkdirSync(path.join(project, 'node_modules', 'eslint'), { recursive: true });
        fs.writeFileSync(path.join(project, 'node_modules', 'eslint', 'package.json'), JSON.stringify({ version }));
        fs.writeFileSync(path.join(registry, 'pack.json'), JSON.stringify({
            schemaVersion: 2, name: 'js-ts', description: 'fixture', detects: ['package.json'],
            coverage: { schemaVersion: 1, classes: { lint: { description: 'lint', detectors: [{ sensor: 'lint' }], remedy: { summary: 'fix', command: 'awm sensors init' } } } },
            sensors: {
                lint: {
                    fast: true,
                    applicability: { allFiles: ['package.json'] },
                    variants: [{
                        id: 'eslint-10', priority: 1, certifiedRange: '>=10 <11',
                        requirements: { tool: 'eslint', toolRange: '>=10 <11', runtime: 'node', runtimeRange: '>=0' },
                        assets: ['eslint.config.awm.mjs'], formatter: 'exit-code',
                        probe: { kind: 'package-script-present', script: 'lint' },
                        command: {
                            executable: 'eslint',
                            resolution: 'node-modules-bin',
                            args: ['.', '--cache', '--format', 'json'],
                        },
                        inputs: ['src/**/*.ts'],
                    }],
                },
            },
        }));
        fs.writeFileSync(path.join(project, '.awm', 'sensors.json'), JSON.stringify({
            schemaVersion: 2, pack: 'js-ts', registryRoot: path.join(home, 'registries', 'baseline'), sensors: {
                lint: {
                    enabled: true, fast: true, variantId: 'eslint-10',
                    command: { executable: 'stale-eslint', resolution: 'node-modules-bin', args: ['.'] },
                    assets: ['eslint.config.awm.mjs'],
                    inputs: ['src/**/*.ts'],
                    initializedCompatibility: {
                        state: 'certified', reason: 'range-and-probe', variantId: 'eslint-10',
                        toolVersion: version, runtimeVersion: process.versions.node, certifiedRange: '>=10 <11', evidence: [],
                    },
                },
            },
        }));
        git(project, ['init', '-q', '-b', 'main']);
        git(project, ['add', '-A']);
        git(project, ['commit', '-qm', 'init']);
    }

    it('R5: under readOnly strips eslint --cache so mock does not write .eslintcache', async () => {
        writeProjectDeclared('eslint', ['.', '--cache', '--format', 'json']);
        mockRunStructuredCommand.mockImplementation(async (command: { args: string[] }) => {
            if (command.args.includes('--cache') || command.args.some((a) => a.startsWith('--cache='))) {
                fs.writeFileSync(path.join(project, '.eslintcache'), 'cache');
            }
            return ok();
        });

        const out = await load().runSensors({ cwd: project, readOnly: true, all: true });

        expect(structuredArgs()).not.toContain('--cache');
        expect(fs.existsSync(path.join(project, '.eslintcache'))).toBe(false);
        expect(out.reason).not.toBe('read-only-mutation-detected');
    });

    it('under readOnly strips eslint --cache=true equals form (Track B B1)', async () => {
        writeProjectDeclared('eslint', ['.', '--cache=true', '--cache-location=node_modules/.cache/eslint/', '--format', 'json']);
        mockRunStructuredCommand.mockImplementation(async (command: { args: string[] }) => {
            if (command.args.includes('--cache') || command.args.some((a) => a.startsWith('--cache='))) {
                fs.writeFileSync(path.join(project, '.eslintcache'), 'cache');
            }
            return ok();
        });

        const out = await load().runSensors({ cwd: project, readOnly: true, all: true });

        expect(structuredArgs().some((a) => a === '--cache' || a.startsWith('--cache='))).toBe(false);
        expect(structuredArgs().some((a) => a === '--cache-location' || a.startsWith('--cache-location='))).toBe(false);
        expect(fs.existsSync(path.join(project, '.eslintcache'))).toBe(false);
        expect(out.reason).not.toBe('read-only-mutation-detected');
    });

    it('R2: without readOnly keeps eslint --cache in spawn args', async () => {
        writeProjectDeclared('eslint', ['.', '--cache', '--format', 'json']);

        await load().runSensors({ cwd: project, all: true });

        expect(structuredArgs()).toContain('--cache');
    });

    it('R3: readOnly + useCache creates no cache-*.json under .awm/sensors/runs', async () => {
        writePackBoundEslintCache();

        await load().runSensors({ cwd: project, useCache: true, readOnly: true });

        const runs = path.join(project, '.awm', 'sensors', 'runs');
        const cacheFiles = fs.existsSync(runs) ? fs.readdirSync(runs).filter((n) => n.startsWith('cache-')) : [];
        expect(cacheFiles).toEqual([]);
        expect(mockRunStructuredCommand).toHaveBeenCalled();
    });

    it('R7: real project file mutation under readOnly still yields read-only-mutation-detected', async () => {
        writeProjectDeclared('eslint', ['.', '--cache', '--format', 'json']);
        mockRunStructuredCommand.mockImplementation(async () => {
            fs.writeFileSync(path.join(project, 'src', 'touched.ts'), 'export const t = 1;\n');
            return ok();
        });

        const out = await load().runSensors({ cwd: project, readOnly: true, all: true });

        expect(out.reason).toBe('read-only-mutation-detected');
    });

    it('R8: legacy cmd string keeps --cache when passed to runCommand under readOnly', async () => {
        fs.writeFileSync(path.join(project, '.awm', 'sensors.json'), JSON.stringify({
            pack: 'js-ts',
            sensors: { lint: { fast: true, cmd: 'eslint --cache --format json .' } },
        }));
        git(project, ['init', '-q', '-b', 'main']);
        git(project, ['add', '-A']);
        git(project, ['commit', '-qm', 'init']);

        await load().runSensors({ cwd: project, readOnly: true, all: true });

        expect(mockRunCommand).toHaveBeenCalled();
        const cmd = mockRunCommand.mock.calls[0]?.[0] as string;
        expect(cmd).toContain('--cache');
        expect(mockRunStructuredCommand).not.toHaveBeenCalled();
    });

    it('R9: non-eslint structured rubocop keeps --cache false under readOnly', async () => {
        writeProjectDeclared('rubocop', ['--cache', 'false'], 'path');

        await load().runSensors({ cwd: project, readOnly: true, all: true });

        expect(structuredArgs()).toEqual(['--cache', 'false']);
    });

    it('real eslint binary under readOnly does not leave .eslintcache', async () => {
        const actualExec = jest.requireActual('../../../src/commands/sensors/exec') as {
            runCommand: (...args: unknown[]) => Promise<unknown>;
            runStructuredCommand: (...args: unknown[]) => Promise<unknown>;
        };
        mockRunStructuredCommand.mockImplementation((...args: unknown[]) => actualExec.runStructuredCommand(...args));
        mockRunCommand.mockImplementation((...args: unknown[]) => actualExec.runCommand(...args));

        fs.writeFileSync(path.join(project, '.gitignore'), 'node_modules/\n');
        fs.writeFileSync(path.join(project, 'eslint.config.mjs'), 'export default [{ files: ["**/*.{js,ts}"], rules: {} }];\n');
        fs.symlinkSync(cliNodeModules, path.join(project, 'node_modules'), 'dir');
        fs.writeFileSync(path.join(project, '.awm', 'sensors.json'), JSON.stringify({
            schemaVersion: 3,
            mode: 'project-sensors',
            pack: null,
            sensors: {
                lint: {
                    source: 'project',
                    enabled: true,
                    fast: true,
                    command: {
                        executable: 'eslint',
                        resolution: 'node-modules-bin',
                        args: ['.', '--cache', '--format', 'json'],
                    },
                    formatter: 'exit-code',
                },
            },
        }));
        git(project, ['init', '-q', '-b', 'main']);
        git(project, ['add', '-A']);
        git(project, ['commit', '-qm', 'init']);

        const cachePath = path.join(project, '.eslintcache');
        if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath);

        const out = await load().runSensors({ cwd: project, readOnly: true, all: true });

        expect(fs.existsSync(cachePath)).toBe(false);
        expect(out.reason).not.toBe('read-only-mutation-detected');
        expect(out.sensors).toEqual([
            expect.objectContaining({ name: 'lint', status: 'pass' }),
        ]);
    });
});
