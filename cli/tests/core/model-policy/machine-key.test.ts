import fs from 'fs';
import os from 'os';
import path from 'path';
import { readMachineKey, ensureMachineKey } from '../../../src/core/model-policy/machine-key';

describe('routing machine key', () => {
    it('creates a stable private key only during explicit setup', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-machine-key-'));
        try {
            expect(readMachineKey(root)).toBeNull();
            const first = ensureMachineKey(root);
            expect(first).toHaveLength(32);
            expect(ensureMachineKey(root)).toEqual(first);
            expect(readMachineKey(root)).toEqual(first);
            if (process.platform !== 'win32') expect(fs.statSync(path.join(root, 'routing-machine.key')).mode & 0o777).toBe(0o600);
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });

    it('rejects a symlinked key without reading its target', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-machine-key-'));
        const outside = path.join(root, 'outside');
        fs.writeFileSync(outside, Buffer.alloc(32, 9));
        fs.symlinkSync(outside, path.join(root, 'routing-machine.key'));
        try { expect(() => ensureMachineKey(root)).toThrow(/symlink|unsafe/i); }
        finally { fs.rmSync(root, { recursive: true, force: true }); }
    });
});
