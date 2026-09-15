import fs from 'fs';
import { exec, execFileSync, execSync, spawn, spawnSync } from 'child_process';
import os from 'os';
import path from 'path';
import { parseJsonNoDuplicate } from '../../../src/core/plan/json';
import type { PlanValidationReport } from '../../../src/core/plan/types';
import { validatePlanFile } from '../../../src/core/plan/validate';

jest.mock('child_process', () => ({ exec: jest.fn(), execFileSync: jest.fn(), execSync: jest.fn(), spawn: jest.fn(), spawnSync: jest.fn() }));

const START = '<!-- AWM:COMPACT-SLICES:START v1 -->';
const END = '<!-- AWM:COMPACT-SLICES:END v1 -->';

function expectApprovedPlanValid(report: PlanValidationReport): void {
    if (report.state !== 'valid') {
        const diagnostics = 'diagnostics' in report
            ? report.diagnostics.map(({ code, message }) => `${code}: ${message}`).join('; ')
            : 'none';
        throw new Error(`approved compact plan validation failed: state=${report.state}; diagnostics=${diagnostics}`);
    }
    expect(report.schema).toBe('compact-slices/v1');
}

function assertFrozenObjectGraph(value: unknown, location = 'report', visited = new WeakSet<object>()): void {
    if (value === null || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    if (!Object.isFrozen(value)) throw new Error(`${location} is mutable`);
    for (const key of Reflect.ownKeys(value)) {
        const property = Object.getOwnPropertyDescriptor(value, key);
        if (property && 'value' in property) assertFrozenObjectGraph(property.value, `${location}.${String(key)}`, visited);
    }
}

function fixture(root: string, mutate?: (manifest: Record<string, unknown>) => void): string {
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'source.md'), '## Source\nKnown fact\n');
    const manifest: Record<string, unknown> = {
        schema: 'compact-slices/v1', planId: 'valid-plan', requirements: ['R4-VAL-2'],
        sources: [{ id: 'SRC-ONE', path: 'docs/source.md', locator: '## Source', fact: 'Known fact' }],
        commands: [{ id: 'CMD-ONE', program: 'npm', args: ['test'], covers: ['R4-VAL-2'] }],
        slices: [{ id: 'S1', title: 'Validate one thing', requirements: ['R4-VAL-2'], dependsOn: [], sectionAnchor: 'slice-s1', sources: ['SRC-ONE'], redCommands: ['CMD-ONE'], greenCommands: ['CMD-ONE'], reviewEvidence: ['specification', 'code-quality'], risk: 'bounded', fallback: ['Use a reviewed fallback'] }],
        closureCommands: ['CMD-ONE'],
    };
    mutate?.(manifest);
    const markdown = `${START}\n${JSON.stringify(manifest, null, 2)}\n${END}\n\n<a id="slice-s1"></a>\n### Slice S1: Validate one thing\n\n#### Surfaces\n\nOne surface.\n\n#### Implementation\n\nOne implementation.\n\n#### Edge cases\n\nOne edge case.\n\n#### Evidence\n\nOne evidence item.\n\n#### Fallback\n\nOne fallback.\n`;
    const plan = path.join(root, 'plan.md');
    fs.writeFileSync(plan, markdown);
    return plan;
}

