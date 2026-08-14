import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveParsedPackCompatibility } from '../../../../src/commands/sensors/compatibility/live';
import { runStructuredCommand } from '../../../../src/commands/sensors/exec';
import { createSemgrepVenvFixture } from './python-venv-fixture';

const itPosix = process.platform !== 'win32' ? it : it.skip;

describe('resolveParsedPackCompatibility — contained Python commands', () => {
    test.each([
        ['linux', ['.venv', 'bin', 'semgrep']],
        ['win32', ['.venv', 'Scripts', 'semgrep.exe']],
    ] as const)('creates a local Semgrep executable in the %s virtual-environment layout', (targetPlatform, executableParts) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-semgrep-venv-layout-'));
        try {
            createSemgrepVenvFixture(root, targetPlatform);
            expect(fs.lstatSync(path.join(root, ...executableParts)).isFile()).toBe(true);
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });

    it('resolves the Windows virtual-environment executable from Scripts instead of PATH', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-semgrep-windows-resolution-'));
        const global = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-semgrep-windows-global-'));
        const originalPlatform = process.platform;
        const savedPath = process.env.PATH;
        const savedPathExt = process.env.PATHEXT;
        try {
            Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
            process.env.PATH = global;
            process.env.PATHEXT = '.EXE';
            createSemgrepVenvFixture(root, 'win32');
            fs.writeFileSync(path.join(global, 'semgrep.exe'), 'must-not-run');

            await expect(runStructuredCommand({
                executable: 'semgrep', resolution: 'python-environment', pythonEnvironmentRoot: '.venv', args: ['--version'],
            }, { cwd: root, timeout: 5_000 })).resolves.toMatchObject({
                code: 0,
                stdout: expect.stringContaining(process.version),
            });
        } finally {
            Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
            if (savedPath === undefined) delete process.env.PATH;
            else process.env.PATH = savedPath;
            if (savedPathExt === undefined) delete process.env.PATHEXT;
            else process.env.PATHEXT = savedPathExt;
            fs.rmSync(root, { recursive: true, force: true });
            fs.rmSync(global, { recursive: true, force: true });
        }
    });

    itPosix('binds Semgrep discovery, validation probe, and execution to the same local virtual-environment executable', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-semgrep-contained-'));
        const global = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-semgrep-global-'));
        const savedPath = process.env.PATH;
        try {
            createSemgrepVenvFixture(root);
            fs.writeFileSync(path.join(root, '.venv', 'bin', 'semgrep'), '#!/bin/sh\nif [ "$1" = "--validate" ]; then echo local-semgrep; exit 0; fi\nexit 1\n', { mode: 0o755 });
            fs.writeFileSync(path.join(global, 'semgrep'), '#!/bin/sh\necho global-semgrep\n', { mode: 0o755 });
            process.env.PATH = global;

            const pack = {
                schemaVersion: 2,
                name: 'python',
                description: 'test',
                detects: ['pyproject.toml'],
                coverage: {},
                sensors: {
                    security: {
                        applicability: { allFiles: ['pyproject.toml'] },
                        variants: [{
                            id: 'semgrep-1', priority: 1, certifiedRange: '>=1 <2',
                            requirements: { tool: 'semgrep', toolRange: '>=1 <2', runtime: 'python', runtimeRange: '>=3.12 <4' },
                            assets: [], formatter: 'semgrep', probe: { kind: 'semgrep-validate' },
                            command: { executable: 'semgrep', resolution: 'path', args: ['--validate'] },
                        }],
                    },
                },
            } as any;
            fs.writeFileSync(path.join(root, 'pyproject.toml'), '[project]\nname = "sample"\n');

            const live = await resolveParsedPackCompatibility(root, pack);
            const command = live.pack.sensors.security.variants[0].command;
            expect(live.sensors.security).toMatchObject({ state: 'certified', toolVersion: '1.91.0' });
            expect(command).toMatchObject({ executable: 'semgrep', resolution: 'python-environment' });
            await expect(runStructuredCommand(command, { cwd: root, timeout: 5_000 })).resolves.toMatchObject({ code: 0, stdout: 'local-semgrep\n' });
        } finally {
            process.env.PATH = savedPath;
            fs.rmSync(root, { recursive: true, force: true });
            fs.rmSync(global, { recursive: true, force: true });
        }
    });

    it('never falls back from the discovered .venv to a sibling venv executable', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-semgrep-environment-identity-'));
        try {
            createSemgrepVenvFixture(root, process.platform, '.venv', { executable: false });
            createSemgrepVenvFixture(root, process.platform, 'venv');
            fs.writeFileSync(path.join(root, 'pyproject.toml'), '[project]\nname = "sample"\n');

            const pack = {
                schemaVersion: 2, name: 'python', description: 'test', detects: ['pyproject.toml'], coverage: {},
                sensors: { security: { applicability: { allFiles: ['pyproject.toml'] }, variants: [{
                    id: 'semgrep-1', priority: 1, certifiedRange: '>=1 <2',
                    requirements: { tool: 'semgrep', toolRange: '>=1 <2', runtime: 'python', runtimeRange: '>=3.12 <4' },
                    assets: [], formatter: 'semgrep', probe: { kind: 'semgrep-validate' },
                    command: { executable: 'semgrep', resolution: 'path', args: ['--validate'] },
                }] } },
            } as any;

            const live = await resolveParsedPackCompatibility(root, pack);

            expect(live.sensors.security).toMatchObject({ state: 'unverifiable', reason: 'probe-inconclusive', toolVersion: '1.91.0' });
            expect(() => runStructuredCommand(live.pack.sensors.security.variants[0].command, { cwd: root, timeout: 5_000 }))
                .toThrow('python environment executable is not a contained local regular file');
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });
});
