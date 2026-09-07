import fs from 'fs';
import path from 'path';

const source = (relative: string) => fs.readFileSync(path.resolve(__dirname, '../../src', relative), 'utf8');

describe('S2 bundle compatibility diagnostic command wiring', () => {
    it.each([
        ['add', 'index.ts', "program.command('add [name]')", 'discoverAllBundles(undefined, reporter)'],
        ['list', 'index.ts', "program.command('list [package]')", 'discoverAllBundles(undefined, reporter)'],
        ['remove', 'index.ts', "program.command('remove [name]')", 'discoverAllBundles(undefined, reporter)'],
        ['init', 'commands/init.ts', 'export async function runInit', 'discoverAllBundles(undefined, reporter)'],
        ['sync', 'commands/sync.ts', 'export async function runSyncCore', 'discoverAllBundles(undefined, reporter)'],
        ['update', 'commands/update.ts', 'export async function runUpdateCore', 'roots: contentRoots(), reporter'],
        ['doctor', 'commands/doctor.ts', 'export function runDoctor', 'gatherContext({ cwd: opts.cwd, agents: targets, reporter })'],
        ['registry add', 'commands/registry/index.ts', "reg.command('add <remote>')", 'addRegistry(remote, options.name, reporter)'],
        ['registry status', 'commands/registry/index.ts', "reg.command('list')", 'overrideStatus(r.contentRoot, earlier, reporter)'],
    ])('%s creates a command-scoped reporter and forwards it to discovery', (_command, file, start, forwarding) => {
        const text = source(file);
        const section = text.slice(text.indexOf(start));
        expect(section).toContain('createBundleDiagnosticReporter');
        expect(section).toContain(forwarding);
    });

    it('export has an isolated behavioral legacy/canonical warning assertion', () => {
        const text = fs.readFileSync(path.resolve(__dirname, 'export.test.ts'), 'utf8');
        expect(text).toContain('reports one legacy warning and no canonical warning through the command reporter seam');
        expect(text).toContain('expect(legacyWarnings).toHaveLength(1)');
        expect(text).toContain('expect(canonicalWarnings).toEqual([])');
    });
});
