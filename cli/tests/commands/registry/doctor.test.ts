import fs from 'fs';
import os from 'os';
import path from 'path';
import { FACTS_MIN_CLI_VERSION } from '../../../src/core/facts/types';

function writeJson(file: string, value: unknown): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

function handbook(rows: string[]): string {
    const body = rows.length === 0 ? '' : rows.map((r) => `| ${r} |`).join('\n') + '\n';
    return `# fixture

## Capabilities
| id | status | notes |
|----|--------|-------|
${body}
## Capability: facts
Facts chapter.
`;
}

/** Minimal registry that passes structural doctor when facts are unused. */
function scaffoldBare(root: string, opts?: {
    minCliVersion?: string;
    facts?: unknown;
    handbook?: string;
    catalogVersion?: string;
    bundleVersion?: string;
    withBundle?: boolean;
}): void {
    fs.mkdirSync(path.join(root, 'skills'), { recursive: true });
    writeJson(path.join(root, 'awm-registry.json'), {
        overrides: [],
        ...(opts?.minCliVersion !== undefined ? { minCliVersion: opts.minCliVersion } : {}),
    });
    const catalogVersion = opts?.catalogVersion ?? '1.0.0';
    if (opts?.withBundle !== false) {
        writeJson(path.join(root, 'catalog.json'), {
            version: 1,
            bundles: [{ name: 'demo', source: 'bundles/demo', version: catalogVersion, scope: 'project' }],
        });
        writeJson(path.join(root, 'bundles', 'demo', 'bundle.json'), {
            name: 'demo',
            version: opts?.bundleVersion ?? catalogVersion,
            skills: [],
        });
    } else {
        writeJson(path.join(root, 'catalog.json'), { version: 1, bundles: [] });
    }
    fs.writeFileSync(
        path.join(root, 'REGISTRY.md'),
        opts?.handbook ?? handbook(['facts | active | see chapter']),
    );
    if (opts?.facts !== undefined) {
        writeJson(path.join(root, 'facts.json'), opts.facts);
    }
}

