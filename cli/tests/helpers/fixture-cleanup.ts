import fs from 'fs';
import path from 'path';

const REMOVE_OPTIONS: fs.RmDirOptions = {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 50,
};

/** Removes an isolated test fixture while tolerating short-lived Windows locks. */
export function removeFixtureTree(target: string, remove: typeof fs.rmSync = fs.rmSync): void {
    if (typeof target !== 'string' || !path.isAbsolute(target)) {
        throw new Error('fixture cleanup requires an absolute path');
    }
    remove(target, REMOVE_OPTIONS);
}
