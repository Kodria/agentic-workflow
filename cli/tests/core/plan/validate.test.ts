import fs from 'fs';
import { exec, execFileSync, execSync, spawn, spawnSync } from 'child_process';
import os from 'os';
import path from 'path';
import { parseJsonNoDuplicate } from '../../../src/core/plan/json';
import { validatePlanFile } from '../../../src/core/plan/validate';

jest.mock('child_process', () => ({ exec: jest.fn(), execFileSync: jest.fn(), execSync: jest.fn(), spawn: jest.fn(), spawnSync: jest.fn() }));

const START = '<!-- AWM:COMPACT-SLICES:START v1 -->';
const END = '<!-- AWM:COMPACT-SLICES:END v1 -->';

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
        expect(validatePlanFile(plan, root)).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code: 'PLAN_MARKERS' })] });
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

    test('treats a document without any optimized signal as legacy', () => {
        const plan = path.join(root, 'legacy.md'); fs.writeFileSync(plan, '# Legacy plan\n');
        expect(validatePlanFile(plan, root)).toEqual({ state: 'legacy' });
    });

    test('requires the slice heading immediately after its anchor', () => {
        const plan = fixture(root);
        fs.writeFileSync(plan, fs.readFileSync(plan, 'utf8').replace('<a id="slice-s1"></a>\n', '<a id="slice-s1"></a>\nintervening text\n'));
        expect(validatePlanFile(plan, root)).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code: 'PLAN_MARKDOWN_HEADING' })] });
    });

    test('rejects a slice heading with a suffix beyond the manifest title', () => {
        const plan = fixture(root);
        fs.writeFileSync(plan, fs.readFileSync(plan, 'utf8').replace('### Slice S1: Validate one thing\n', '### Slice S1: Validate one thing extra\n'));
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

    test('rejects a command with neither requirement coverage nor closure membership', () => {
        const report = validatePlanFile(fixture(root, (m) => {
            (m.commands as Record<string, unknown>[])[0].covers = [];
            m.closureCommands = [];
        }), root);
        expect(report).toMatchObject({ state: 'invalid', diagnostics: [expect.objectContaining({ code: 'PLAN_COMMAND_SHAPE' })] });
    });
});
