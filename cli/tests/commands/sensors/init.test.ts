import fs from 'fs';
import path from 'path';
import os from 'os';
import { detectStack, buildManifest, initSensors } from '../../../src/commands/sensors/init';

describe('detectStack', () => {
    let tmpDir: string;
    beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-init-')); });
    afterEach(() => { fs.rmSync(tmpDir, { recursive: true }); });

    it('detects js-ts when package.json exists', () => {
        fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
        expect(detectStack(tmpDir).pack).toBe('js-ts');
    });

    it('detects python when pyproject.toml exists', () => {
        fs.writeFileSync(path.join(tmpDir, 'pyproject.toml'), '');
        expect(detectStack(tmpDir).pack).toBe('python');
    });

    it('falls back to generic when no indicators found', () => {
        expect(detectStack(tmpDir).pack).toBe('generic');
    });
});

describe('buildManifest', () => {
    it('builds manifest with pack defaults for js-ts', () => {
        const m = buildManifest('js-ts');
        expect(m.pack).toBe('js-ts');
        expect(m.sensors.typecheck).toBeDefined();
        expect(m.sensors.lint).toBeDefined();
    });

    it('merges conservatively — existing sensor commands are preserved', () => {
        const existing = { pack: 'js-ts', sensors: { typecheck: { cmd: 'custom-tsc', fast: true } } };
        const m = buildManifest('js-ts', existing);
        expect(m.sensors.typecheck.cmd).toBe('custom-tsc');
        expect(m.sensors.lint).toBeDefined();
    });

    it('uses generic defaults when pack is unknown', () => {
        const m = buildManifest('generic');
        expect(m.sensors.security).toBeDefined();
    });
});

describe('initSensors', () => {
    let tmpDir: string;
    beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-init-')); });
    afterEach(() => { fs.rmSync(tmpDir, { recursive: true }); });

    it('creates .awm/sensors.json for js-ts project', () => {
        fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
        const result = initSensors({ cwd: tmpDir });
        expect(fs.existsSync(path.join(tmpDir, '.awm', 'sensors.json'))).toBe(true);
        expect(result.detection.pack).toBe('js-ts');
        expect(result.manifest.sensors.typecheck).toBeDefined();
    });

    it('is idempotent — existing sensor commands survive re-init', () => {
        fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
        fs.mkdirSync(path.join(tmpDir, '.awm'), { recursive: true });
        const existing = { pack: 'js-ts', sensors: { typecheck: { cmd: 'my-tsc', fast: true } } };
        fs.writeFileSync(path.join(tmpDir, '.awm', 'sensors.json'), JSON.stringify(existing));
        initSensors({ cwd: tmpDir });
        const written = JSON.parse(fs.readFileSync(path.join(tmpDir, '.awm', 'sensors.json'), 'utf-8'));
        expect(written.sensors.typecheck.cmd).toBe('my-tsc');
        expect(written.sensors.lint).toBeDefined(); // new sensor added
    });

    it('copies pack config files to repo with --configure', () => {
        fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
        const registryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-reg-'));
        try {
            const packDir = path.join(registryRoot, 'sensor-packs', 'js-ts');
            fs.mkdirSync(packDir, { recursive: true });
            fs.writeFileSync(path.join(packDir, 'tsconfig.awm.json'), '{}');
            const result = initSensors({ cwd: tmpDir, configure: true, registryRoot });
            expect(result.configured).toContain('tsconfig.awm.json');
            expect(fs.existsSync(path.join(tmpDir, 'tsconfig.awm.json'))).toBe(true);
        } finally { fs.rmSync(registryRoot, { recursive: true }); }
    });
});
