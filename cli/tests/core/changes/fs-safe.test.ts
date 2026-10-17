import fs from 'fs';
import path from 'path';
import { makeRepo, posixOnly, type TestRepo } from './helpers';
import { isRegularFileInside } from '../../../src/core/changes/fs-safe';

// HOME and AWM_HOME point at a throwaway home for the whole file (makeRepo); every scratch directory lives inside it.
let repo: TestRepo;
let n = 0;
beforeAll(() => { repo = makeRepo(); });
afterAll(() => repo.cleanup());
afterEach(() => jest.restoreAllMocks());
const scratch = (): string => fs.mkdtempSync(path.join(repo.home, `fss${n++}-`));

describe('isRegularFileInside', () => {
    test('accepts a regular file inside', () => {
        const root = scratch();
        fs.mkdirSync(path.join(root, 'docs'));
        fs.writeFileSync(path.join(root, 'docs', 'p.md'), 'x');
        expect(isRegularFileInside(root, 'docs/p.md')).toBe(true);
    });
    test.each([['missing', 'nope.md'], ['a directory', 'docs'], ['a parent segment', '../x'], ['an absolute path', '/etc/passwd'], ['a backslash', 'docs\\p.md'], ['empty', '']])('rejects %s', (_n, rel) => {
        const root = scratch();
        fs.mkdirSync(path.join(root, 'docs'));
        expect(isRegularFileInside(root, rel)).toBe(false);
    });
    posixOnly('rejects a symlink to a file', () => {
        const root = scratch();
        fs.writeFileSync(path.join(root, 'real.md'), 'x');
        fs.symlinkSync(path.join(root, 'real.md'), path.join(root, 'link.md'));
        expect(isRegularFileInside(root, 'link.md')).toBe(false);
    });
    posixOnly('rejects a file reached through a symlinked directory that leaves the root', () => {
        const root = scratch(); const outside = scratch();
        fs.writeFileSync(path.join(outside, 'p.md'), 'x');
        fs.symlinkSync(outside, path.join(root, 'plans'));
        expect(isRegularFileInside(root, 'plans/p.md')).toBe(false);
    });
    posixOnly('accepts a file reached through a symlinked directory that stays inside the root', () => {
        const root = scratch();
        fs.mkdirSync(path.join(root, 'real'));
        fs.writeFileSync(path.join(root, 'real', 'p.md'), 'x');
        fs.symlinkSync(path.join(root, 'real'), path.join(root, 'alias'));
        expect(isRegularFileInside(root, 'alias/p.md')).toBe(true);
    });
    test.each([[undefined], [null], [5]])('rejects the non-string %p without throwing', (rel) => {
        expect(isRegularFileInside(scratch(), rel as never)).toBe(false);
    });
    test('accepts a path spelled exactly as it is on disk', () => {
        const root = scratch();
        fs.mkdirSync(path.join(root, 'docs'));
        fs.writeFileSync(path.join(root, 'docs', 'Plan.md'), 'x');
        expect(isRegularFileInside(root, 'docs/Plan.md')).toBe(true);
    });
    test('rejects a spelling that differs only in case from the file on disk (what a case-sensitive checkout would not find)', () => {
        const root = scratch();
        fs.mkdirSync(path.join(root, 'docs'));
        fs.writeFileSync(path.join(root, 'docs', 'plan.md'), 'x');
        // Behave like a case-insensitive file system: the wrong spelling resolves to the real file.
        const fold = (p: unknown) => String(p).replace('PLAN.md', 'plan.md').replace('/DOCS/', '/docs/');
        const lstat = fs.lstatSync; const realpath = fs.realpathSync.native;
        jest.spyOn(fs, 'lstatSync').mockImplementation(((p: fs.PathLike, ...rest: unknown[]) => (lstat as (...a: unknown[]) => unknown)(fold(p), ...rest)) as never);
        jest.spyOn(fs.realpathSync, 'native').mockImplementation(((p: fs.PathLike) => realpath(fold(p))) as never);
        expect(isRegularFileInside(root, 'docs/PLAN.md')).toBe(false);
        expect(isRegularFileInside(root, 'docs/plan.md')).toBe(true);
    });
    test('rejects a directory spelled with another case', () => {
        const root = scratch();
        fs.mkdirSync(path.join(root, 'docs'));
        fs.writeFileSync(path.join(root, 'docs', 'plan.md'), 'x');
        const lstat = fs.lstatSync; const realpath = fs.realpathSync.native;
        const fold = (p: unknown) => String(p).replace(`${path.sep}DOCS${path.sep}`, `${path.sep}docs${path.sep}`);
        jest.spyOn(fs, 'lstatSync').mockImplementation(((p: fs.PathLike, ...rest: unknown[]) => (lstat as (...a: unknown[]) => unknown)(fold(p), ...rest)) as never);
        jest.spyOn(fs.realpathSync, 'native').mockImplementation(((p: fs.PathLike) => realpath(fold(p))) as never);
        expect(isRegularFileInside(root, 'DOCS/plan.md')).toBe(false);
    });
});
