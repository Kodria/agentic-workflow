import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { FACTS_MIN_CLI_VERSION } from '../../../src/core/facts/types';
import { compareSemver } from '../../../src/core/versioning';

const GIT = (cwd: string, cmd: string) =>
    execSync(`git -c user.email=t@t.t -c user.name=t ${cmd}`, { cwd, stdio: 'pipe' });

describe('scaffoldRegistry (RF-4.1, RF-4.2, RF-4.3)', () => {
    let tmp: string;

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-scaffold-'));
        jest.resetModules();
    });

    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    function loadScaffold(): {
        scaffoldRegistry: (
            dir: string,
            opts?: { writeFileSync?: (file: string, data: string | NodeJS.ArrayBufferView) => void },
        ) => { ok: true; dir: string } | { ok: false; error: string };
    } {
        return require('../../../src/commands/registry/scaffold');
    }

    function loadDoctor(): { doctorRegistry: (root: string) => { structural: string[]; advisories: string[] } } {
        return require('../../../src/commands/registry/doctor');
    }

    function loadValidate(): { validateRegistryLayout: (root: string) => boolean } {
        return require('../../../src/core/registries');
    }

    it('writes min layout with versions, facts, handbook; doctor structural empty (RF-4.1/4.2)', () => {
        const dir = path.join(tmp, 'new-reg');
        const { scaffoldRegistry } = loadScaffold();
        const result = scaffoldRegistry(dir);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'awm-registry.json'), 'utf-8'));
        expect(typeof manifest.minCliVersion).toBe('string');
        expect(manifest.minCliVersion).not.toMatch(/^v/i);
        expect(compareSemver(manifest.minCliVersion, FACTS_MIN_CLI_VERSION)).toBeGreaterThanOrEqual(0);

        const catalog = JSON.parse(fs.readFileSync(path.join(dir, 'catalog.json'), 'utf-8'));
        expect(catalog).toEqual({ version: 1, bundles: [] });

        expect(fs.statSync(path.join(dir, 'skills')).isDirectory()).toBe(true);
        expect(fs.existsSync(path.join(dir, 'skills', '.gitkeep'))).toBe(true);

        const facts = JSON.parse(fs.readFileSync(path.join(dir, 'facts.json'), 'utf-8'));
        expect(facts).toEqual({ schemaVersion: 1, facts: {} });

        const handbook = fs.readFileSync(path.join(dir, 'REGISTRY.md'), 'utf-8');
        expect(handbook).toMatch(/^##\s+Capabilities\s*$/m);
        expect(handbook).toMatch(/^\|\s*id\s*\|\s*status\s*\|\s*notes\s*\|$/m);
        const capsStart = handbook.search(/^##\s+Capabilities\s*$/m);
        const nextH2 = handbook.slice(capsStart + 1).search(/^##\s+/m);
        const capsWindow =
            nextH2 === -1
                ? handbook.slice(capsStart)
                : handbook.slice(capsStart, capsStart + 1 + nextH2);
        expect(capsWindow).toMatch(/\|\s*facts\s*\|\s*active\s*\|/);
        expect(handbook).toMatch(/^##\s+Capability:\s*facts\s*$/m);

        const { doctorRegistry } = loadDoctor();
        expect(doctorRegistry(dir).structural).toEqual([]);
    });

    it('survives git commit+clone: layout valid and doctor structural empty (RF-4.1)', () => {
        const src = path.join(tmp, 'scaffold-src');
        const { scaffoldRegistry } = loadScaffold();
        const scaffolded = scaffoldRegistry(src);
        expect(scaffolded.ok).toBe(true);
        if (!scaffolded.ok) return;

        GIT(src, 'init -q');
        GIT(src, 'add -A');
        GIT(src, 'commit -qm scaffold');

        const clone = path.join(tmp, 'scaffold-clone');
        execSync(`git clone -q "${src}" "${clone}"`, { stdio: 'pipe' });

        expect(fs.existsSync(path.join(clone, 'skills', '.gitkeep'))).toBe(true);
        const { validateRegistryLayout } = loadValidate();
        expect(validateRegistryLayout(clone)).toBe(true);
        const { doctorRegistry } = loadDoctor();
        expect(doctorRegistry(clone).structural).toEqual([]);
    });

    it('refuses non-empty existing dir without writing (RF-4.3)', () => {
        const dir = path.join(tmp, 'occupied');
        fs.mkdirSync(dir);
        const sentinel = path.join(dir, 'keep-me.txt');
        fs.writeFileSync(sentinel, 'pre-existing\n');

        const { scaffoldRegistry } = loadScaffold();
        const result = scaffoldRegistry(dir);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toMatch(/exist|non-empty|not empty|overwrite/i);

        expect(fs.readFileSync(sentinel, 'utf-8')).toBe('pre-existing\n');
        expect(fs.existsSync(path.join(dir, 'awm-registry.json'))).toBe(false);
        expect(fs.existsSync(path.join(dir, 'REGISTRY.md'))).toBe(false);
        expect(fs.existsSync(path.join(dir, 'facts.json'))).toBe(false);
    });

    it('cleans up a directory it created when a mid-write fails (RF-4.3)', () => {
        const dir = path.join(tmp, 'partial-fail');
        expect(fs.existsSync(dir)).toBe(false);

        const { scaffoldRegistry } = loadScaffold();
        let writes = 0;
        const result = scaffoldRegistry(dir, {
            writeFileSync: (file, data) => {
                writes += 1;
                if (writes >= 3) {
                    throw new Error('injected write failure');
                }
                fs.writeFileSync(file, data);
            },
        });

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toContain('injected write failure');
        expect(fs.existsSync(dir)).toBe(false);
    });

    it('empty preexisting target: mid-fail leaves it empty so retry succeeds (RF-4.3)', () => {
        const dir = path.join(tmp, 'empty-preexisting');
        fs.mkdirSync(dir);
        expect(fs.readdirSync(dir)).toEqual([]);

        const { scaffoldRegistry } = loadScaffold();
        let writes = 0;
        const failed = scaffoldRegistry(dir, {
            writeFileSync: (file, data) => {
                writes += 1;
                if (writes >= 3) {
                    throw new Error('injected write failure');
                }
                fs.writeFileSync(file, data);
            },
        });

        expect(failed.ok).toBe(false);
        if (failed.ok) return;
        expect(failed.error).toContain('injected write failure');

        // Target must not hold partial scaffold files (stage-then-rename).
        if (fs.existsSync(dir)) {
            expect(fs.readdirSync(dir)).toEqual([]);
        }

        const retry = scaffoldRegistry(dir);
        expect(retry.ok).toBe(true);
        if (!retry.ok) return;
        expect(fs.existsSync(path.join(dir, 'awm-registry.json'))).toBe(true);
        expect(fs.existsSync(path.join(dir, 'REGISTRY.md'))).toBe(true);
        const { doctorRegistry } = loadDoctor();
        expect(doctorRegistry(dir).structural).toEqual([]);
    });
});
