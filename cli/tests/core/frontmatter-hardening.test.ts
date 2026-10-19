// FH-1 / FH-2 / FH-3: linear plain-scalar comment strip, YAML-aligned
// space/tab-before-# vs NBSP, and exact `---` closer for matchFrontmatterBlock.
import yaml from 'js-yaml';
import { findFrontmatterDescription, matchFrontmatterBlock } from '../../src/core/frontmatter';
import { expectLinearScaling } from './changes/helpers';

describe('frontmatter hardening (FH-1, FH-2, FH-3)', () => {
    describe('FH-3: matchFrontmatterBlock closes only on exact ---', () => {
        it('keeps keys after a ---x line inside the block', () => {
            const raw = '---\nname: a\n---x: 1\nstatus: b\n---\n\nbody\n';
            const block = matchFrontmatterBlock(raw);
            expect(block).not.toBeNull();
            expect(block!).toContain('---x: 1');
            expect(block!).toContain('status: b');
        });

        it('closes on --- with trailing spaces', () => {
            const block = matchFrontmatterBlock('---\nname: a\n--- \n\nbody\n');
            expect(block).toBe('name: a');
        });

        it('closes on --- with trailing tabs and CRLF', () => {
            const block = matchFrontmatterBlock('---\r\nname: a\r\n---\t\t\r\n\r\nbody\r\n');
            expect(block).toBe('name: a');
        });

        it('does not close on ---#comment', () => {
            const raw = '---\nname: a\n---#comment\nstatus: b\n---\n\nbody\n';
            const block = matchFrontmatterBlock(raw);
            expect(block).not.toBeNull();
            expect(block!).toContain('---#comment');
            expect(block!).toContain('status: b');
        });

        it('yields empty string for empty frontmatter', () => {
            expect(matchFrontmatterBlock('---\n---\n')).toBe('');
        });
    });

    describe('FH-2: comment strip is space/tab only (not NBSP)', () => {
        it('drops trailing comment after space before #', () => {
            expect(findFrontmatterDescription('description: hello # drop').value).toBe('hello');
        });

        it('keeps NBSP before # (matches js-yaml)', () => {
            const fm = 'description: hello\u00A0# keep';
            const ours = findFrontmatterDescription(fm).value;
            const doc = yaml.load(fm) as { description: string };
            expect(ours).toBe(doc.description);
            expect(ours).toContain('\u00A0');
            expect(ours).toContain('# keep');
        });

        it('keeps # with no whitespace before it (C#)', () => {
            expect(findFrontmatterDescription('description: usar C# y F#').value).toBe('usar C# y F#');
        });
    });

    describe('FH-1: plain description comment strip is linear-time', () => {
        it('scales linearly with long runs of spaces and no #', () => {
            expectLinearScaling((n) => {
                findFrontmatterDescription('description: a' + ' '.repeat(n) + 'x');
            }, 20_000);
        });

        it('scales linearly with long runs of tabs and no #', () => {
            expectLinearScaling((n) => {
                findFrontmatterDescription('description: a' + '\t'.repeat(n) + 'x');
            }, 20_000);
        });
    });
});
