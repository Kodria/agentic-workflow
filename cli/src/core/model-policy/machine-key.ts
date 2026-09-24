import { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
import { secureFs } from '../secure-fs/native-bridge';

const KEY_NAME = 'routing-machine.key';

function keyPath(root: string): string {
    if (typeof root !== 'string' || !path.isAbsolute(root) || path.normalize(root) !== root || root.includes('\0')) throw new Error('routing machine root must be an absolute normalized path');
    for (let dir = root; ; dir = path.dirname(dir)) {
        const stat = fs.lstatSync(dir);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('routing machine root has unsafe or symlinked ancestor');
        if (dir === path.dirname(dir)) break;
    }
    return path.join(root, KEY_NAME);
}

/** Read-only status path; never initializes machine state during diagnostics. */
export function readMachineKey(root: string): Buffer | null {
    const file = keyPath(root);
    try {
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('routing machine key is unsafe or symlinked');
        if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) throw new Error('routing machine key permissions are unsafe');
        const bytes = secureFs.readRegularFile(file, 32).bytes;
        if (bytes.length !== 32) throw new Error('routing machine key length is invalid');
        return Buffer.from(bytes);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
    }
}

/** Only explicit setup may call this producer. No secret bytes are reported. */
export function ensureMachineKey(root: string): Buffer {
    keyPath(root);
    return secureFs.withProjectLease(root, () => {
        const existing = readMachineKey(root);
        if (existing) return existing;
        const bytes = randomBytes(32);
        secureFs.writeProjectTransaction(root, KEY_NAME, bytes, { mode: 'create', createParents: false });
        return bytes;
    });
}
