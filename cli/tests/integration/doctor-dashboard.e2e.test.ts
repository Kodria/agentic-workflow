import crypto from 'crypto';
import { spawnSync, type SpawnSyncReturns } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const cli = path.resolve(__dirname, '../../dist/src/index.js');

type Fixture = { root: string; project: string; home: string };

function treeHash(root: string, ignored = new Set<string>()): string {
    const hash = crypto.createHash('sha256');
    const walk = (directory: string): void => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const item = path.join(directory, entry.name);
            const relative = path.relative(root, item);
            if (ignored.has(relative)) continue;
            hash.update(relative);
            if (entry.isDirectory()) walk(item);
            else if (entry.isFile()) hash.update(fs.readFileSync(item));
        }
    };
    walk(root);
    return hash.digest('hex');
}

function fixture(name: string, project = true): Fixture {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `awm-doctor-${name}-`));
    const directory = project ? path.join(root, 'project') : path.join(root, 'machine-only');
    const home = path.join(root, 'home');
    fs.mkdirSync(directory, { recursive: true });
    fs.mkdirSync(home, { recursive: true });
    if (project) fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name, private: true }));
    return { root, project: directory, home };
}

function command(f: Fixture, ...args: string[]): SpawnSyncReturns<string> {
    return spawnSync(process.execPath, [cli, ...args], {
        cwd: f.project,
        encoding: 'utf8',
        env: { ...process.env, AWM_HOME: f.home, AWM_NO_UPDATE_CHECK: '1' },
    });
}

function snapshot(result: SpawnSyncReturns<string>): Record<string, unknown> {
    if (!result.stdout.trim()) throw new Error(`doctor emitted no JSON: ${result.stderr}`);
    return JSON.parse(result.stdout) as Record<string, unknown>;
}

function writeEvidence(f: Fixture, id: string): void {
    const directory = path.join(f.project, '.awm', 'evidence', 'cycles');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, `${id}.json`), JSON.stringify({
        schema: 1, cycleId: id, startedAt: '2026-08-22T10:00:00.000Z', endedAt: '2026-08-22T10:01:00.000Z', durationMs: 60_000,
        cycleState: 'completed', plan: { ref: 'docs/plans/current.md', state: 'executed' }, tasks: [{ id: 'task-1', attempts: 1, retries: 0 }],
        qa: { findings: 0, fixes: 0, signatures: [] }, gates: { required: 1, firstEvaluationsPassed: [true], firstPass: true }, cures: [],
    }));
}

describe('built doctor dashboard end-to-end (R4.8, R8.3-R8.5)', () => {
    jest.setTimeout(60_000);

    afterEach(() => jest.restoreAllMocks());

    test('machine-only, degraded, partial, and corrupt fixtures are real on-disk states with exact exits and discriminating output', () => {
        const machine = fixture('machine', false);
        const degraded = fixture('degraded');
        const partial = fixture('partial');
        const corrupt = fixture('corrupt');
        fs.mkdirSync(path.join(degraded.project, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(degraded.project, '.awm', 'profile.json'), '{not-json');
        fs.mkdirSync(path.join(partial.project, '.awm', 'evidence', 'cycles'), { recursive: true });
        fs.mkdirSync(path.join(corrupt.project, '.awm', 'evidence', 'cycles'), { recursive: true });
        fs.writeFileSync(path.join(corrupt.project, '.awm', 'evidence', 'cycles', `${'d'.repeat(64)}.json`), '{broken');
        const cases: Array<[string, Fixture, number, RegExp]> = [
            ['machine-only-healthy', machine, 0, /Machine \/ install/],
            ['degraded-project', degraded, 1, /Project readiness/],
            ['partial-source', partial, 1, /source unavailable/i],
            ['corrupt-source', corrupt, 1, /Final \/ history\n  Eligible evidence rows: 0\n  ⊘ source unavailable/],
        ];
        try {
            for (const [, f, exit, discriminant] of cases) {
                const before = treeHash(f.root);
                const result = command(f, 'doctor', '--full');
                expect(result.status).toBe(exit);
                expect(result.stdout).toMatch(discriminant);
                expect(treeHash(f.root)).toBe(before);
            }
        } finally { for (const [, f] of cases) fs.rmSync(f.root, { recursive: true, force: true }); }
    });

    test('json compatibility, full static HTML CSP, hostile source text, long history, and large fixture counts remain safe', () => {
        const f = fixture('hostile');
        try {
            // A hostile optional evidence file must not turn raw markup into HTML.
            writeEvidence(f, 'a'.repeat(64));
            for (let index = 1; index < 500; index++) writeEvidence(f, crypto.createHash('sha256').update(String(index)).digest('hex'));
            fs.writeFileSync(path.join(f.project, 'large-plan.md'), `${'- [ ] task\n'.repeat(2_000)}<script>hostile</script>`);
            const json = command(f, 'doctor', '--json');
            expect([0, 1]).toContain(json.status);
            expect(snapshot(json)).toEqual(expect.objectContaining({ overall: expect.any(String), providers: expect.any(Array) }));
            const before = treeHash(f.root);
            const full = command(f, 'doctor', '--full');
            expect(full.stdout).toContain('Final / history');
            expect(full.stdout).toContain('Cycle');
            expect(treeHash(f.root)).toBe(before);
            const html = command(f, 'doctor', '--html', 'dashboard.html');
            expect([0, 1]).toContain(html.status);
            const page = fs.readFileSync(path.join(f.project, 'dashboard.html'), 'utf8');
            expect(page).toContain('Content-Security-Policy');
            expect(page).toContain("script-src 'none'");
            expect(page).toContain('data-project-evidence');
            expect(page).not.toContain('<script>hostile</script>');
            expect(treeHash(f.root, new Set(['project/dashboard.html']))).toBe(before);
        } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
    });

    test('invalid dashboard combinations exit 2 without mutation', () => {
        const f = fixture('invalid');
        try {
            const before = treeHash(f.root);
            const result = command(f, 'doctor', '--json', '--full');
            expect(result.status).toBe(2);
            expect(result.stderr).toMatch(/cannot be combined/i);
            expect(treeHash(f.root)).toBe(before);
        } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
    });
});
