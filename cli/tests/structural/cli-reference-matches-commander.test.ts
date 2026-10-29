import fs from 'fs';
import path from 'path';
import type { Command } from 'commander';
import { program } from '../../src/index';

/**
 * The CLI reference is what agents read to drive `awm`, so it must never name a
 * command or a flag the CLI does not have. This is the one documentation check:
 * it compares the docs against the Commander tree instead of pinning prose, so
 * rewording a paragraph never breaks it, and a renamed or removed flag always does.
 */
const ROOT = path.resolve(__dirname, '../../..');
const DOCS = ['docs/cli-reference.md', 'README.md'] as const;

interface Node { command: Command; children: Map<string, Node>; }

function tree(command: Command): Node {
    const children = new Map<string, Node>();
    for (const sub of command.commands) {
        const node = tree(sub);
        children.set(sub.name(), node);
        for (const alias of sub.aliases()) children.set(alias, node);
    }
    return { command, children };
}

/** Every `awm ...` invocation inside inline code spans or fenced code blocks. */
function invocations(markdown: string): string[] {
    const code: string[] = [];
    for (const fence of markdown.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) code.push(...fence[1].split('\n'));
    const prose = markdown.replace(/```[^\n]*\n[\s\S]*?```/g, '');
    for (const span of prose.matchAll(/`([^`\n]+)`/g)) code.push(span[1]);
    const out: string[] = [];
    for (const line of code) {
        for (const match of line.matchAll(/(?:^|[\s(;&|$])awm\s+([^|;&`#\n]*)/g)) out.push(match[1].trim());
    }
    return out;
}

function longFlags(command: Command): Set<string> {
    const flags = new Set<string>(['--help']);
    for (let c: Command | null = command; c; c = c.parent) {
        for (const option of c.options) if (option.long) flags.add(option.long);
    }
    return flags;
}

interface Drift { doc: string; invocation: string; problem: string; }

function check(root: Node, doc: string, invocation: string): Drift[] {
    const tokens = invocation.split(/\s+/).filter(Boolean);
    const first = tokens[0];
    // `awm <command>`, `awm …`, `awm --version` and similar placeholders name no command.
    if (!first || /^[<[A-Z-]/.test(first) || first === '...' || first === '…') return [];
    if (!root.children.has(first)) return [{ doc, invocation, problem: `unknown command "${first}"` }];
    // Options may precede a subcommand (`awm watch --provider x recover-admission`),
    // so descend on every non-flag token that names a child of the current command.
    let node = root;
    const names: string[] = [];
    for (const token of tokens) {
        if (token.startsWith('-')) continue;
        const next = node.children.get(token);
        if (next) { node = next; names.push(token); }
    }
    const known = longFlags(node.command);
    return tokens
        .flatMap((token) => Array.from(token.matchAll(/(?:^|[[(|])(--[a-z][a-z0-9-]*)/g), (m) => m[1]))
        .filter((flag) => !known.has(flag))
        .map((flag) => ({ doc, invocation, problem: `"awm ${names.join(' ')}" has no ${flag}` }));
}

describe('documented awm commands and flags exist in the CLI', () => {
    const root = tree(program);

    it.each(DOCS)('%s names only real commands and flags', (doc) => {
        const markdown = fs.readFileSync(path.join(ROOT, doc), 'utf8');
        const found = invocations(markdown);
        expect(found.length).toBeGreaterThan(0);
        const drift = found.flatMap((invocation) => check(root, doc, invocation));
        expect(drift).toEqual([]);
    });

    it('detects drift (self-check against a planted invocation)', () => {
        expect(check(root, 'planted', 'sensors run --no-such-flag')).toEqual([
            { doc: 'planted', invocation: 'sensors run --no-such-flag', problem: '"awm sensors run" has no --no-such-flag' },
        ]);
        expect(check(root, 'planted', 'no-such-command --x')).toHaveLength(1);
        expect(check(root, 'planted', 'sensors run --slice --no-cache')).toEqual([]);
    });
});
