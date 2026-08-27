import fs from 'fs';
import os from 'os';
import path from 'path';
import { materializePortableSensors, materializeResolvedSensors } from '../../../../src/commands/sensors/compatibility/materialize';
import { resolvePackSource } from '../../../../src/commands/sensors/compatibility/pack-source';

const evidence = { state: 'certified' as const, reason: 'range-and-probe', variantId: 'eslint-10', toolVersion: '10.0.0', runtimeVersion: '22.0.0', certifiedRange: '>=10 <11', evidence: [] };

describe('materializeResolvedSensors', () => {
    let projectRoot: string;
    let packRoot: string;
    let portableRegistryRoots: string[];
    beforeEach(() => {
        projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-materialize-project-'));
        packRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-materialize-pack-'));
        portableRegistryRoots = [];
        fs.writeFileSync(path.join(packRoot, 'eslint.config.awm.mjs'), 'export default [];');
        fs.writeFileSync(path.join(packRoot, 'tsconfig.awm.json'), '{}');
    });
    afterEach(() => {
        fs.rmSync(projectRoot, { recursive: true, force: true });
        fs.rmSync(packRoot, { recursive: true, force: true });
        for (const registryRoot of portableRegistryRoots) fs.rmSync(registryRoot, { recursive: true, force: true });
    });

    function portableSource(): ReturnType<typeof resolvePackSource> {
        const registryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-materialize-registry-'));
        portableRegistryRoots.push(registryRoot);
        const selectedPackRoot = path.join(registryRoot, 'sensor-packs', 'js-ts');
        fs.mkdirSync(selectedPackRoot, { recursive: true });
        fs.writeFileSync(path.join(selectedPackRoot, 'pack.json'), '{}');
        fs.writeFileSync(path.join(selectedPackRoot, 'eslint.config.awm.mjs'), 'export default [];');
        return resolvePackSource('js-ts', { registries: [{ name: 'baseline', remote: '', contentRoot: registryRoot }] });
    }

    it('copies only selected assets and writes a v2 manifest atomically', () => {
        const result = materializeResolvedSensors({ projectRoot, packRoot, pack: 'js-ts', sensors: {
            lint: { enabled: true, variantId: 'eslint-10', command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] }, assets: ['eslint.config.awm.mjs'], initializedCompatibility: evidence },
        } });
        expect(result.configured).toEqual(['eslint.config.awm.mjs']);
        expect(fs.existsSync(path.join(projectRoot, 'tsconfig.awm.json'))).toBe(false);
        expect(JSON.parse(fs.readFileSync(path.join(projectRoot, '.awm', 'sensors.json'), 'utf8'))).toMatchObject({ schemaVersion: 2, sensors: { lint: { variantId: 'eslint-10' } } });
        expect(fs.readdirSync(path.join(projectRoot, '.awm'))).not.toContain('sensors.json.tmp');
    });

    it('writes a validated portable v3 manifest using the exact logical registry', () => {
        const source = portableSource();
        const result = materializePortableSensors({ projectRoot, pack: 'js-ts', source, sensors: {
            lint: { enabled: true, variantId: 'eslint-10', command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] }, assets: ['eslint.config.awm.mjs'], initializedCompatibility: evidence },
        } } as never);
        expect(result.manifest).toMatchObject({ schemaVersion: 3, mode: 'project-sensors', source: { registry: 'baseline' } });
        const text = fs.readFileSync(path.join(projectRoot, '.awm', 'sensors.json'), 'utf8');
        expect(text.endsWith('\n')).toBe(true);
        expect(text).not.toContain(path.dirname(source.path));
        expect(JSON.parse(text)).toMatchObject({ source: { registry: 'baseline' } });
    });

    it('materializes a canonical pack source from a configured root with a symlinked ancestor', () => {
        const registryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-materialize-registry-'));
        const linkedRegistryRoot = path.join(path.dirname(registryRoot), `${path.basename(registryRoot)}-linked`);
        const contentRoot = path.join(registryRoot, 'content');
        const linkedContentRoot = path.join(linkedRegistryRoot, 'content');
        portableRegistryRoots.push(registryRoot);
        try {
            const selectedPackRoot = path.join(contentRoot, 'sensor-packs', 'js-ts');
            fs.mkdirSync(selectedPackRoot, { recursive: true });
            fs.writeFileSync(path.join(selectedPackRoot, 'pack.json'), '{}');
            fs.writeFileSync(path.join(selectedPackRoot, 'eslint.config.awm.mjs'), 'export default [];');
            fs.symlinkSync(registryRoot, linkedRegistryRoot);
            const source = resolvePackSource('js-ts', { registries: [{ name: 'baseline', remote: '', contentRoot: linkedContentRoot }] });

            const result = materializePortableSensors({ projectRoot, pack: 'js-ts', source, sensors: {
                lint: { enabled: true, variantId: 'eslint-10', command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] }, assets: ['eslint.config.awm.mjs'], initializedCompatibility: evidence },
            } } as never);

            expect(result.configured).toEqual(['eslint.config.awm.mjs']);
            expect(fs.readFileSync(path.join(projectRoot, 'eslint.config.awm.mjs'), 'utf8')).toBe('export default [];');
        } finally {
            fs.rmSync(linkedRegistryRoot, { force: true });
        }
    });

    it('rejects a portable source whose selected pack path belongs to another registry', () => {
        const source = portableSource();
        const otherRegistry = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-materialize-other-registry-'));
        try {
            expect(() => materializePortableSensors({ projectRoot, pack: 'js-ts', source: { ...source, registry: { ...source.registry, contentRoot: otherRegistry } }, sensors: {
                lint: { enabled: true, variantId: 'eslint-10', command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] }, assets: ['eslint.config.awm.mjs'], initializedCompatibility: evidence },
            } } as never)).toThrow(/source|registry|pack/i);
            expect(fs.existsSync(path.join(projectRoot, 'eslint.config.awm.mjs'))).toBe(false);
            expect(fs.existsSync(path.join(projectRoot, '.awm', 'sensors.json'))).toBe(false);
        } finally {
            fs.rmSync(otherRegistry, { recursive: true, force: true });
        }
    });

    it('validates v3 input before writes and cleans copied assets when manifest replacement fails', () => {
        const source = portableSource();
        fs.writeFileSync(path.join(projectRoot, '.awm'), 'not a directory');
        expect(() => materializePortableSensors({ projectRoot, pack: 'js-ts', source, sensors: {
            lint: { enabled: true, variantId: 'eslint-10', command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] }, assets: ['eslint.config.awm.mjs'], initializedCompatibility: evidence },
        } })).toThrow();
        expect(fs.existsSync(path.join(projectRoot, 'eslint.config.awm.mjs'))).toBe(false);
        expect(fs.readFileSync(path.join(projectRoot, '.awm'), 'utf8')).toBe('not a directory');
        expect(() => materializePortableSensors({ projectRoot, pack: 'js-ts', source: { ...source, registry: { ...source.registry, name: 'Baseline' } }, sensors: {
            lint: { enabled: true, variantId: 'eslint-10', command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] }, assets: ['eslint.config.awm.mjs'], initializedCompatibility: evidence },
        } })).toThrow('registry');
        expect(fs.existsSync(path.join(projectRoot, 'eslint.config.awm.mjs'))).toBe(false);
    });

    it('preserves a destination that already exists', () => {
        fs.writeFileSync(path.join(projectRoot, 'eslint.config.awm.mjs'), 'owner content');
        const result = materializeResolvedSensors({ projectRoot, packRoot, pack: 'js-ts', sensors: {
            lint: { enabled: true, variantId: 'eslint-10', command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] }, assets: ['eslint.config.awm.mjs'], initializedCompatibility: evidence },
        } });
        expect(result.preserved).toEqual(['eslint.config.awm.mjs']);
        expect(fs.readFileSync(path.join(projectRoot, 'eslint.config.awm.mjs'), 'utf8')).toBe('owner content');
    });

    it('rejects a symlinked project destination component before writing an asset', () => {
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-materialize-outside-'));
        try {
            fs.mkdirSync(path.join(packRoot, 'configs'));
            fs.writeFileSync(path.join(packRoot, 'configs', 'eslint.config.awm.mjs'), 'registry content');
            fs.symlinkSync(outside, path.join(projectRoot, 'configs'));
            expect(() => materializeResolvedSensors({ projectRoot, packRoot, pack: 'js-ts', sensors: {
                lint: { enabled: true, variantId: 'eslint-10', command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] }, assets: ['configs/eslint.config.awm.mjs'], initializedCompatibility: evidence },
            } })).toThrow(/symlink|destination/i);
            expect(fs.existsSync(path.join(outside, 'eslint.config.awm.mjs'))).toBe(false);
        } finally {
            fs.rmSync(outside, { recursive: true, force: true });
        }
    });

    it('rejects a symlinked packageRoot before writing an asset', () => {
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-materialize-outside-'));
        try {
            fs.symlinkSync(outside, path.join(projectRoot, 'package'));
            expect(() => materializeResolvedSensors({ projectRoot, packRoot, pack: 'js-ts', packageRoot: 'package', sensors: {
                lint: { enabled: true, variantId: 'eslint-10', command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] }, assets: ['eslint.config.awm.mjs'], initializedCompatibility: evidence },
            } })).toThrow(/symlink|destination/i);
            expect(fs.existsSync(path.join(outside, 'eslint.config.awm.mjs'))).toBe(false);
        } finally {
            fs.rmSync(outside, { recursive: true, force: true });
        }
    });

    it('does not overwrite an asset concurrently published after destination observation', () => {
        const destination = path.join(projectRoot, 'eslint.config.awm.mjs');
        const originalLink = fs.linkSync.bind(fs);
        const link = jest.spyOn(fs, 'linkSync');
        let published = false;
        try {
            link.mockImplementation(((existingPath: fs.PathLike, newPath: fs.PathLike) => {
                if (newPath === destination && !published) {
                    published = true;
                    fs.writeFileSync(destination, 'owner content', { flag: 'wx' });
                }
                return originalLink(existingPath, newPath);
            }) as typeof fs.linkSync);
            const result = materializeResolvedSensors({ projectRoot, packRoot, pack: 'js-ts', sensors: {
                lint: { enabled: true, variantId: 'eslint-10', command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] }, assets: ['eslint.config.awm.mjs'], initializedCompatibility: evidence },
            } });
            expect(result.configured).toEqual([]);
            expect(result.preserved).toEqual(['eslint.config.awm.mjs']);
            expect(fs.readFileSync(destination, 'utf8')).toBe('owner content');
        } finally {
            link.mockRestore();
        }
    });

    test.each(['C:/sensor-assets/eslint.config.awm.mjs', 'C:sensor-assets/eslint.config.awm.mjs'])('rejects Windows-rooted or drive-qualified asset paths: %s', asset => {
        expect(() => materializeResolvedSensors({ projectRoot, packRoot, pack: 'js-ts', sensors: {
            lint: { enabled: true, variantId: 'eslint-10', command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] }, assets: [asset], initializedCompatibility: evidence },
        } })).toThrow(/contained relative asset path/i);
    });

    it('rejects a selected asset beneath a symlinked registry directory before copying it', () => {
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-materialize-outside-'));
        try {
            fs.mkdirSync(path.join(packRoot, 'configs'));
            fs.writeFileSync(path.join(outside, 'eslint.config.awm.mjs'), 'outside content');
            fs.symlinkSync(outside, path.join(packRoot, 'configs', 'linked'));
            expect(() => materializeResolvedSensors({ projectRoot, packRoot, pack: 'js-ts', sensors: {
                lint: { enabled: true, variantId: 'eslint-10', command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] }, assets: ['configs/linked/eslint.config.awm.mjs'], initializedCompatibility: evidence },
            } })).toThrow('symlink');
            expect(fs.existsSync(path.join(projectRoot, 'configs', 'linked', 'eslint.config.awm.mjs'))).toBe(false);
        } finally {
            fs.rmSync(outside, { recursive: true, force: true });
        }
    });

    it('rejects an asset replaced after inspection and before its safe open', () => {
        const originalOpen = fs.openSync.bind(fs);
        const open = jest.spyOn(fs, 'openSync');
        let swapped = false;
        try {
            open.mockImplementation(((file: fs.PathLike, flags: number, mode?: number) => {
                if (!swapped && file === path.join(packRoot, 'eslint.config.awm.mjs')) {
                    swapped = true;
                    fs.renameSync(file, path.join(packRoot, 'eslint.config.awm.original.mjs'));
                    fs.writeFileSync(file, 'replacement content');
                }
                return originalOpen(file, flags, mode);
            }) as typeof fs.openSync);
            expect(() => materializeResolvedSensors({ projectRoot, packRoot, pack: 'js-ts', sensors: {
                lint: { enabled: true, variantId: 'eslint-10', command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] }, assets: ['eslint.config.awm.mjs'], initializedCompatibility: evidence },
            } })).toThrow(/changed|identity|safe/i);
            expect(fs.existsSync(path.join(projectRoot, 'eslint.config.awm.mjs'))).toBe(false);
        } finally {
            open.mockRestore();
        }
    });

    it('re-establishes parent containment immediately before safely opening an asset', () => {
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-materialize-outside-'));
        const originalLstat = fs.lstatSync.bind(fs);
        const lstat = jest.spyOn(fs, 'lstatSync');
        const directory = path.join(packRoot, 'configs');
        let inspections = 0;
        try {
            fs.mkdirSync(directory);
            fs.writeFileSync(path.join(directory, 'eslint.config.awm.mjs'), 'registry content');
            fs.writeFileSync(path.join(outside, 'eslint.config.awm.mjs'), 'outside content');
            lstat.mockImplementation(((candidate: fs.PathLike, options?: fs.StatOptions) => {
                if (candidate === directory && ++inspections === 2) {
                    fs.renameSync(directory, `${directory}.original`);
                    fs.symlinkSync(outside, directory);
                }
                return originalLstat(candidate, options);
            }) as typeof fs.lstatSync);
            expect(() => materializeResolvedSensors({ projectRoot, packRoot, pack: 'js-ts', sensors: {
                lint: { enabled: true, variantId: 'eslint-10', command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] }, assets: ['configs/eslint.config.awm.mjs'], initializedCompatibility: evidence },
            } })).toThrow('symlink');
            expect(fs.existsSync(path.join(projectRoot, 'configs', 'eslint.config.awm.mjs'))).toBe(false);
        } finally {
            lstat.mockRestore();
            fs.rmSync(outside, { recursive: true, force: true });
        }
    });

    it('rejects a pack root reached through a symlinked ancestor before copying registry content', () => {
        const registry = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-materialize-registry-'));
        const linkedRegistry = path.join(path.dirname(registry), `${path.basename(registry)}-linked`);
        const linkedPackRoot = path.join(linkedRegistry, 'sensor-packs', 'js-ts');
        try {
            fs.mkdirSync(path.join(registry, 'sensor-packs', 'js-ts'), { recursive: true });
            fs.writeFileSync(path.join(registry, 'sensor-packs', 'js-ts', 'eslint.config.awm.mjs'), 'outside content');
            fs.symlinkSync(registry, linkedRegistry);
            expect(() => materializeResolvedSensors({ projectRoot, packRoot: linkedPackRoot, pack: 'js-ts', sensors: {
                lint: { enabled: true, variantId: 'eslint-10', command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] }, assets: ['eslint.config.awm.mjs'], initializedCompatibility: evidence },
            } })).toThrow('symlink');
            expect(fs.existsSync(path.join(projectRoot, 'eslint.config.awm.mjs'))).toBe(false);
        } finally {
            fs.rmSync(linkedRegistry, { force: true });
            fs.rmSync(registry, { recursive: true, force: true });
        }
    });

    it('revalidates a shared Semgrep policy reference without materializing the policy itself', () => {
        const sensorPacks = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-materialize-policy-'));
        const semgrepPack = path.join(sensorPacks, 'python');
        try {
            fs.mkdirSync(path.join(sensorPacks, 'shared'), { recursive: true });
            fs.mkdirSync(semgrepPack);
            fs.writeFileSync(path.join(semgrepPack, 'pack.json'), '{}');
            fs.writeFileSync(path.join(semgrepPack, '.semgrep.awm.yml'), 'rules: []\n');
            fs.writeFileSync(path.join(sensorPacks, 'shared', 'semgrep-policy.json'), JSON.stringify({ tool: 'semgrep', toolRange: '>=1.0.0', runtime: 'python', runtimeRange: '>=3.9.0', probe: 'semgrep-validate' }));
            const result = materializeResolvedSensors({ projectRoot, packRoot: semgrepPack, pack: 'python', sensors: {
                security: { enabled: true, variantId: 'semgrep-python', command: { executable: 'semgrep', resolution: 'path', args: ['--config', '.semgrep.awm.yml', '--json', '.'] }, assets: ['.semgrep.awm.yml'], policyRef: 'shared/semgrep-policy.json', initializedCompatibility: { ...evidence, variantId: 'semgrep-python' } },
            } });
            expect(result.configured).toEqual(['.semgrep.awm.yml']);
            expect(fs.existsSync(path.join(projectRoot, 'shared', 'semgrep-policy.json'))).toBe(false);
        } finally {
            fs.rmSync(sensorPacks, { recursive: true, force: true });
        }
    });

    it('reports previous AWM assets as orphaned and never deletes them', () => {
        fs.mkdirSync(path.join(projectRoot, '.awm'));
        fs.writeFileSync(path.join(projectRoot, '.awm', 'sensors.json'), JSON.stringify({ schemaVersion: 2, pack: 'js-ts', sensors: {
            lint: { enabled: true, variantId: 'old', command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] }, assets: ['eslint.config.awm.cjs'], initializedCompatibility: { ...evidence, variantId: 'old' } },
        } }));
        fs.writeFileSync(path.join(projectRoot, 'eslint.config.awm.cjs'), 'old');
        const result = materializeResolvedSensors({ projectRoot, packRoot, pack: 'js-ts', sensors: {
            lint: { enabled: true, variantId: 'eslint-10', command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] }, assets: ['eslint.config.awm.mjs'], initializedCompatibility: evidence },
        } });
        expect(result.orphaned).toEqual(['eslint.config.awm.cjs']);
        expect(fs.existsSync(path.join(projectRoot, 'eslint.config.awm.cjs'))).toBe(true);
    });

    it('preserves a pre-existing manifest temporary file when exclusive creation collides', () => {
        const now = jest.spyOn(Date, 'now').mockReturnValue(12345);
        const awm = path.join(projectRoot, '.awm');
        const temporary = path.join(awm, `.sensors.json.${process.pid}.12345.tmp`);
        try {
            fs.mkdirSync(awm);
            fs.writeFileSync(temporary, 'not ours');
            expect(() => materializeResolvedSensors({ projectRoot, packRoot, pack: 'js-ts', sensors: {
                lint: { enabled: true, variantId: 'eslint-10', command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] }, assets: ['eslint.config.awm.mjs'], initializedCompatibility: evidence },
            } })).toThrow();
            expect(fs.readFileSync(temporary, 'utf8')).toBe('not ours');
            expect(fs.existsSync(path.join(projectRoot, 'eslint.config.awm.mjs'))).toBe(false);
        } finally {
            now.mockRestore();
        }
    });
});
