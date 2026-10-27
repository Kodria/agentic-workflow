import fs from 'fs';
import path from 'path';
import { cloneRepo, makeRepo, type TestRepo } from '../../core/changes/helpers';
import { runChangeNew, runChangeValidate, type ValidateOpts } from '../../../src/commands/change';
import { buildReceipt, writeReceipt, type SensorReceiptMeasurement } from '../../../src/core/changes/receipt';
import { PENDING_MARKER } from '../../../src/core/changes/types';
import type { CommandResult } from '../../../src/core/command-result';
import * as gitModule from '../../../src/core/changes/git';

const REAL_CHANGES_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'docs', 'changes');
const listReal = (): string[] | null => { try { return fs.readdirSync(REAL_CHANGES_DIR).sort(); } catch { return null; } };
const realBefore = listReal();
afterEach(() => expect(listReal()).toEqual(realBefore));

interface Diag { code: string; message: string; field?: string }
interface Rec { path: string; state: string; diagnostics: Diag[] }
interface Report { state: string; records: Rec[] }

let repo: TestRepo;
let template: TestRepo;
const now = () => new Date('2026-10-17T12:00:00.000Z');
const REL = 'docs/changes/2026-10-17-rec.md';
const abs = (rel: string) => path.join(repo.root, ...rel.split('/'));

beforeAll(() => {
    template = makeRepo();
    template.git('checkout', '-q', '-b', 'feat/x');
    // Track sensors.json / baseline for RF-4.5 always-measured late-path cases (default makeRepo ignores `.awm/`).
    template.commit({
        '.gitignore': 'node_modules\n.awm/sensors/runs\n.awm/journal\n.awm/ledger\n.awm/evidence\n',
        'cli/src/a.ts': '1',
        'cli/package.json': '{"name":"cli"}',
        'cli/package-lock.json': '{"lockfileVersion":3}',
        '.awm/sensors.json': '{"schemaVersion":2,"pack":"js-ts","sensors":{}}',
        '.awm/sensors.baseline.json': '{}',
        'README.md': '# root\n',
    }, 'feat(changes): a');
});
afterAll(() => template.cleanup());
beforeEach(() => { repo = cloneRepo(template); });
afterEach(() => { jest.restoreAllMocks(); repo.cleanup(); });

const DIGEST = `sha256:${'a'.repeat(64)}`;
const FINGERPRINT = `sha256:${'b'.repeat(64)}`;

function measurement(overrides: Partial<SensorReceiptMeasurement> = {}): SensorReceiptMeasurement {
    return {
        inputs: ['src/**/*.ts'],
        packageRootRel: 'cli',
        inputDigest: DIGEST,
        sensorFingerprint: FINGERPRINT,
        measuredPaths: ['cli/src/a.ts', '.awm/sensors.json', 'cli/package.json', 'cli/package-lock.json'],
        ...overrides,
    };
}

function writeSchema2Receipt(args: {
    sensors: string[];
    measurements?: Record<string, SensorReceiptMeasurement>;
    alwaysMeasuredPaths?: string[];
}): void {
    const head = repo.git('rev-parse', 'HEAD');
    const sensors = args.sensors.map((name) => ({
        name,
        status: 'pass' as const,
        errors: [],
        ...(args.measurements?.[name]
            ? { measurement: args.measurements[name] }
            : {}),
    }));
    writeReceipt(repo.root, buildReceipt({
        commit: head,
        ranAt: '2026-10-17T11:00:00.000Z',
        cliVersion: '9.21.0',
        output: { overall: 'pass', sensors } as never,
        alwaysMeasuredPaths: args.alwaysMeasuredPaths ?? [
            '.awm/sensors.json',
            '.awm/sensors.baseline.json',
            'cli/package.json',
            'cli/package-lock.json',
        ],
    }));
}

