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

    it('reports environments symlink into external store as structural (RF-4.5)', () => {
        const root = path.join(tmp, 'store-symlink');
        scaffoldBare(root, { withBundle: false, minCliVersion: FACTS_MIN_CLI_VERSION });
        const external = path.join(tmp, 'external-env');
        writeJson(path.join(external, 'default', 'values.json'), {
            'repos.root': { value: '/x', status: 'fresh', updatedAt: '2026-01-01T00:00:00Z' },
        });
        fs.symlinkSync(external, path.join(root, 'environments'));
        const { doctorRegistry } = loadDoctor();
        const report = doctorRegistry(root);
        expect(report.structural.some((m) => /environments/i.test(m) && /symlink|RF-4\.5/i.test(m))).toBe(true);
    });

    it('reports values.json / meta.json symlinks under environments as structural (RF-4.5)', () => {
        const root = path.join(tmp, 'store-file-symlink');
        scaffoldBare(root, { withBundle: false, minCliVersion: FACTS_MIN_CLI_VERSION });
        const external = path.join(tmp, 'external-values.json');
        fs.writeFileSync(external, '{"x":1}\n');
        fs.mkdirSync(path.join(root, 'environments', 'default'), { recursive: true });
        fs.symlinkSync(external, path.join(root, 'environments', 'default', 'values.json'));
        const { doctorRegistry } = loadDoctor();
        const report = doctorRegistry(root);
        expect(report.structural.some((m) => /values\.json/i.test(m))).toBe(true);
    });

    it('treats unknown capability id widgets as advisory only; doctorExitCode is 0 (RF-4.4/4.6)', () => {
        const root = path.join(tmp, 'widgets');
        scaffoldBare(root, {
            withBundle: false,
            minCliVersion: FACTS_MIN_CLI_VERSION,
            handbook: handbook(['widgets | planned | future']),
        });
        const { doctorRegistry, doctorExitCode } = loadDoctor();
        const report = doctorRegistry(root);
        expect(report.structural).toEqual([]);
        expect(report.advisories.some((m) => /widgets/i.test(m))).toBe(true);
        expect(doctorExitCode(report)).toBe(0);
        expect(doctorExitCode({ structural: ['x'], advisories: [] })).toBe(1);
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

    it('reports needs without facts.json as structural (fail closed)', () => {
        const root = path.join(tmp, 'needs-no-catalog');
        scaffoldBare(root, { withBundle: false, minCliVersion: FACTS_MIN_CLI_VERSION });
        const skillDir = path.join(root, 'skills', 'demo');
        fs.mkdirSync(skillDir, { recursive: true });
        fs.writeFileSync(
            path.join(skillDir, 'SKILL.md'),
            `---\nname: demo\ndescription: d\nneeds:\n  - repos.root\n---\n# Demo\n`,
        );
        const { doctorRegistry } = loadDoctor();
        const report = doctorRegistry(root);
        expect(report.structural.some((m) => /needs/i.test(m) && /facts\.json/i.test(m) && /missing/i.test(m))).toBe(
            true,
        );
        expect(report.structural.every((m) => !/invalid|unreadable/i.test(m) || !/needs/i.test(m))).toBe(true);
    });

    it('reports needs + invalid facts.json as invalid/unreadable, not missing', () => {
        const root = path.join(tmp, 'needs-bad-catalog');
        scaffoldBare(root, {
            withBundle: false,
            minCliVersion: FACTS_MIN_CLI_VERSION,
            facts: { schemaVersion: 1, facts: {} },
        });
        fs.writeFileSync(path.join(root, 'facts.json'), '{not-json');
        const skillDir = path.join(root, 'skills', 'demo');
        fs.mkdirSync(skillDir, { recursive: true });
        fs.writeFileSync(
            path.join(skillDir, 'SKILL.md'),
            `---\nname: demo\ndescription: d\nneeds:\n  - repos.root\n---\n# Demo\n`,
        );
        const { doctorRegistry } = loadDoctor();
        const report = doctorRegistry(root);
        const needsMsg = report.structural.find((m) => /needs/i.test(m) && /facts\.json/i.test(m));
        expect(needsMsg).toBeDefined();
        expect(needsMsg!).toMatch(/invalid|unreadable/i);
        expect(needsMsg!).not.toMatch(/\bmissing\b/i);
    });

    it('fails structurally when facts present and minCliVersion key absent (RF-4.8)', () => {
        const root = path.join(tmp, 'facts-no-min');
        scaffoldBare(root, {
            withBundle: false,
            facts: { schemaVersion: 1, facts: {} },
        });
        // scaffoldBare omits minCliVersion when not provided
        const { doctorRegistry } = loadDoctor();
        const report = doctorRegistry(root);
        expect(report.structural.some((m) => /minCliVersion/i.test(m))).toBe(true);
    });

    it('rejects empty / non-string root with structural error before path.resolve', () => {
        const { doctorRegistry } = loadDoctor();
        expect(doctorRegistry('').structural.some((m) => /root|required|non-empty|string/i.test(m))).toBe(true);
        expect(doctorRegistry('   ').structural.some((m) => /root|required|non-empty|string/i.test(m))).toBe(true);
        expect(
            doctorRegistry(null as unknown as string).structural.some((m) =>
                /root|required|non-empty|string/i.test(m),
            ),
        ).toBe(true);
    });

    it('reports symlink skill dirs and non-regular SKILL.md as structural (fail closed)', () => {
        const root = path.join(tmp, 'skill-symlink');
        scaffoldBare(root, { withBundle: false, minCliVersion: FACTS_MIN_CLI_VERSION });

        const externalSkill = path.join(tmp, 'external-skill');
        fs.mkdirSync(externalSkill, { recursive: true });
        fs.writeFileSync(path.join(externalSkill, 'SKILL.md'), '---\nname: linked\ndescription: d\n---\n');
        fs.symlinkSync(externalSkill, path.join(root, 'skills', 'linked'));

        const regular = path.join(root, 'skills', 'regular');
        fs.mkdirSync(regular, { recursive: true });
        const externalMd = path.join(tmp, 'external-SKILL.md');
        fs.writeFileSync(externalMd, '---\nname: regular\ndescription: d\n---\n');
        fs.symlinkSync(externalMd, path.join(regular, 'SKILL.md'));

        const { doctorRegistry } = loadDoctor();
        const report = doctorRegistry(root);
        expect(report.structural.some((m) => /linked/i.test(m) && /symlink|skill/i.test(m))).toBe(true);
        expect(report.structural.some((m) => /regular/i.test(m) && /SKILL\.md|symlink|regular file/i.test(m))).toBe(true);
    });

    it('reports unreadable SKILL.md as structural (fail closed)', () => {
        const root = path.join(tmp, 'skill-unreadable');
        scaffoldBare(root, { withBundle: false, minCliVersion: FACTS_MIN_CLI_VERSION });
        const skillDir = path.join(root, 'skills', 'locked');
        fs.mkdirSync(skillDir, { recursive: true });
        const skillMd = path.join(skillDir, 'SKILL.md');
        fs.writeFileSync(skillMd, '---\nname: locked\ndescription: d\n---\n');
        fs.chmodSync(skillMd, 0);
        try {
            const { doctorRegistry } = loadDoctor();
            const report = doctorRegistry(root);
            expect(report.structural.some((m) => /locked|SKILL\.md|Cannot read|unreadable/i.test(m))).toBe(true);
        } finally {
            fs.chmodSync(skillMd, 0o644);
        }
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

    it('wires awm registry doctor [name|path] via doctorExitCode', () => {
        const indexSource = fs.readFileSync(
            path.resolve(__dirname, '../../../src/commands/registry/index.ts'),
            'utf8',
        );
        expect(indexSource).toMatch(/doctorRegistry/);
        expect(indexSource).toMatch(/doctorExitCode/);
        expect(indexSource).toMatch(/process\.exit\(doctorExitCode\(/);
    });
});
