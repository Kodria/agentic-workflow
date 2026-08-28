import fs from 'fs';
import os from 'os';
import path from 'path';

import {
    createSecureFsBoundary,
    loadNativeSecureFsBridge,
    nativeArtifactStatus,
    type NativeSecureFsBinding,
} from '../../../src/core/secure-fs/native-bridge';

const artifact = (root: string, platform: NodeJS.Platform, arch: string): string =>
    path.join(root, 'prebuilds', `${platform}-${arch}`, 'secure_fs.node');

describe('native secure-fs bridge loader', () => {
    let root: string;

    beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-secure-fs-')); });
    afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

    it('selects the artifact for the exact supported platform and architecture', () => {
        const selected = artifact(root, 'linux', 'x64');
        fs.mkdirSync(path.dirname(selected), { recursive: true });
        fs.writeFileSync(selected, 'test artifact');
        const binding: NativeSecureFsBinding = {
            readRegularFile: jest.fn(), writeProjectTransaction: jest.fn(),
        };

        expect(loadNativeSecureFsBridge({ root, platform: 'linux', arch: 'x64', load: candidate => {
            expect(candidate).toBe(selected);
            return binding;
        } })).toBe(binding);
        expect(nativeArtifactStatus({ root, platform: 'linux', arch: 'x64' })).toEqual({
            status: 'available', platform: 'linux', arch: 'x64', path: selected,
        });
    });

    it('fails before mutation when its selected artifact is absent', () => {
        const mutate = jest.fn();

        expect(() => loadNativeSecureFsBridge({ root, platform: 'win32', arch: 'arm64', load: mutate }))
            .toThrow('secure-fs native artifact is unavailable for win32-arm64');
        expect(mutate).not.toHaveBeenCalled();
        expect(nativeArtifactStatus({ root, platform: 'win32', arch: 'arm64' })).toEqual({
            status: 'missing', platform: 'win32', arch: 'arm64', path: artifact(root, 'win32', 'arm64'),
        });
    });

    it('rejects an unsupported platform before loading any artifact', () => {
        const load = jest.fn();
        expect(() => loadNativeSecureFsBridge({ root, platform: 'freebsd' as NodeJS.Platform, arch: 'x64', load }))
            .toThrow('secure-fs native bridge does not support freebsd-x64');
        expect(load).not.toHaveBeenCalled();
    });
});

describe('secure-fs TypeScript boundary', () => {
    const binding: NativeSecureFsBinding = {
        readRegularFile: jest.fn(() => Buffer.from('verified bytes')),
        writeProjectTransaction: jest.fn(),
    };

    beforeEach(() => { jest.clearAllMocks(); });

    it('passes only an absolute path and opaque bytes to the native transaction', () => {
        const bridge = createSecureFsBoundary(() => binding);
        const payload = Buffer.from('{"schemaVersion":3}\n');

        bridge.writeProjectTransaction('/project/.awm/sensors.json', payload);

        expect(binding.writeProjectTransaction).toHaveBeenCalledWith('/project/.awm/sensors.json', payload);
        expect(() => bridge.writeProjectTransaction('relative/sensors.json', payload)).toThrow('absolute');
        expect(() => bridge.writeProjectTransaction('/project/.awm/sensors.json', 'not bytes' as never)).toThrow('Buffer');
    });

    it('uses the native binding for a bounded regular-file read', () => {
        const bridge = createSecureFsBoundary(() => binding);
        expect(bridge.readRegularFile('/project/.awm/sensors.json', 1024)).toEqual(Buffer.from('verified bytes'));
        expect(binding.readRegularFile).toHaveBeenCalledWith('/project/.awm/sensors.json', 1024);
        expect(() => bridge.readRegularFile('/project/.awm/sensors.json', 0)).toThrow('positive safe integer');
    });
});
