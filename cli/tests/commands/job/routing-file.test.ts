import fs from 'fs';
import os from 'os';
import path from 'path';
import { readBoundedJson } from '../../../src/commands/job';

describe('bounded routing input', () => {
    it('rejects a file that grows between metadata check and read', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-routing-input-'));
        const file = path.join(dir, 'observation.json');
        try {
            fs.writeFileSync(file, JSON.stringify({ parentThreadId: 'a'.repeat(300 * 1024) }));
            const original = fs.lstatSync;
            const stat = jest.spyOn(fs, 'lstatSync').mockImplementation(((target: fs.PathLike, ...args: unknown[]) => {
                const actual = original(target, ...(args as []));
                return String(target) === file ? Object.assign(Object.create(Object.getPrototypeOf(actual)), actual, { size: 1 }) : actual;
            }) as typeof fs.lstatSync);
            try { expect(() => readBoundedJson(file)).toThrow(/bound|256|size|regular|large/i); }
            finally { stat.mockRestore(); }
        } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });
});
