import fs from 'fs';
import path from 'path';
import { discoverSkills } from '../../src/core/discovery';

jest.mock('fs');

const root = path.resolve('registry');
const skillDir = path.join(root, 'skills', 'safe');
const skillFile = path.join(skillDir, 'SKILL.md');
const content = '---\ndescription: >-\n  Ordinary skill\n---\n';
const descriptor = 42;
const inspected = {
    dev: 7n, ino: 9007199254740993n, size: BigInt(Buffer.byteLength(content)),
    isFile: () => true, isSymbolicLink: () => false, isDirectory: () => false,
};
const directory = { dev: 7n, ino: 8n, isFile: () => false, isSymbolicLink: () => false, isDirectory: () => true };

describe.each([true, false])('skill descriptor safety (O_NOFOLLOW available: %s)', (noFollowAvailable) => {
    beforeEach(() => {
        jest.resetAllMocks();
        const actual = jest.requireActual<typeof fs>('fs');
        jest.replaceProperty(fs, 'constants', {
            ...actual.constants,
            O_NOFOLLOW: noFollowAvailable ? 0x20000 : undefined,
            O_NONBLOCK: 0x800,
        } as typeof fs.constants);
        (fs.existsSync as jest.Mock).mockReturnValue(true);
        (fs.readdirSync as jest.Mock).mockReturnValue([{ name: 'safe', isDirectory: () => true }]);
        (fs.lstatSync as jest.Mock).mockImplementation((file) => {
            if (file === skillFile) return inspected;
            if (file.endsWith('awm-registry.json')) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
            return directory;
        });
        (fs.openSync as jest.Mock).mockReturnValue(descriptor);
        (fs.fstatSync as jest.Mock).mockReturnValue(inspected);
        (fs.readFileSync as jest.Mock).mockReturnValue(content);
    });

    afterEach(() => jest.restoreAllMocks());

    it('reads an ordinary skill from the validated descriptor and closes it', () => {
        expect(discoverSkills([root])).toEqual([{ name: 'safe', path: skillDir, description: 'Ordinary skill' }]);
        expect(fs.readFileSync).toHaveBeenCalledWith(descriptor, 'utf-8');
        expect(fs.closeSync).toHaveBeenCalledWith(descriptor);
        const flags = (fs.openSync as jest.Mock).mock.calls[0][1];
        expect(typeof flags).toBe('number');
        if (noFollowAvailable) expect(flags & fs.constants.O_NOFOLLOW).toBe(fs.constants.O_NOFOLLOW);
        expect(flags & fs.constants.O_NONBLOCK).toBe(fs.constants.O_NONBLOCK);
    });

    it.each([
        ['another inode', { ino: inspected.ino + 1n }],
        ['another device', { dev: inspected.dev + 1n }],
        ['changed size', { size: inspected.size + 1n }],
        ['FIFO replacement', { isFile: (): boolean => false }],
        ['symlink replacement', { isFile: (): boolean => false, isSymbolicLink: (): boolean => true }],
        ['unobservable device', { dev: undefined }],
        ['unobservable inode', { ino: undefined }],
    ])('rejects %s after inspection, without reading replacement bytes', (_label, change) => {
        (fs.fstatSync as jest.Mock).mockReturnValue({ ...inspected, ...change });

        expect(() => discoverSkills([root])).toThrow(/SKILL\.md.*(identity|regular|size|symbolic)/i);
        expect(fs.readFileSync).not.toHaveBeenCalled();
        expect(fs.closeSync).toHaveBeenCalledWith(descriptor);
    });

    it('opens nonblocking so a FIFO replacement cannot hang before fstat rejects it', () => {
        // No FIFO is created: the open mock enforces the flag needed to avoid blocking.
        (fs.openSync as jest.Mock).mockImplementation((_file, flags) => {
            if (!(flags & fs.constants.O_NONBLOCK)) throw new Error('would block opening FIFO');
            return descriptor;
        });
        (fs.fstatSync as jest.Mock).mockReturnValue({ ...inspected, isFile: () => false });

        expect(() => discoverSkills([root])).toThrow(/regular file/i);
        expect(fs.readFileSync).not.toHaveBeenCalled();
        expect(fs.closeSync).toHaveBeenCalledWith(descriptor);
    });

    it.each(['openSync', 'fstatSync', 'readFileSync'] as const)('fails closed on %s errors', (operation) => {
        (fs[operation] as jest.Mock).mockImplementation(() => { throw new Error('replaced or unreadable'); });

        expect(() => discoverSkills([root])).toThrow(/SKILL\.md.*replaced or unreadable/);
        if (operation === 'openSync') expect(fs.closeSync).not.toHaveBeenCalled();
        else expect(fs.closeSync).toHaveBeenCalledWith(descriptor);
        if (operation !== 'readFileSync') expect(fs.readFileSync).not.toHaveBeenCalled();
    });

    it.each([root, path.join(root, 'skills'), skillDir])('rejects an observable directory symlink at %s', (linked) => {
        const lstat = (fs.lstatSync as jest.Mock).getMockImplementation()!;
        (fs.lstatSync as jest.Mock).mockImplementation((file, options) => file === linked
            ? { ...directory, isDirectory: () => false, isSymbolicLink: () => true }
            : lstat(file, options));

        expect(() => discoverSkills([root])).toThrow(/symbolic link/i);
        expect(fs.openSync).not.toHaveBeenCalled();
        expect(fs.readFileSync).not.toHaveBeenCalled();
    });

    it.each(['dev', 'ino', 'size'])('fails closed when inspected %s is unobservable', (field) => {
        const unknown = { ...inspected, [field]: undefined };
        const lstat = (fs.lstatSync as jest.Mock).getMockImplementation()!;
        (fs.lstatSync as jest.Mock).mockImplementation((file, options) => file === skillFile ? unknown : lstat(file, options));
        (fs.fstatSync as jest.Mock).mockReturnValue(unknown);

        expect(() => discoverSkills([root])).toThrow(/identity|size/i);
        expect(fs.readFileSync).not.toHaveBeenCalled();
    });

    it.each(['dev', 'ino'])('fails closed when parent %s is unobservable', (field) => {
        const lstat = (fs.lstatSync as jest.Mock).getMockImplementation()!;
        (fs.lstatSync as jest.Mock).mockImplementation((file, options) => file === skillDir
            ? { ...directory, [field]: undefined }
            : lstat(file, options));

        expect(() => discoverSkills([root])).toThrow(/directory identity/i);
        expect(fs.openSync).not.toHaveBeenCalled();
        expect(fs.readFileSync).not.toHaveBeenCalled();
    });
});