function commitRecord(slug = 'rec', receipt: () => void = () => writeSchema2Receipt({
    sensors: ['lint', 'typecheck'],
    measurements: { lint: measurement(), typecheck: measurement({ inputs: ['src/**/*.ts'] }) },
})): string {
    receipt();
    expect(runChangeNew(repo.root, slug, {}, { now }).code).toBe(0);
    const rel = `docs/changes/2026-10-17-${slug}.md`;
    fs.writeFileSync(abs(rel), fs.readFileSync(abs(rel), 'utf8').split(PENDING_MARKER).join('filled'));
    repo.git('add', '-A');
    repo.git('commit', '-q', '-m', `docs(changes): ${slug}`);
    return rel;
}

const run = (target: string | undefined = undefined, opts: ValidateOpts = {}): CommandResult =>
    runChangeValidate(repo.root, target, { json: true, ...opts });
const report = (r: CommandResult): Report => JSON.parse(r.stdout) as Report;
const diagsOf = (r: CommandResult, index = 0): Diag[] => report(r).records[index].diagnostics;
const codesOf = (r: CommandResult, index = 0): string[] => diagsOf(r, index).map((d) => d.code);
function diag(r: CommandResult, code: string, field: string | undefined): Diag {
    const found = diagsOf(r).filter((d) => d.code === code);
    expect(found).toHaveLength(1);
    expect(found[0].field).toBe(field);
    return found[0];
}

