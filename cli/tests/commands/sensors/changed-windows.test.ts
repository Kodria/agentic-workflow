import { applyChangedCmd } from '../../../src/commands/sensors/changed';

describe('applyChangedCmd — Windows quoting', () => {
    const originalPlatform = process.platform;

    beforeEach(() => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
    });

    afterEach(() => {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('double-quotes paths on win32 instead of POSIX single-quoting', () => {
        // `runCommand` spawns this string with `shell: true`, which is cmd.exe on
        // win32. cmd.exe does not treat single quotes as quoting syntax — it would
        // split `'my dir/a.ts'` into two garbage arguments on the space. Double
        // quotes are the form cmd.exe actually honors.
        expect(applyChangedCmd('eslint {files}', ['my dir/a.ts']))
            .toBe(`eslint "my dir/a.ts"`);
    });

    it('escapes an embedded double quote by doubling it', () => {
        expect(applyChangedCmd('eslint {files}', ['weird"name.ts']))
            .toBe(`eslint "weird""name.ts"`);
    });
});
