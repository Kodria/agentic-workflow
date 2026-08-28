import fs from 'fs';
import os from 'os';
import path from 'path';

import {
    readInspectedBoundedFileWithIdentity,
    writeProjectFile,
} from '../../../../src/commands/sensors/compatibility/safe-file';

type ProjectLeaseRunner = <T>(projectRoot: string, operation: () => T) => T;

function projectLeaseRunner(): ProjectLeaseRunner {
    return (require('../../../../src/commands/sensors/compatibility/safe-file') as { withProjectLease: ProjectLeaseRunner }).withProjectLease;
}

describe('safe-file native replacement observation', () => {
    let root: string;

    beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-safe-file-')); });
    afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

    it('carries bytes and the identity from one exact native read into replacement', () => {
        const target = path.join(root, 'sensors.json');
        fs.writeFileSync(target, 'observed bytes');
        const inspected = fs.lstatSync(target, { bigint: true });

        const observed = readInspectedBoundedFileWithIdentity(
            target,
            inspected,
            1024,
            reason => new Error(`safe read failed: ${reason}`),
        );
        writeProjectFile(root, 'sensors.json', Buffer.from('new bytes'), {
            mode: 'replace',
            expected: observed.content,
            expectedIdentity: observed.identity,
            createParents: false,
        });

        expect(fs.readFileSync(target, 'utf8')).toBe('new bytes');
    });

    it('rejects a nested claimant before callback mutation and releases after a thrown callback', () => {
        const withProjectLease = projectLeaseRunner();
        const target = path.join(root, 'owner.txt');
        fs.writeFileSync(target, 'owner bytes');

        withProjectLease(root, () => {
            expect(() => withProjectLease(root, () => fs.writeFileSync(target, 'claimant bytes')))
                .toThrow(/project lease conflict/i);
            expect(fs.readFileSync(target, 'utf8')).toBe('owner bytes');
        });

        const callbackFailure = new Error('lease callback failed');
        expect(() => withProjectLease(root, () => { throw callbackFailure; })).toThrow(callbackFailure);
        expect(() => withProjectLease(root, () => fs.writeFileSync(target, 'next claimant bytes'))).not.toThrow();
        expect(fs.readFileSync(target, 'utf8')).toBe('next claimant bytes');
    });
});