describe('RF-4.5/4.6 schema 2 unmeasured late paths', () => {
    test('RF-4.5: README-only after verify is OK when every sensor had authored inputs', () => {
        commitRecord();
        repo.commit({ 'README.md': '# docs only\n' }, 'docs: readme');
        expect(codesOf(run())).not.toContain('code-changed-after-verification');
        expect(report(run()).state).toBe('valid');
    });

    test('RF-4.6: any sensor without authored inputs keeps schema-1 late rules (README fails)', () => {
        commitRecord('rec', () => writeSchema2Receipt({
            sensors: ['lint', 'test'],
            measurements: { lint: measurement() }, // test has no measurement / no authored inputs
        }));
        repo.commit({ 'README.md': '# docs only\n' }, 'docs: readme');
        expect(codesOf(run())).toContain('code-changed-after-verification');
        expect(diag(run(), 'code-changed-after-verification', undefined).message).toContain('README.md');
    });

    test('RF-4.5: measured path late still fails when relaxation applies', () => {
        commitRecord();
        repo.commit({ 'cli/src/a.ts': '2' }, 'fix: measured');
        expect(codesOf(run())).toContain('code-changed-after-verification');
        expect(diag(run(), 'code-changed-after-verification', undefined).message).toContain('cli/src/a.ts');
    });

    test('RF-4.5: NEW file matching authored inputs globs after verify fails (not frozen measuredPaths only)', () => {
        // Certify with measuredPaths frozen to a.ts only; a later matching source must still count.
        commitRecord('rec', () => writeSchema2Receipt({
            sensors: ['lint'],
            measurements: {
                lint: measurement({
                    inputs: ['src/**/*.ts'],
                    packageRootRel: 'cli',
                    measuredPaths: ['cli/src/a.ts', '.awm/sensors.json', 'cli/package.json', 'cli/package-lock.json'],
                }),
            },
        }));
        repo.commit({ 'cli/src/brand-new.ts': 'export const x = 1;\n' }, 'feat: new matching source');
        expect(codesOf(run())).toContain('code-changed-after-verification');
        expect(diag(run(), 'code-changed-after-verification', undefined).message).toContain('cli/src/brand-new.ts');
    });

    test('RF-4.5: sensors.json late fails (always-measured)', () => {
        commitRecord();
        repo.commit({ '.awm/sensors.json': '{"schemaVersion":2,"pack":"js-ts","sensors":{"lint":{"enabled":false}}}' }, 'chore: sensors');
        expect(codesOf(run())).toContain('code-changed-after-verification');
        expect(diag(run(), 'code-changed-after-verification', undefined).message).toContain('.awm/sensors.json');
    });

    test('RF-4.5: lockfile late fails (always-measured)', () => {
        commitRecord();
        repo.commit({ 'cli/package-lock.json': '{"lockfileVersion":3,"x":1}' }, 'chore: lock');
        expect(codesOf(run())).toContain('code-changed-after-verification');
        expect(diag(run(), 'code-changed-after-verification', undefined).message).toContain('cli/package-lock.json');
    });

    test('RF-4.5: baseline.json late fails (validate always-measured includes baseline, unlike cache)', () => {
        commitRecord();
        repo.commit({ '.awm/sensors.baseline.json': '{"lint":[]}' }, 'chore: baseline');
        expect(codesOf(run())).toContain('code-changed-after-verification');
        expect(diag(run(), 'code-changed-after-verification', undefined).message).toContain('.awm/sensors.baseline.json');
    });

    test('RF-4.8: monorepo packageRoot paths compare as repo-root POSIX', () => {
        commitRecord('rec', () => writeSchema2Receipt({
            sensors: ['lint'],
            measurements: {
                lint: measurement({
                    inputs: ['src/**/*.ts'],
                    measuredPaths: ['cli/src/a.ts', '.awm/sensors.json', 'cli/package.json', 'cli/package-lock.json'],
                }),
            },
        }));
        repo.commit({ 'cli/src/a.ts': 'changed' }, 'fix: under packageRoot');
        const d = diag(run(), 'code-changed-after-verification', undefined);
        expect(d.message).toContain('cli/src/a.ts');
        expect(d.message).not.toMatch(/(^|[^/])src\/a\.ts/);
    });

    test('schema 1 receipts keep strict late rules (only docs/changes carved out)', () => {
        const head = repo.git('rev-parse', 'HEAD');
        // Force a schema-1 write through the legacy shape helper used by older tests.
        const { buildReceipt: build, writeReceipt: write, computeReceiptDigest } = require('../../../src/core/changes/receipt') as typeof import('../../../src/core/changes/receipt');
        const body = {
            schema: 1 as const,
            commit: head,
            ranAt: '2026-10-17T11:00:00.000Z',
            cliVersion: '9.20.0',
            overall: 'pass' as const,
            sensors: { lint: 'pass' as const },
        };
        // buildReceipt now yields schema 2; write a raw schema-1 receipt for this fixture.
        const digest = computeReceiptDigest(body as never);
        write(repo.root, { ...body, digest } as never);
        expect(runChangeNew(repo.root, 'rec', {}, { now }).code).toBe(0);
        fs.writeFileSync(abs(REL), fs.readFileSync(abs(REL), 'utf8').split(PENDING_MARKER).join('filled'));
        repo.git('add', '-A');
        repo.git('commit', '-q', '-m', 'docs(changes): rec');
        repo.commit({ 'README.md': '# docs\n' }, 'docs: readme');
        expect(codesOf(run())).toContain('code-changed-after-verification');
    });

    test('RF-E.2: git failure listing late files is git-failed (fail closed)', () => {
        commitRecord();
        const verified = repo.git('rev-parse', 'HEAD~1');
        const real = gitModule.changedFiles;
        jest.spyOn(gitModule, 'changedFiles').mockImplementation((root, from, to) => (from === verified ? null : real(root, from, to)));
        const r = run();
        expect(r.code).toBe(2);
        expect(diag(r, 'git-failed', undefined).message).toContain('git could not list the files changed since');
    });
});

describe('RF-4.7 change new remedy honesty', () => {
    test('missing HEAD receipt remedy names full-gate sensors run and does not claim every binary must re-exec', () => {
        const r = runChangeNew(repo.root, 'rec', {}, { now });
        expect(r.code).toBe(2);
        expect(r.stderr).toMatch(/^receipt-missing: /);
        expect(r.stderr).toMatch(/full-gate awm sensors run/);
        expect(r.stderr.toLowerCase()).not.toMatch(/every tool|re-exec|reexecute|must re-run every/);
        expect(r.stderr).toMatch(/cache/i);
    });
});
