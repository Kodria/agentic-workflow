import fs from 'fs';
import os from 'os';
import path from 'path';
import { discoverProjectEvidence } from '../../../../src/commands/sensors/compatibility/discovery';

describe('discoverProjectEvidence', () => {
    it('returns only local, relative project evidence and detects conflicting lockfiles', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-discovery-'));
        try {
            fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { lint: 'eslint .' }, devDependencies: { eslint: '10.0.0' } }));
            fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
            fs.writeFileSync(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9');
            fs.writeFileSync(path.join(root, 'eslint.config.js'), 'export default []');
            fs.mkdirSync(path.join(root, 'node_modules', 'eslint'), { recursive: true });
            fs.writeFileSync(path.join(root, 'node_modules', 'eslint', 'package.json'), JSON.stringify({ name: 'eslint', version: '10.4.1' }));
            const evidence = discoverProjectEvidence(root, { schemaVersion: 2, name: 'js-ts', detects: ['package.json'], sensors: { lint: { applicability: { allFiles: ['package.json'] }, variants: [{ requirements: { tool: 'eslint', configFiles: [] } }] } } } as any, { platform: () => 'darwin' });
            expect(evidence.packageManagerConflict).toBe(true);
            expect(evidence.os).toBe('darwin');
            expect(evidence.declaredToolRanges.eslint).toBe('10.0.0');
            expect(evidence.toolVersions.eslint).toBe('10.4.1');
            expect(evidence.scripts).toContain('lint');
            expect(evidence.configFiles).toContain('eslint.config.js');
            expect(evidence.paths.every((item: string) => !path.isAbsolute(item) && !item.includes('..'))).toBe(true);
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });

    it('includes pack and applicability markers when deciding whether a sensor applies', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-discovery-markers-'));
        try {
            fs.writeFileSync(path.join(root, 'pack-marker'), 'present');
            fs.writeFileSync(path.join(root, 'sensor-marker'), 'present');
            fs.writeFileSync(path.join(root, 'one-of-these'), 'present');
            const evidence = discoverProjectEvidence(root, {
                schemaVersion: 2,
                name: 'custom',
                detects: ['pack-marker'],
                sensors: {
                    lint: {
                        applicability: { allFiles: ['sensor-marker'], anyFiles: ['one-of-these', 'missing-marker'] },
                        variants: [{ requirements: { tool: 'eslint', configFiles: [] } }],
                    },
                },
            } as any);
            expect(evidence.paths).toEqual(expect.arrayContaining(['pack-marker', 'sensor-marker', 'one-of-these']));
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });

    test.each([
        ['linux', ['.venv', 'lib', 'python3.12', 'site-packages']],
        ['win32', ['.venv', 'Lib', 'site-packages']],
    ] as const)('discovers exact local Python runtime and tool metadata on %s', (targetPlatform, sitePackages) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-python-discovery-'));
        try {
            fs.mkdirSync(path.join(root, ...sitePackages), { recursive: true });
            fs.writeFileSync(path.join(root, '.venv', 'pyvenv.cfg'), 'version = 3.12.4\n');
            for (const [tool, version] of Object.entries({ mypy: '1.11.2', ruff: '0.6.9', pytest: '8.3.3', semgrep: '1.91.0' })) {
                const info = path.join(root, ...sitePackages, `${tool}-${version}.dist-info`);
                fs.mkdirSync(info);
                fs.writeFileSync(path.join(info, 'METADATA'), `Metadata-Version: 2.3\nName: ${tool}\nVersion: ${version}\n`);
            }
            const pack = { schemaVersion: 2, name: 'python', detects: ['pyproject.toml'], sensors: {
                quality: { applicability: { allFiles: ['pyproject.toml'] }, variants: Object.keys({ mypy: 0, ruff: 0, pytest: 0, semgrep: 0 }).map(tool => ({ requirements: { tool, runtime: 'python', configFiles: [] } })) },
            } } as any;
            fs.writeFileSync(path.join(root, 'pyproject.toml'), '[project]\nname = "sample"');
            const evidence = discoverProjectEvidence(root, pack, { platform: () => targetPlatform });
            expect(evidence.runtimeVersions.python).toBe('3.12.4');
            expect(evidence.toolVersions).toMatchObject({ mypy: '1.11.2', ruff: '0.6.9', pytest: '8.3.3', semgrep: '1.91.0' });
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });

    it('does not trust missing or escaping Python environment metadata', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-python-discovery-untrusted-'));
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-python-discovery-outside-'));
        try {
            fs.mkdirSync(path.join(root, '.venv', 'lib', 'python3.12', 'site-packages'), { recursive: true });
            fs.writeFileSync(path.join(root, '.venv', 'pyvenv.cfg'), 'version = not-a-version\n');
            const escaped = path.join(root, '.venv', 'lib', 'python3.12', 'site-packages', 'ruff-0.6.9.dist-info');
            fs.mkdirSync(path.join(outside, 'ruff-0.6.9.dist-info'));
            fs.writeFileSync(path.join(outside, 'ruff-0.6.9.dist-info', 'METADATA'), 'Name: ruff\nVersion: 0.6.9\n');
            fs.symlinkSync(path.join(outside, 'ruff-0.6.9.dist-info'), escaped, 'dir');
            const pack = { schemaVersion: 2, name: 'python', detects: [], sensors: { lint: { applicability: {}, variants: [{ requirements: { tool: 'ruff', runtime: 'python', configFiles: [] } }] } } } as any;
            const evidence = discoverProjectEvidence(root, pack, { platform: () => 'linux' });
            expect(evidence.runtimeVersions.python).toBeNull();
            expect(evidence.toolVersions.ruff).toBeNull();
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
            fs.rmSync(outside, { recursive: true, force: true });
        }
    });
});