describe('validatePlanFile', () => {
    let root: string;
    beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-plan-')); });
    afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

    test('accepts a valid compact plan without modifying it', () => {
        const plan = fixture(root); const before = fs.readFileSync(plan, 'utf8');
        expect(validatePlanFile(plan, root)).toMatchObject({ state: 'valid', schema: 'compact-slices/v1' });
        expect(fs.readFileSync(plan, 'utf8')).toBe(before);
    });

    test('makes an approved valid report and its nested manifest immutable after verification', () => {
        const report = validatePlanFile(fixture(root), root);
        expectApprovedPlanValid(report);
        if (report.state !== 'valid') throw new Error('expected an approved compact plan');
        const slice = report.manifest.slices[0];
        assertFrozenObjectGraph(report);
        expect(Reflect.set(report.manifest.requirements, '0', 'R4-FORGED')).toBe(false);
        expect(Reflect.set(report.manifest.sources[0], 'fact', 'forged fact')).toBe(false);
        expect(Reflect.set(report.manifest.commands[0].args, '0', 'forged-arg')).toBe(false);
        expect(Reflect.set(slice.fallback, '0', 'forged fallback')).toBe(false);
        expect(Reflect.set(slice.reviewEvidence, '1', 'bogus')).toBe(false);
        expect(Reflect.set(slice, 'risk', 'unbounded')).toBe(false);
        expect(Reflect.set(report.manifest.closureCommands, '0', 'CMD-MISSING')).toBe(false);
        expect(report.manifest.requirements).toEqual(['R4-VAL-2']);
        expect(report.manifest.sources[0].fact).toBe('Known fact');
        expect(report.manifest.commands[0].args).toEqual(['test']);
        expect(slice.fallback).toEqual(['Use a reviewed fallback']);
        expect(slice.reviewEvidence).toEqual(['specification', 'code-quality']);
        expect(slice.risk).toBe('bounded');
        expect(report.manifest.closureCommands).toEqual(['CMD-ONE']);
    });

    test('detects a selectively thawed command-args node even when every ancestor is frozen', () => {
        const report = validatePlanFile(fixture(root), root);
        expectApprovedPlanValid(report);
        const thawed = JSON.parse(JSON.stringify(report)) as Extract<PlanValidationReport, { state: 'valid' }>;
        const mutableArgs = thawed.manifest.commands[0].args;
        const freezeExceptArgs = (value: unknown): void => {
            if (value === null || typeof value !== 'object' || value === mutableArgs) return;
            for (const child of Object.values(value)) freezeExceptArgs(child);
            Object.freeze(value);
        };
        freezeExceptArgs(thawed);
        expect(Object.isFrozen(thawed.manifest.commands[0])).toBe(true);
        expect(Object.isFrozen(mutableArgs)).toBe(false);
        expect(Reflect.set(mutableArgs, '0', 'tampered')).toBe(true);
        expect(() => assertFrozenObjectGraph(thawed)).toThrow('report.manifest.commands.0.args is mutable');
    });

    test('scans bounded markerless brace runs without quadratic retries', () => {
        const plan = path.join(root, 'braces.md');
        fs.writeFileSync(plan, '{'.repeat(32_000));
        const started = Date.now();
        const report = validatePlanFile(plan, root);
        expect(report).toEqual({ state: 'migration-required', reason: 'unmarked-plan' });
        expect(Date.now() - started).toBeLessThan(500);
    });

    test('retains markerless unsupported classification for nested JSON in an unclosed outer object', () => {
        const plan = path.join(root, 'nested-future.md');
        fs.writeFileSync(plan, '# Notes\n{"outer":\n{"\\u0073chema":"compact\\u002dslices\\/v2"}\n');
        expect(validatePlanFile(plan, root)).toMatchObject({ state: 'unsupported', schema: 'compact-slices/v2' });
    });

    test('retains the manifest byte limit beneath the bounded plan-file limit', () => {
        const plan = fixture(root);
        const text = fs.readFileSync(plan, 'utf8');
        fs.writeFileSync(plan, text.replace(END, `${' '.repeat(256 * 1024)}\n${END}`));
        expect(validatePlanFile(plan, root)).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code: 'PLAN_LIMIT' })] });
    });

    test.each([
        ['plan', 'PLAN_LIMIT'],
        ['source', 'PLAN_SOURCE_LIMIT'],
    ] as const)('bounds %s bytes when the inspected file grows during descriptor read', (target, code) => {
        const plan = fixture(root);
        const targetPath = target === 'plan' ? plan : path.join(root, 'docs', 'source.md');
        const targetInode = fs.statSync(targetPath).ino;
        const nativeFstat = fs.fstatSync;
        let grew = false;
        const fstat = jest.spyOn(fs, 'fstatSync').mockImplementation((descriptor) => {
            const observed = nativeFstat(descriptor);
            if (!grew && observed.ino === targetInode) {
                fs.appendFileSync(targetPath, Buffer.alloc(1024 * 1024));
                grew = true;
            }
            return observed;
        });
        try {
            expect(validatePlanFile(plan, root)).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code })] });
            expect(grew).toBe(true);
        } finally { fstat.mockRestore(); }
    });

    test.each([
        ['plan', 'final', 'PLAN_PATH_UNSAFE'],
        ['plan', 'ancestor', 'PLAN_PATH_UNSAFE'],
        ['source', 'final', 'PLAN_SOURCE_UNSAFE'],
        ['source', 'ancestor', 'PLAN_SOURCE_UNSAFE'],
    ] as const)('rejects a %s %s symlink swap after inspection without reading outside', (target, swap, code) => {
        let plan = fixture(root);
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-plan-race-outside-'));
        const targetDirectory = target === 'plan' ? path.join(root, 'plans') : path.join(root, 'docs');
        if (target === 'plan') {
            fs.mkdirSync(targetDirectory);
            const nestedPlan = path.join(targetDirectory, 'plan.md');
            fs.renameSync(plan, nestedPlan);
            plan = nestedPlan;
        }
        const inspectedPath = target === 'plan' ? plan : path.join(root, 'docs', 'source.md');
        const outsideFile = path.join(outside, path.basename(inspectedPath));
        fs.copyFileSync(inspectedPath, outsideFile);
        const outsideIdentity = fs.statSync(outsideFile);
        const nativeRealpath = fs.realpathSync;
        let swapped = false;
        const realpath = jest.spyOn(fs, 'realpathSync').mockImplementation((file) => {
            const resolved = nativeRealpath(file);
            if (!swapped && file === inspectedPath) {
                swapped = true;
                if (swap === 'final') {
                    fs.renameSync(inspectedPath, `${inspectedPath}-original`);
                    fs.symlinkSync(outsideFile, inspectedPath, 'file');
                } else {
                    fs.renameSync(targetDirectory, `${targetDirectory}-original`);
                    fs.symlinkSync(outside, targetDirectory, 'dir');
                }
            }
            return resolved;
        });
        const reads = jest.spyOn(fs, 'readFileSync');
        const nativeReadSync = fs.readSync;
        let outsideDescriptorReads = 0;
        const descriptorReads = jest.spyOn(fs, 'readSync').mockImplementation((...args: Parameters<typeof fs.readSync>) => {
            const opened = fs.fstatSync(args[0]);
            if (opened.dev === outsideIdentity.dev && opened.ino === outsideIdentity.ino) outsideDescriptorReads += 1;
            return Reflect.apply(nativeReadSync, fs, args) as number;
        });
        try {
            expect(validatePlanFile(plan, root)).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code })] });
            expect(swapped).toBe(true);
            expect(reads.mock.calls.some(([file]) => file === inspectedPath)).toBe(false);
            expect(outsideDescriptorReads).toBe(0);
        } finally {
            descriptorReads.mockRestore(); reads.mockRestore(); realpath.mockRestore();
            fs.rmSync(outside, { recursive: true, force: true });
        }
    });

    test('accepts a valid compact plan converted to CRLF', () => {
        const plan = fixture(root);
        fs.writeFileSync(plan, fs.readFileSync(plan, 'utf8').replace(/\n/g, '\r\n'));
        expect(validatePlanFile(plan, root)).toMatchObject({ state: 'valid', schema: 'compact-slices/v1' });
    });

    test('accepts a contained plan when path.relative returns Windows separators', () => {
        const plan = fixture(root);
        const nestedPlan = path.join(root, 'docs', 'plan.md');
        fs.renameSync(plan, nestedPlan);
        const nativeRelative = path.relative;
        const relative = jest.spyOn(path, 'relative');
        relative.mockImplementation((from, to) => {
            const result = nativeRelative(from, to);
            return from === root && to === nestedPlan ? result.replace(/\//g, '\\') : result;
        });
        try {
            expect(validatePlanFile(nestedPlan, root)).toMatchObject({ state: 'valid', schema: 'compact-slices/v1' });
        } finally {
            relative.mockRestore();
        }
    });

    test('accepts the approved plan with cross-cutting command coverage', () => {
        const repositoryRoot = path.resolve(__dirname, '../../../..');
        expectApprovedPlanValid(validatePlanFile('docs/plans/2026-08-26-r4a-compact-plan-cli-plan.md', repositoryRoot));
    });

    test('preserves every previously valid tracked compact-v1 plan', () => {
        const repositoryRoot = path.resolve(__dirname, '../../../..');
        const tracked = (jest.requireActual('child_process') as typeof import('child_process'))
            .execFileSync('git', ['ls-files', '--', 'docs/plans/*.md'], { cwd: repositoryRoot, encoding: 'utf8' })
            .trim().split('\n').filter(Boolean);
        const marked = tracked.filter((file) => fs.readFileSync(path.join(repositoryRoot, file), 'utf8').includes(START));
        const previouslyValid = [
            'docs/plans/2026-08-26-r4a-compact-plan-cli-plan.md',
            'docs/plans/2026-08-27-sensor-portability-publication-a-plan.md',
            'docs/plans/2026-09-07-retire-onsignal.md',
            'docs/plans/2026-09-14-compact-only-bootstrap-plan.md',
        ];
        expect(marked.length).toBeGreaterThan(0);
        expect(previouslyValid.length).toBeGreaterThan(0);
        const corpusCounts = `marked=${marked.length}; previouslyValid=${previouslyValid.length}; historicalInvalid=${marked.length - previouslyValid.length}`;
        for (const file of previouslyValid) {
            if (!marked.includes(file)) throw new Error(`previously valid compact-v1 plan is not tracked with a marker: ${file}; ${corpusCounts}`);
            const report = validatePlanFile(file, repositoryRoot);
            if (report.state !== 'valid') throw new Error(`previously valid compact-v1 plan failed: ${file}; state=${report.state}; ${corpusCounts}`);
            assertFrozenObjectGraph(report, file);
        }
    });

    test.each(['RF-1.3', 'RNF-T.2', 'R4-VAL-2', 'A'.repeat(62) + '.1'])('accepts canonical bounded requirement ID %s in every requirement reference', (id) => {
        const report = validatePlanFile(fixture(root, (manifest) => {
            manifest.requirements = [id];
            (manifest.commands as Record<string, unknown>[])[0].covers = [id];
            (manifest.slices as Record<string, unknown>[])[0].requirements = [id];
        }), root);
        expect(report).toMatchObject({ state: 'valid', manifest: { requirements: [id] } });
    });

    test.each([
        '.RF-1', 'RF-1.', 'RF..1', 'rf-1.3', 'RF-1.a', ' RF-1.3', 'RF-1.3 ',
        'RF-1. 3', 'RF-1/3', 'RF-1\\3', 'RF-1.é', 'RF-1.\u0000', 'RF-1.\u007f',
        'A'.repeat(63) + '.1',
    ])('rejects malformed or oversized requirement ID %j', (id) => {
        const report = validatePlanFile(fixture(root, (manifest) => {
            manifest.requirements = [id];
            (manifest.commands as Record<string, unknown>[])[0].covers = [id];
            (manifest.slices as Record<string, unknown>[])[0].requirements = [id];
        }), root);
        expect(report).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code: 'PLAN_SHAPE' })] });
    });

    test.each([
        ['source', (m: Record<string, unknown>) => { (m.sources as Record<string, unknown>[])[0].id = 'SRC.ONE'; }, 'PLAN_SOURCE_SHAPE'],
        ['command', (m: Record<string, unknown>) => { (m.commands as Record<string, unknown>[])[0].id = 'CMD.ONE'; }, 'PLAN_COMMAND_SHAPE'],
        ['slice', (m: Record<string, unknown>) => { (m.slices as Record<string, unknown>[])[0].id = 'S.1'; }, 'PLAN_SLICE_SHAPE'],
    ])('keeps dotted %s entity IDs invalid', (_name, mutate, code) => {
        expect(validatePlanFile(fixture(root, mutate), root)).toMatchObject({
            state: 'invalid', diagnostics: [expect.objectContaining({ code })],
        });
    });

    test('performs no execution, network request, model work, grouping, or rewrite', () => {
        const plan = fixture(root); const before = fs.readFileSync(plan, 'utf8');
        const network = jest.spyOn(global, 'fetch');
        const rewrite = jest.spyOn(fs, 'writeFileSync');
        try {
            const report = validatePlanFile(plan, root);
            expect(report).toMatchObject({ state: 'valid', manifest: { slices: [expect.objectContaining({ id: 'S1', requirements: ['R4-VAL-2'] })] } });
            expect(execFileSync).not.toHaveBeenCalled();
            expect(exec).not.toHaveBeenCalled();
            expect(execSync).not.toHaveBeenCalled();
            expect(spawn).not.toHaveBeenCalled();
            expect(spawnSync).not.toHaveBeenCalled();
            expect(network).not.toHaveBeenCalled();
            expect(rewrite).not.toHaveBeenCalled();
            expect(fs.readFileSync(plan, 'utf8')).toBe(before);
        } finally { network.mockRestore(); rewrite.mockRestore(); }
    });

    test('rejects invalid UTF-8 bytes before interpreting plan text', () => {
        const plan = path.join(root, 'invalid-utf8.md');
        fs.writeFileSync(plan, Buffer.concat([Buffer.from(`${START}\n`), Buffer.from([0x80]), Buffer.from(`\n${END}\n`)]));
        expect(validatePlanFile(plan, root)).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code: 'PLAN_ENCODING' })] });
    });

    test('rejects a plan reached through a symlinked parent directory', () => {
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-plan-outside-'));
        try {
            const plan = fixture(outside);
            fs.symlinkSync(outside, path.join(root, 'linked-parent'));
            expect(validatePlanFile(path.join('linked-parent', path.basename(plan)), root)).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code: 'PLAN_PATH_UNSAFE' })] });
        } finally { fs.rmSync(outside, { recursive: true, force: true }); }
    });

    test('rejects partial markers and identifies a safely readable future schema', () => {
        const partial = path.join(root, 'partial.md'); fs.writeFileSync(partial, `${START}\n# incomplete`);
        expect(validatePlanFile(partial, root)).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code: 'PLAN_MARKERS' })] });
        const future = path.join(root, 'future.md'); fs.writeFileSync(future, `${START}\n{"schema":"compact-slices/v2"}\n${END}`);
        expect(validatePlanFile(future, root)).toMatchObject({ state: 'unsupported', schema: 'compact-slices/v2' });
    });

    test('keeps a future schema behind partial markers invalid rather than unsupported', () => {
        const plan = path.join(root, 'partial-future.md'); fs.writeFileSync(plan, `${START}\n{"schema":"compact-slices/v2"}`);
        expect(validatePlanFile(plan, root)).toMatchObject({ state: 'unsupported', schema: 'compact-slices/v2' });
    });

    test('applies scalar limits before classifying a future schema as unsupported', () => {
        const plan = path.join(root, 'future-too-large.md');
        fs.writeFileSync(plan, `${START}\n{"schema":"compact-slices/${'v'.repeat(4097)}"}\n${END}`);
        expect(validatePlanFile(plan, root)).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code: 'PLAN_LIMIT' })] });
    });

    test('rejects a duplicate JSON key with a stable diagnostic', () => {
        const plan = path.join(root, 'plan.md'); fs.writeFileSync(plan, `${START}\n{"schema":"compact-slices/v1","schema":"compact-slices/v1"}\n${END}`);
        expect(validatePlanFile(plan, root)).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code: 'PLAN_JSON' })] });
    });

    test('rejects JSON keys made equivalent by slash escaping', () => {
        expect(() => parseJsonNoDuplicate('{"a/b":1,"a\\/b":2}')).toThrow('duplicate key');
    });

    test.each([
        ['requirement', (m: Record<string, unknown>) => { m.requirements = [['R4-VAL-2']]; }, 'PLAN_SHAPE'],
        ['source', (m: Record<string, unknown>) => { (m.sources as Record<string, unknown>[])[0].id = ['SRC-ONE']; }, 'PLAN_SOURCE_SHAPE'],
        ['command', (m: Record<string, unknown>) => { (m.commands as Record<string, unknown>[])[0].id = ['CMD-ONE']; }, 'PLAN_COMMAND_SHAPE'],
        ['slice', (m: Record<string, unknown>) => { (m.slices as Record<string, unknown>[])[0].id = ['S1']; }, 'PLAN_SLICE_SHAPE'],
    ])('rejects a non-string %s ID before applying ID syntax validation', (_name, mutate, code) => {
        const report = validatePlanFile(fixture(root, mutate), root);
        expect(report).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code })] });
    });

    test('rejects slices with IDs that are semantically duplicate after coercion', () => {
        const plan = fixture(root, (m) => {
            m.requirements = ['R4-VAL-2', 'R4-VAL-3'];
            (m.commands as Record<string, unknown>[]).push({ id: 'CMD-TWO', program: 'npm', args: ['run', 'lint'], covers: ['R4-VAL-3'] });
            (m.slices as Record<string, unknown>[]).push({ id: ['S1'], title: 'Validate one thing', requirements: ['R4-VAL-3'], dependsOn: [], sectionAnchor: 'slice-s1', sources: ['SRC-ONE'], redCommands: ['CMD-TWO'], greenCommands: ['CMD-TWO'], reviewEvidence: ['specification', 'code-quality'], risk: 'bounded', fallback: ['Use a reviewed fallback'] });
            m.closureCommands = ['CMD-ONE', 'CMD-TWO'];
        });
        expect(validatePlanFile(plan, root)).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code: 'PLAN_SLICE_SHAPE' })] });
    });

    test.each([
        ['unknown field', (m: Record<string, unknown>) => { m.extra = true; }, 'PLAN_UNKNOWN_FIELD'],
        ['missing field', (m: Record<string, unknown>) => { delete m.planId; }, 'PLAN_MISSING_FIELD'],
        ['limit', (m: Record<string, unknown>) => { m.requirements = Array.from({ length: 257 }, (_, i) => `R${i}`); }, 'PLAN_LIMIT'],
        ['duplicate owner', (m: Record<string, unknown>) => { (m.slices as Record<string, unknown>[])[0].requirements = ['R4-VAL-2', 'R4-VAL-2']; }, 'PLAN_REQUIREMENT_OWNER'],
        ['orphan requirement', (m: Record<string, unknown>) => { m.requirements = ['R4-VAL-2', 'R4-VAL-5']; }, 'PLAN_REQUIREMENT_OWNER'],
        ['cycle', (m: Record<string, unknown>) => { (m.slices as Record<string, unknown>[])[0].dependsOn = ['S1']; }, 'PLAN_DEPENDENCY'],
        ['review roles', (m: Record<string, unknown>) => { (m.slices as Record<string, unknown>[])[0].reviewEvidence = ['specification', 'specification']; }, 'PLAN_REVIEW_EVIDENCE'],
        ['shell argv', (m: Record<string, unknown>) => { (m.commands as Record<string, unknown>[])[0].program = 'sh'; (m.commands as Record<string, unknown>[])[0].args = ['-c', 'echo x']; }, 'PLAN_COMMAND_UNSAFE'],
    ])('rejects %s with a stable diagnostic', (_name, mutate, code) => {
        const report = validatePlanFile(fixture(root, mutate), root);
        expect(report).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code })] });
    });

    test('rejects source symlinks and missing locators', () => {
        const linked = path.join(root, 'docs', 'linked.md'); fs.mkdirSync(path.dirname(linked), { recursive: true }); fs.symlinkSync(path.join(root, 'docs', 'source.md'), linked);
        const symlink = validatePlanFile(fixture(root, (m) => { (m.sources as Record<string, unknown>[])[0].path = 'docs/linked.md'; }), root);
        expect(symlink).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code: 'PLAN_SOURCE_UNSAFE' })] });
        const locator = validatePlanFile(fixture(root, (m) => { (m.sources as Record<string, unknown>[])[0].locator = 'absent'; }), root);
        expect(locator).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code: 'PLAN_SOURCE_LOCATOR' })] });
    });

    test('rejects an oversized source before reading its body', () => {
        const plan = fixture(root);
        const source = path.join(root, 'docs', 'source.md');
        fs.writeFileSync(source, Buffer.alloc(1024 * 1024 + 1, 0x61));
        const read = jest.spyOn(fs, 'readFileSync');
        try {
            expect(validatePlanFile(plan, root)).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code: 'PLAN_SOURCE_LIMIT' })] });
            expect(read.mock.calls.some(([file]) => file === source)).toBe(false);
        } finally { read.mockRestore(); }
    });

    test.each([
        ['invalid UTF-8 source', (root: string) => fs.writeFileSync(path.join(root, 'docs', 'source.md'), Buffer.from([0x80])) , 'PLAN_SOURCE_ENCODING'],
        ['multiline locator', (_root: string) => undefined, 'PLAN_SOURCE_SHAPE'],
    ])('rejects %s', (_name, prepare, code) => {
        const report = validatePlanFile(fixture(root, (m) => {
            prepare(root);
            if (code === 'PLAN_SOURCE_SHAPE') (m.sources as Record<string, unknown>[])[0].locator = 'Source\nKnown';
        }), root);
        expect(report).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code })] });
    });

    test.each(['', '.', '..', '/tmp/source.md', 'C:\\source.md', 'docs\\source.md', 'docs/../source.md'])('rejects adversarial source path %j', (sourcePath) => {
        const report = validatePlanFile(fixture(root, (m) => { (m.sources as Record<string, unknown>[])[0].path = sourcePath; }), root);
        expect(report).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code: 'PLAN_SOURCE_SHAPE' })] });
    });

    test.each(['redCommands', 'greenCommands'])('requires a nonempty %s list', (field) => {
        const report = validatePlanFile(fixture(root, (m) => { (m.slices as Record<string, unknown>[])[0][field] = []; }), root);
        expect(report).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code: 'PLAN_SLICE_SHAPE' })] });
    });

    test('rejects a slice requirement absent from the top-level requirements', () => {
        const report = validatePlanFile(fixture(root, (m) => {
            m.requirements = [];
            (m.slices as Record<string, unknown>[])[0].requirements = ['R4-VAL-9'];
            (m.commands as Record<string, unknown>[])[0].covers = [];
        }), root);
        expect(report).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code: 'PLAN_SLICE_SHAPE' })] });
    });

    test('requires a non-whitespace fallback condition', () => {
        const report = validatePlanFile(fixture(root, (m) => { (m.slices as Record<string, unknown>[])[0].fallback = ['   ']; }), root);
        expect(report).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code: 'PLAN_SLICE_SHAPE' })] });
    });

    test.each(['locator', 'fact'])('requires source %s to contain non-whitespace text', (field) => {
        const report = validatePlanFile(fixture(root, (m) => { (m.sources as Record<string, unknown>[])[0][field] = ' '; }), root);
        expect(report).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code: 'PLAN_SOURCE_SHAPE' })] });
    });

    test('bounds sectionAnchor as a scalar string', () => {
        const report = validatePlanFile(fixture(root, (m) => { (m.slices as Record<string, unknown>[])[0].sectionAnchor = 'a'.repeat(4097); }), root);
        expect(report).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code: 'PLAN_SLICE_SHAPE' })] });
    });

    test('requires migration for a document without any compact signal', () => {
        const plan = path.join(root, 'legacy.md'); fs.writeFileSync(plan, '# Legacy plan\n');
        expect(validatePlanFile(plan, root)).toEqual({ state: 'migration-required', reason: 'unmarked-plan' });
    });

    test('does not classify an escaped future schema signal as migration-required', () => {
        const plan = path.join(root, 'escaped-future.md'); fs.writeFileSync(plan, '{"schema":"compact-slices\\u002fv2"}');
        expect(validatePlanFile(plan, root)).toMatchObject({ state: 'unsupported', schema: 'compact-slices/v2' });
    });

    test.each([
        ['escaped schema key', '{"\\u0073chema":"compact-slices/v2"}'],
        ['escaped schema hyphen', '{"schema":"compact\\u002dslices/v2"}'],
    ])('does not classify a future schema with an %s as migration-required', (_name, manifest) => {
        const plan = path.join(root, 'escaped-future-schema.md'); fs.writeFileSync(plan, manifest);
        expect(validatePlanFile(plan, root)).toMatchObject({ state: 'unsupported', schema: 'compact-slices/v2' });
    });

    test('does not classify an escaped future schema embedded in Markdown without markers as migration-required', () => {
        const plan = path.join(root, 'embedded-escaped-future.md');
        fs.writeFileSync(plan, '# Plan notes\n\n```json\n{"\\u0073chema":"compact\\u002dslices\\u002fv2"}\n```\n');
        expect(validatePlanFile(plan, root)).toMatchObject({ state: 'unsupported', schema: 'compact-slices/v2' });
    });

    test('rejects an unparseable escaped compact schema embedded in Markdown rather than requiring migration', () => {
        const plan = path.join(root, 'embedded-escaped-malformed.md');
        fs.writeFileSync(plan, '# Plan notes\n\n{"\\u0073chema":"compact\\u002dslices\\u002fv2"\n');
        expect(validatePlanFile(plan, root)).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code: 'PLAN_MARKERS' })] });
    });

    test('rejects a markerless malformed compact schema with an escaped JSON slash', () => {
        const plan = path.join(root, 'escaped-slash-malformed.md');
        fs.writeFileSync(plan, '{"schema":"compact-slices\\/v2"');
        expect(validatePlanFile(plan, root)).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code: 'PLAN_MARKERS' })] });
    });

    test('rejects an escaped current schema without compact markers', () => {
        const plan = path.join(root, 'escaped-current-schema.md'); fs.writeFileSync(plan, '{"\\u0073chema":"compact\\u002dslices/v1"}');
        expect(validatePlanFile(plan, root)).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code: 'PLAN_MARKERS' })] });
    });

    test('rejects duplicate trace references and an oversized plan id', () => {
        const duplicate = validatePlanFile(fixture(root, (m) => { (m.slices as Record<string, unknown>[])[0].sources = ['SRC-ONE', 'SRC-ONE']; }), root);
        expect(duplicate).toMatchObject({ state: 'invalid' });
        const planId = validatePlanFile(fixture(root, (m) => { m.planId = 'a'.repeat(4097); }), root);
        expect(planId).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code: 'PLAN_LIMIT' })] });
    });

    test('requires the slice heading immediately after its anchor', () => {
        const plan = fixture(root);
        fs.writeFileSync(plan, fs.readFileSync(plan, 'utf8').replace('<a id="slice-s1"></a>\n', '<a id="slice-s1"></a>\nintervening text\n'));
        expect(validatePlanFile(plan, root)).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code: 'PLAN_MARKDOWN_HEADING' })] });
    });

    test('rejects a blank line between the slice anchor and heading', () => {
        const plan = fixture(root);
        fs.writeFileSync(plan, fs.readFileSync(plan, 'utf8').replace('<a id="slice-s1"></a>\n', '<a id="slice-s1"></a>\n\n'));
        expect(validatePlanFile(plan, root)).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code: 'PLAN_MARKDOWN_HEADING' })] });
    });

    test('rejects a slice heading with a suffix beyond the manifest title', () => {
        const plan = fixture(root);
        fs.writeFileSync(plan, fs.readFileSync(plan, 'utf8').replace('### Slice S1: Validate one thing\n', '### Slice S1: Validate one thing extra\n'));
        expect(validatePlanFile(plan, root)).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code: 'PLAN_MARKDOWN_HEADING' })] });
    });

    test('rejects a repeated required Markdown subsection', () => {
        const plan = fixture(root);
        fs.writeFileSync(plan, fs.readFileSync(plan, 'utf8').replace('#### Fallback', '#### Evidence\n\nDuplicate evidence.\n\n#### Fallback'));
        expect(validatePlanFile(plan, root)).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code: 'PLAN_MARKDOWN_SECTION' })] });
    });

    test('ignores apparent slice delimiters and subsections inside fenced code blocks', () => {
        const plan = fixture(root);
        fs.writeFileSync(plan, fs.readFileSync(plan, 'utf8').replace('#### Fallback', '```markdown\n### Slice S99: Example only\n#### Surfaces\n#### Implementation\n#### Edge cases\n#### Evidence\n#### Fallback\n```\n\n#### Fallback'));
        expect(validatePlanFile(plan, root)).toMatchObject({ state: 'valid' });
    });

    test('rejects an additional slice heading that is not immediately anchored', () => {
        const plan = fixture(root);
        fs.appendFileSync(plan, '\n### Slice S1: Validate one thing\n');
        expect(validatePlanFile(plan, root)).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code: 'PLAN_MARKDOWN_HEADING' })] });
    });

    test.each(['TODO', 'TBD', 'placeholder', 'draft'])('rejects incomplete Markdown sentinel %s', (sentinel) => {
        const plan = fixture(root);
        fs.writeFileSync(plan, fs.readFileSync(plan, 'utf8').replace('One evidence item.', sentinel));
        expect(validatePlanFile(plan, root)).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code: 'PLAN_MARKDOWN_SECTION' })] });
    });

    test('rejects a contained command file without an executable mode', () => {
        const report = validatePlanFile(fixture(root, (m) => {
            fs.writeFileSync(path.join(root, 'docs', 'program'), 'echo inert\n', { mode: 0o644 });
            (m.commands as Record<string, unknown>[])[0].program = 'docs/program';
        }), root);
        expect(report).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code: 'PLAN_COMMAND_UNSAFE' })] });
    });

    test.each([
        ['env wrapper', 'env', ['sh', '-c', 'echo safe']],
        ['node interpreter', 'node', ['-e', 'process.exit()']],
        ['busybox launcher', 'busybox', ['sh', '-c', 'echo safe']],
    ])('rejects nested shell launcher %s', (_name, program, args) => {
        const report = validatePlanFile(fixture(root, (m) => { (m.commands as Record<string, unknown>[])[0].program = program; (m.commands as Record<string, unknown>[])[0].args = args; }), root);
        expect(report).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code: 'PLAN_COMMAND_UNSAFE' })] });
    });

    test.each(['node-v22', 'nodejs-20', 'python3.12', 'bash-static', 'busybox-musl'])('rejects versioned launcher %s', (program) => {
        const report = validatePlanFile(fixture(root, (m) => { (m.commands as Record<string, unknown>[])[0].program = program; }), root);
        expect(report).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code: 'PLAN_COMMAND_UNSAFE' })] });
    });

    test.each(['cmd.exe', 'powershell.exe', 'pwsh.exe', 'wscript.exe', 'cscript.exe'])('rejects Windows launcher %s', (program) => {
        const report = validatePlanFile(fixture(root, (m) => { (m.commands as Record<string, unknown>[])[0].program = program; }), root);
        expect(report).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code: 'PLAN_COMMAND_UNSAFE' })] });
    });

    test.each(['bin/bash', 'tools/cmd.exe'])('rejects path-qualified interpreter launcher %s', (program) => {
        const report = validatePlanFile(fixture(root, (m) => { (m.commands as Record<string, unknown>[])[0].program = program; }), root);
        expect(report).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code: 'PLAN_COMMAND_UNSAFE' })] });
    });

    test.each(['FiSh.ExE', 'tools/EnV.eXe'])('rejects case-insensitive launcher %s even with a safe relative path', (program) => {
        const report = validatePlanFile(fixture(root, (m) => {
            if (program.includes('/')) {
                fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
                fs.writeFileSync(path.join(root, 'tools', 'EnV.eXe'), 'inert executable', { mode: 0o755 });
            }
            (m.commands as Record<string, unknown>[])[0].program = program;
        }), root);
        expect(report).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code: 'PLAN_COMMAND_UNSAFE' })] });
    });

    test.each(['py.exe', 'pythonw.exe', 'deno.exe', 'bun.exe', 'ruby3.3', 'perl5.38', 'ash', 'csh', 'tcsh'])('rejects interpreter family %s', (program) => {
        const report = validatePlanFile(fixture(root, (m) => { (m.commands as Record<string, unknown>[])[0].program = program; }), root);
        expect(report).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code: 'PLAN_COMMAND_UNSAFE' })] });
    });

    test('rejects a Windows path-like program as a bare executable', () => {
        const report = validatePlanFile(fixture(root, (m) => { (m.commands as Record<string, unknown>[])[0].program = 'C:\\tools\\safe.exe'; }), root);
        expect(report).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code: 'PLAN_COMMAND_UNSAFE' })] });
    });

    test('rejects a Windows drive-relative program', () => {
        const report = validatePlanFile(fixture(root, (m) => { (m.commands as Record<string, unknown>[])[0].program = 'C:cmd.exe'; }), root);
        expect(report).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code: 'PLAN_COMMAND_UNSAFE' })] });
    });

    test('applies Windows contained executable semantics and still denies symlinks', () => {
        const platform = Object.getOwnPropertyDescriptor(process, 'platform');
        Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' });
        try {
            const executable = validatePlanFile(fixture(root, (m) => {
                fs.writeFileSync(path.join(root, 'docs', 'safe.exe'), 'inert executable');
                (m.commands as Record<string, unknown>[])[0].program = 'docs/safe.exe';
            }), root);
            expect(executable).toMatchObject({ state: 'valid' });

            const symlink = validatePlanFile(fixture(root, (m) => {
                fs.writeFileSync(path.join(root, 'docs', 'safe.exe'), 'inert executable');
                fs.symlinkSync(path.join(root, 'docs', 'safe.exe'), path.join(root, 'docs', 'linked.exe'));
                (m.commands as Record<string, unknown>[])[0].program = 'docs/linked.exe';
            }), root);
            expect(symlink).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code: 'PLAN_COMMAND_UNSAFE' })] });
        } finally {
            if (platform) Object.defineProperty(process, 'platform', platform);
        }
    });

    test('rejects duplicate command coverage', () => {
        const report = validatePlanFile(fixture(root, (m) => { (m.commands as Record<string, unknown>[])[0].covers = ['R4-VAL-2', 'R4-VAL-2']; }), root);
        expect(report).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code: 'PLAN_COMMAND_SHAPE' })] });
    });

    test('rejects command coverage unrelated to every referencing slice', () => {
        const plan = fixture(root, (m) => {
            m.requirements = ['R4-VAL-2', 'R4-VAL-3'];
            (m.commands as Record<string, unknown>[]).push({ id: 'CMD-TWO', program: 'npm', args: ['run', 'lint'], covers: ['R4-VAL-2'] });
            (m.slices as Record<string, unknown>[]).push({ id: 'S2', title: 'Validate two things', requirements: ['R4-VAL-3'], dependsOn: [], sectionAnchor: 'slice-s2', sources: ['SRC-ONE'], redCommands: ['CMD-TWO'], greenCommands: ['CMD-TWO'], reviewEvidence: ['specification', 'code-quality'], risk: 'bounded', fallback: ['Use a reviewed fallback'] });
        });
        fs.appendFileSync(plan, '\n<a id="slice-s2"></a>\n### Slice S2: Validate two things\n\n#### Surfaces\n\nOne surface.\n\n#### Implementation\n\nOne implementation.\n\n#### Edge cases\n\nOne edge case.\n\n#### Evidence\n\nOne evidence item.\n\n#### Fallback\n\nOne fallback.\n');
        expect(validatePlanFile(plan, root)).toMatchObject({ state: 'invalid' });
    });

    test('rejects requirement coverage executed only by a different slice', () => {
        const plan = fixture(root, (m) => {
            m.requirements = ['R4-VAL-2', 'R4-VAL-3'];
            (m.commands as Record<string, unknown>[])[0].covers = ['R4-VAL-2'];
            (m.commands as Record<string, unknown>[]).push({ id: 'CMD-TWO', program: 'npm', args: ['run', 'lint'], covers: ['R4-VAL-2', 'R4-VAL-3'] });
            (m.commands as Record<string, unknown>[]).push({ id: 'CMD-THREE', program: 'npm', args: ['run', 'build'], covers: [] });
            ((m.slices as Record<string, unknown>[])[0].redCommands as string[]).push('CMD-TWO');
            ((m.slices as Record<string, unknown>[])[0].greenCommands as string[]).push('CMD-TWO');
            (m.slices as Record<string, unknown>[]).push({ id: 'S2', title: 'Validate two things', requirements: ['R4-VAL-3'], dependsOn: [], sectionAnchor: 'slice-s2', sources: ['SRC-ONE'], redCommands: ['CMD-THREE'], greenCommands: ['CMD-THREE'], reviewEvidence: ['specification', 'code-quality'], risk: 'bounded', fallback: ['Use a reviewed fallback'] });
            m.closureCommands = ['CMD-ONE', 'CMD-TWO', 'CMD-THREE'];
        });
        fs.appendFileSync(plan, '\n<a id="slice-s2"></a>\n### Slice S2: Validate two things\n\n#### Surfaces\n\nOne surface.\n\n#### Implementation\n\nOne implementation.\n\n#### Edge cases\n\nOne edge case.\n\n#### Evidence\n\nOne evidence item.\n\n#### Fallback\n\nOne fallback.\n');
        expect(validatePlanFile(plan, root)).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code: 'PLAN_REQUIREMENT_COVER' })] });
    });

    test('rejects a command with neither requirement coverage nor closure membership', () => {
        const report = validatePlanFile(fixture(root, (m) => {
            (m.commands as Record<string, unknown>[])[0].covers = [];
            m.closureCommands = [];
        }), root);
        expect(report).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code: 'PLAN_COMMAND_SHAPE' })] });
    });

    test.each(['requirements', 'sources', 'commands', 'slices', 'closureCommands'])('requires a nonempty v1 manifest %s collection', (field) => {
        const report = validatePlanFile(fixture(root, (m) => { m[field] = []; }), root);
        expect(report).toMatchObject({ state: 'invalid' });
    });

    test('recognizes a parseable future schema when only the END marker is broken', () => {
        const plan = path.join(root, 'future-missing-end.md');
        fs.writeFileSync(plan, `${START}\n{"schema":"compact-slices/v2"}\n`);
        expect(validatePlanFile(plan, root)).toMatchObject({ state: 'unsupported', schema: 'compact-slices/v2' });
    });

    test('accepts CRLF Markdown with nested headings and fenced code in a required section', () => {
        const plan = fixture(root);
        const markdown = fs.readFileSync(plan, 'utf8')
            .replace('One implementation.', 'Implementation prose.\n\n##### Nested detail\n\n```ts\n#### Not a real section\nconst value = true;\n```\n\nMore implementation prose.')
            .replace(/\n/g, '\r\n');
        fs.writeFileSync(plan, markdown);
        expect(validatePlanFile(plan, root)).toMatchObject({ state: 'valid', schema: 'compact-slices/v1' });
    });

    test('does not classify a malformed future schema behind one broken marker as unsupported', () => {
        const plan = path.join(root, 'partial-future-malformed.md');
        fs.writeFileSync(plan, `${START}\n{"schema":"compact-slices/v2"`);
        expect(validatePlanFile(plan, root)).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code: 'PLAN_MARKERS' })] });
    });
});