describe('doctorRegistry (RF-4.4–4.8, RF-5.1)', () => {
    let tmp: string;

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-doctor-'));
        jest.resetModules();
    });

    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    function loadDoctor(): typeof import('../../../src/commands/registry/doctor') {
        return require('../../../src/commands/registry/doctor');
    }

    it('reports missing REGISTRY.md as structural', () => {
        const root = path.join(tmp, 'no-handbook');
        scaffoldBare(root, { withBundle: false, minCliVersion: FACTS_MIN_CLI_VERSION });
        fs.unlinkSync(path.join(root, 'REGISTRY.md'));
        const { doctorRegistry } = loadDoctor();
        const report = doctorRegistry(root);
        expect(report.structural.some((m) => /missing REGISTRY\.md/i.test(m))).toBe(true);
    });

    it('reports missing Capabilities index as structural', () => {
        const root = path.join(tmp, 'no-caps');
        scaffoldBare(root, {
            withBundle: false,
            minCliVersion: FACTS_MIN_CLI_VERSION,
            handbook: '# fixture\n\nNo capabilities table here.\n',
        });
        const { doctorRegistry } = loadDoctor();
        const report = doctorRegistry(root);
        expect(report.structural.some((m) => /Capabilities/i.test(m))).toBe(true);
    });

    it('reports catalog vs bundle.json version skew as structural (RF-4.7)', () => {
        const root = path.join(tmp, 'skew');
        scaffoldBare(root, {
            minCliVersion: FACTS_MIN_CLI_VERSION,
            catalogVersion: '1.0.0',
            bundleVersion: '2.0.0',
        });
        const { doctorRegistry } = loadDoctor();
        const report = doctorRegistry(root);
        expect(report.structural.some((m) => /version/i.test(m) && /demo/i.test(m))).toBe(true);
    });

    it('reports environment store files under registry tree as structural (RF-4.5)', () => {
        const root = path.join(tmp, 'store-in-tree');
        scaffoldBare(root, { withBundle: false, minCliVersion: FACTS_MIN_CLI_VERSION });
        const store = path.join(root, 'environments', 'default', 'values.json');
        writeJson(store, { 'repos.root': { value: '/x', status: 'fresh', updatedAt: '2026-01-01T00:00:00Z' } });
        const { doctorRegistry } = loadDoctor();
        const report = doctorRegistry(root);
        expect(report.structural.some((m) => /environments/i.test(m) || /values\.json/i.test(m))).toBe(true);
    });

    it('treats unknown capability id widgets as advisory only and exits 0 when alone (RF-4.4/4.6)', () => {
        const root = path.join(tmp, 'widgets');
        scaffoldBare(root, {
            withBundle: false,
            minCliVersion: FACTS_MIN_CLI_VERSION,
            handbook: handbook(['widgets | planned | future']),
        });
        const { doctorRegistry } = loadDoctor();
        const report = doctorRegistry(root);
        expect(report.structural).toEqual([]);
        expect(report.advisories.some((m) => /widgets/i.test(m))).toBe(true);
        const exitCode = report.structural.length ? 1 : 0;
        expect(exitCode).toBe(0);
    });

    it('fails structurally when facts present and minCliVersion below FACTS_MIN_CLI_VERSION (RF-4.8)', () => {
        const root = path.join(tmp, 'old-cli');
        scaffoldBare(root, {
            withBundle: false,
            minCliVersion: '9.17.0',
            facts: { schemaVersion: 1, facts: {} },
        });
        const { doctorRegistry } = loadDoctor();
        const report = doctorRegistry(root);
        expect(report.structural.some((m) => /minCliVersion/i.test(m) || /9\.18\.0/.test(m))).toBe(true);
    });

    it('advises on prose home-path hints like ~/Developments', () => {
        const root = path.join(tmp, 'prose');
        scaffoldBare(root, { withBundle: false, minCliVersion: FACTS_MIN_CLI_VERSION });
        const skillDir = path.join(root, 'skills', 'demo');
        fs.mkdirSync(skillDir, { recursive: true });
        fs.writeFileSync(
            path.join(skillDir, 'SKILL.md'),
            `---\nname: demo\ndescription: d\n---\nClone under ~/Developments/team.\n`,
        );
        const { doctorRegistry } = loadDoctor();
        const report = doctorRegistry(root);
        expect(report.advisories.some((m) => /~\/Developments|home path|machine path/i.test(m))).toBe(true);
    });

    it('reports orphan needs as structural when facts.json exists (RF-1.3)', () => {
        const root = path.join(tmp, 'orphan');
        scaffoldBare(root, {
            withBundle: false,
            minCliVersion: FACTS_MIN_CLI_VERSION,
            facts: {
                schemaVersion: 1,
                facts: { 'repos.root': { valueType: 'path' } },
            },
        });
        const skillDir = path.join(root, 'skills', 'demo');
        fs.mkdirSync(skillDir, { recursive: true });
        fs.writeFileSync(
            path.join(skillDir, 'SKILL.md'),
            `---\nname: demo\ndescription: d\nneeds:\n  - ghost.fact\n---\n# Demo\n`,
        );
        const { doctorRegistry } = loadDoctor();
        const report = doctorRegistry(root);
        expect(report.structural.some((m) => /ghost\.fact|orphan/i.test(m))).toBe(true);
    });

    it('does not require facts chapter beyond Capabilities when no facts.json and no needs', () => {
        const root = path.join(tmp, 'legacy');
        scaffoldBare(root, {
            withBundle: false,
            handbook: handbook(['hooks | n/a | none']),
        });
        const { doctorRegistry } = loadDoctor();
        const report = doctorRegistry(root);
        expect(report.structural).toEqual([]);
    });

    it('doctor API is path-only and does not require writing-skills (RF-5.1)', () => {
        const source = fs.readFileSync(
            path.resolve(__dirname, '../../../src/commands/registry/doctor.ts'),
            'utf8',
        );
        expect(source).toMatch(/export function doctorRegistry\(\s*root:\s*string/);
        expect(source).not.toMatch(/writing-skills/);
        expect(source).not.toMatch(/writeSkill|writeFileSync.*SKILL/);
    });

    it('wires awm registry doctor [name|path] with structural exit code', () => {
        const indexSource = fs.readFileSync(
            path.resolve(__dirname, '../../../src/commands/registry/index.ts'),
            'utf8',
        );
        expect(indexSource).toMatch(/doctor/);
        expect(indexSource).toMatch(/structural\.length\s*\?\s*1\s*:\s*0|process\.exit\(.*structural/);
    });
});
