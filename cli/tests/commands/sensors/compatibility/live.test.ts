import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveParsedPackCompatibility } from '../../../../src/commands/sensors/compatibility/live';
import { runStructuredCommand } from '../../../../src/commands/sensors/exec';

describe('resolveParsedPackCompatibility — contained Python commands', () => {
    it('binds Semgrep discovery, probe, and execution to the same local virtual-environment executable', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-semgrep-contained-'));
        const global = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-semgrep-global-'));
        const savedPath = process.env.PATH;
        try {
            const localBin = path.join(root, '.venv', 'bin');
            const sitePackages = path.join(root, '.venv', 'lib', 'python3.12', 'site-packages');
            fs.mkdirSync(localBin, { recursive: true });
            fs.mkdirSync(path.join(sitePackages, 'semgrep-1.91.0.dist-info'), { recursive: true });
            fs.writeFileSync(path.join(root, '.venv', 'pyvenv.cfg'), 'version = 3.12.4\n');
            fs.writeFileSync(path.join(sitePackages, 'semgrep-1.91.0.dist-info', 'METADATA'), 'Name: semgrep\nVersion: 1.91.0\n');
            fs.writeFileSync(path.join(localBin, 'semgrep'), '#!/bin/sh\necho local-semgrep\n', { mode: 0o755 });
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
});
