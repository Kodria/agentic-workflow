import fs from 'fs';
import os from 'os';
import path from 'path';

type Index = {
    schema: number;
    kernelFiles: string[];
    maxFixedBytes: number;
    entries: Array<{ id: string; tier: string; path: string; anchor: string; when: string }>;
};

describe('Context Kernel v1 inspection', () => {
    let root: string;
    let previousAwmHome: string | undefined;

    beforeEach(() => {
        jest.resetModules();
        previousAwmHome = process.env.AWM_HOME;
        root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'awm-context-kernel-')));
        process.env.AWM_HOME = path.join(root, 'awm-home');
        fs.mkdirSync(process.env.AWM_HOME, { recursive: true });
    });

    afterEach(() => {
        if (previousAwmHome === undefined) delete process.env.AWM_HOME;
        else process.env.AWM_HOME = previousAwmHome;
        fs.rmSync(root, { recursive: true, force: true });
    });

    function inspect() {
        return require('../../../src/core/context-kernel/inspect').inspectContextKernel as (cwd: string) => unknown;
    }

    function indexPath(): string {
        return path.join(root, '.awm', 'context', 'index.json');
    }

    function writeIndex(index: Index): void {
        fs.mkdirSync(path.dirname(indexPath()), { recursive: true });
        fs.writeFileSync(indexPath(), JSON.stringify(index, null, 2));
    }

    function writeValidKernel(): Index {
        const index: Index = {
            schema: 1,
            kernelFiles: ['AGENTS.md', 'CONSTITUTION.md'],
            maxFixedBytes: 33_740,
            entries: [
                { id: 'CTX-PROCESS-001', tier: 'kernel', path: 'CONSTITUTION.md', anchor: 'awm-context:CTX-PROCESS-001', when: 'always' },
                { id: 'CTX-RELEASE-001', tier: 'selective', path: 'docs/awm/context/releases.md', anchor: 'awm-context:CTX-RELEASE-001', when: 'release automation' },
            ],
        };
        fs.writeFileSync(path.join(root, 'AGENTS.md'), '<!-- AWM:CONTEXT-KERNEL:START v1 -->\nagent rules\n<!-- AWM:CONTEXT-KERNEL:END v1 -->\n');
        fs.writeFileSync(path.join(root, 'CONSTITUTION.md'), '<!-- AWM:CONTEXT-KERNEL:START v1 -->\n<!-- awm-context:CTX-PROCESS-001 -->\nprocess rules\n<!-- AWM:CONTEXT-KERNEL:END v1 -->\n');
        const card = path.join(root, 'docs', 'awm', 'context', 'releases.md');
        fs.mkdirSync(path.dirname(card), { recursive: true });
        fs.writeFileSync(card, '<!-- awm-context:CTX-RELEASE-001 -->\nrelease rules\n');
        writeIndex(index);
        return index;
    }

    function mutateFixture(mutation: string): void {
        const constitution = path.join(root, 'CONSTITUTION.md');
        if (mutation === 'start marker missing') {
            fs.writeFileSync(constitution, fs.readFileSync(constitution, 'utf8').replace('<!-- AWM:CONTEXT-KERNEL:START v1 -->\n', ''));
        } else if (mutation === 'end marker duplicated') {
            fs.appendFileSync(constitution, '<!-- AWM:CONTEXT-KERNEL:END v1 -->\n');
        } else if (mutation === 'anchor outside region') {
            fs.writeFileSync(constitution, '<!-- awm-context:CTX-PROCESS-001 -->\n' + fs.readFileSync(constitution, 'utf8'));
        } else {
            fs.writeFileSync(constitution, fs.readFileSync(constitution, 'utf8').replace('process rules', '<!-- awm-context:CTX-PROCESS-001 -->\nprocess rules'));
        }
    }

    it('classifies no R3 artifacts as legacy', () => {
        expect(inspect()(root)).toEqual({ state: 'legacy' });
    });

    it('rejects a root context marker when the Context Kernel index is missing', () => {
        fs.writeFileSync(path.join(root, 'AGENTS.md'), '<!-- AWM:CONTEXT-KERNEL:START v1 -->\nagent rules\n');

        expect(inspect()(root)).toEqual(expect.objectContaining({
            state: 'invalid',
            detail: expect.stringContaining('.awm/context/index.json is missing'),
        }));
    });

    it('accepts the canonical fixture', () => {
        writeValidKernel();
        expect(inspect()(root)).toEqual(expect.objectContaining({ state: 'valid', schema: 1 }));
    });

    it.each([
        ['unknown top-level field', (x: Index & { extra?: boolean }) => { x.extra = true; }],
        ['future schema', (x: Index) => { x.schema = 2; }],
        ['duplicate id', (x: Index) => { x.entries[1].id = x.entries[0].id; }],
        ['duplicate anchor', (x: Index) => { x.entries[1].anchor = x.entries[0].anchor; }],
        ['absolute path', (x: Index) => { x.entries[1].path = '/tmp/outside.md'; }],
        ['traversal', (x: Index) => { x.entries[1].path = '../outside.md'; }],
        ['empty when', (x: Index) => { x.entries[1].when = ''; }],
        ['fixed byte cap', (x: Index) => { x.maxFixedBytes = 1; }],
    ])('rejects %s', (_name, mutate: (index: Index) => void) => {
        const index = writeValidKernel();
        mutate(index);
        writeIndex(index);
        expect(inspect()(root)).toEqual(expect.objectContaining({ state: 'invalid' }));
    });

    it('rejects a project path that resolves through a symlink to an external regular file', () => {
        const index = writeValidKernel();
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-outside-'));
        try {
            const card = path.join(root, index.entries[1].path);
            const externalCard = path.join(outside, 'card.md');
            fs.writeFileSync(externalCard, '<!-- awm-context:CTX-RELEASE-001 -->\nexternal release rules\n');
            fs.rmSync(card);
            fs.symlinkSync(externalCard, card);

            expect(fs.statSync(card).isFile()).toBe(true);
            expect(fs.realpathSync(card)).toBe(externalCard);
            expect(inspect()(root)).toEqual(expect.objectContaining({
                state: 'invalid',
                detail: expect.stringContaining('resolves outside the project root'),
            }));
        } finally {
            fs.rmSync(outside, { recursive: true, force: true });
        }
    });

    it('rejects a dangling index symlink instead of treating it as legacy', () => {
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-outside-'));
        try {
            fs.mkdirSync(path.dirname(indexPath()), { recursive: true });
            fs.symlinkSync(path.join(outside, 'index.json'), indexPath());
            expect(inspect()(root)).toEqual(expect.objectContaining({ state: 'invalid' }));
        } finally {
            fs.rmSync(outside, { recursive: true, force: true });
        }
    });

    it.each(['start marker missing', 'end marker duplicated', 'anchor outside region', 'anchor duplicated'])
    ('rejects %s', (mutation) => {
        writeValidKernel();
        mutateFixture(mutation);
        expect(inspect()(root)).toEqual(expect.objectContaining({ state: 'invalid' }));
    });

    it('throws for an invalid public cwd', () => {
        expect(() => inspect()(path.join(root, 'missing'))).toThrow(/cwd.*directory/);
    });
});
