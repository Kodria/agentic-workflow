import fs from 'fs';
import path from 'path';
import { AGENT_TARGETS } from '../../src/providers';

const ROOT = path.resolve(__dirname, '../../..');
const ACTIVE = [
    'README.md',
    'docs/README.md',
    'docs/framework.md',
    'docs/installation.md',
    'docs/configuration.md',
    'docs/project-setup.md',
    'docs/agents-setup.md',
    'docs/runbook.md',
    'docs/cli-reference.md',
    'docs/support-matrix.md',
    'docs/architecture.md',
    'docs/guides/product-process.md',
    'docs/guides/development-process.md',
    'docs/guides/parallel-tracks.md',
] as const;

const read = (file: string): string => fs.readFileSync(path.join(ROOT, file), 'utf8');

function slug(text: string): string {
    return text
        .trim()
        .toLowerCase()
        .replace(/[`*_~]/g, '')
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
}

function anchors(markdown: string): Set<string> {
    const seen = new Map<string, number>();
    const out = new Set<string>();
    for (const match of markdown.matchAll(/^#{1,6}\s+(.+)$/gm)) {
        const base = slug(match[1]);
        const count = seen.get(base) ?? 0;
        seen.set(base, count + 1);
        out.add(count === 0 ? base : `${base}-${count}`);
    }
    for (const match of markdown.matchAll(/<a\s+(?:name|id)="([^"]+)"/g)) out.add(match[1]);
    return out;
}

function localLinks(markdown: string): string[] {
    return Array.from(markdown.matchAll(/(?<!!)\[[^\]]+\]\(([^)]+)\)/g), (m) => m[1])
        .filter((target) => !/^(?:https?:|mailto:)/.test(target));
}

describe('active documentation contract', () => {
    it('has one reachable active editorial set (R1, R11, R14.4)', () => {
        const navigation = read('README.md') + read('docs/README.md');
        for (const file of ACTIVE) {
            expect(fs.existsSync(path.join(ROOT, file))).toBe(true);
            if (file !== 'README.md' && file !== 'docs/README.md') {
                expect(navigation).toContain(file.replace(/^docs\//, ''));
            }
        }
    });

    it('keeps every relative link and anchor valid (R14.1)', () => {
        for (const source of ACTIVE) {
            for (const raw of localLinks(read(source))) {
                const [filePart, fragment] = raw.split('#');
                const target = filePart
                    ? path.resolve(path.dirname(path.join(ROOT, source)), decodeURI(filePart))
                    : path.join(ROOT, source);
                expect(fs.existsSync(target)).toBe(true);
                if (fragment && target.endsWith('.md')) {
                    expect(anchors(fs.readFileSync(target, 'utf8'))).toContain(decodeURI(fragment));
                }
            }
        }
    });

    it('documents the two-stage boundary and official bundle scopes (R3, R8)', () => {
        expect(read('docs/installation.md')).toContain('Prepare the machine');
        expect(read('docs/project-setup.md')).toContain('Initialize a project');
        expect(read('docs/configuration.md')).toContain('`dev` and `product`');
        expect(read('docs/project-setup.md')).toContain('`frontend`');
    });

    it('documents every init provider and option (R5, R14.2)', () => {
        const config = read('docs/configuration.md');
        for (const agent of AGENT_TARGETS) {
            expect(config).toContain(`awm init --agent ${agent} --machine-only`);
        }
        for (const flag of ['--agent', '--machine-only', '--yes', '--json']) {
            expect(config).toContain(`\`${flag}\``);
        }
    });

    it('assigns canonical topics instead of copying provider paths (R12)', () => {
        expect(read('docs/configuration.md')).toContain('[Support matrix](support-matrix.md)');
        expect(read('docs/configuration.md')).not.toMatch(/~\/\.(?:claude|codex|cursor|gemini)/);
    });
});
