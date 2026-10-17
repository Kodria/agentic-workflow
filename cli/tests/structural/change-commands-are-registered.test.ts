// The Change Record commands are reachable from the real program: `awm change new|validate` and `awm changes list`. Every command
// module is tested by registering it on a fresh Commander program, which would stay green if src/index.ts forgot the register call.
import { program } from '../../src/index';

const find = (parent: { commands: readonly { name(): string }[] }, name: string) => parent.commands.find((c) => c.name() === name) as import('commander').Command | undefined;
const flags = (command: import('commander').Command | undefined): string[] => (command?.options ?? []).map((o) => o.long ?? o.flags).sort();

describe('the real awm program registers the Change Record commands', () => {
    test('`awm change` has `new <slug>` and `validate [path]` with their options', () => {
        const change = find(program, 'change');
        expect(change).toBeDefined();
        const created = find(change as never, 'new');
        const validated = find(change as never, 'validate');
        expect(created?.usage()).toContain('<slug>');
        expect(flags(created)).toEqual(['--base', '--issue', '--model', '--plan', '--refresh', '--session']);
        expect(validated?.usage()).toContain('[path]');
        expect(flags(validated)).toEqual(['--base', '--json', '--strict']);
    });
    test('`awm changes` has `list` with --since, --base and --format', () => {
        const changes = find(program, 'changes');
        expect(changes).toBeDefined();
        expect(flags(find(changes as never, 'list'))).toEqual(['--base', '--format', '--since']);
    });
    test('both are in the top-level help', () => {
        const help = program.helpInformation();
        expect(help).toMatch(/^\s+change\b/m);
        expect(help).toMatch(/^\s+changes\b/m);
    });
});
