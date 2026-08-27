import fs from 'fs';
import os from 'os';
import path from 'path';
import { materializePortableSensors, materializeResolvedSensors } from '../../../../src/commands/sensors/compatibility/materialize';

const evidence = { state: 'certified' as const, reason: 'range-and-probe', variantId: 'eslint-10', toolVersion: '10.0.0', runtimeVersion: '22.0.0', certifiedRange: '>=10 <11', evidence: [] };

describe('materializeResolvedSensors', () => {
    let projectRoot: string;
    let packRoot: string;
    beforeEach(() => {
        projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-materialize-project-'));
        packRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-materialize-pack-'));
        fs.writeFileSync(path.join(packRoot, 'eslint.config.awm.mjs'), 'export default [];');
        fs.writeFileSync(path.join(packRoot, 'tsconfig.awm.json'), '{}');
    });
    afterEach(() => {
        fs.rmSync(projectRoot, { recursive: true, force: true });
        fs.rmSync(packRoot, { recursive: true, force: true });
    });

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
        const result = materializePortableSensors({ projectRoot, packRoot, pack: 'js-ts', registry: 'baseline', sensors: {
            lint: { enabled: true, variantId: 'eslint-10', command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] }, assets: ['eslint.config.awm.mjs'], initializedCompatibility: evidence },
        } });
        expect(result.manifest).toMatchObject({ schemaVersion: 3, mode: 'project-sensors', source: { registry: 'baseline' } });
        const text = fs.readFileSync(path.join(projectRoot, '.awm', 'sensors.json'), 'utf8');
        expect(text.endsWith('\n')).toBe(true);
        expect(text).not.toContain(packRoot);
        expect(JSON.parse(text)).toMatchObject({ source: { registry: 'baseline' } });
    });

    it('validates v3 input before writes and cleans copied assets when manifest replacement fails', () => {
        fs.writeFileSync(path.join(projectRoot, '.awm'), 'not a directory');
        expect(() => materializePortableSensors({ projectRoot, packRoot, pack: 'js-ts', registry: 'baseline', sensors: {
            lint: { enabled: true, variantId: 'eslint-10', command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] }, assets: ['eslint.config.awm.mjs'], initializedCompatibility: evidence },
        } })).toThrow();
        expect(fs.existsSync(path.join(projectRoot, 'eslint.config.awm.mjs'))).toBe(false);
        expect(fs.readFileSync(path.join(projectRoot, '.awm'), 'utf8')).toBe('not a directory');
        expect(() => materializePortableSensors({ projectRoot, packRoot, pack: 'js-ts', registry: 'Baseline', sensors: {
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
