import fs from 'fs';
import path from 'path';

export function writeFileAtomic(file: string, content: string, mode = 0o644): void {
    if (typeof file !== 'string' || file.length === 0) {
        throw new Error('file must be a non-empty string');
    }
    if (typeof content !== 'string') {
        throw new Error('content must be a string');
    }
    if (!Number.isInteger(mode) || mode < 0 || mode > 0o777) {
        throw new Error('mode must be an integer between 0 and 0777');
    }

    const directory = path.dirname(file);
    const temporary = path.join(directory, `.${path.basename(file)}.${process.pid}.tmp`);
    fs.mkdirSync(directory, { recursive: true });

    try {
        fs.writeFileSync(temporary, content, { encoding: 'utf8', mode });
        fs.renameSync(temporary, file);
    } catch (error) {
        try {
            fs.rmSync(temporary, { force: true });
        } catch {
            // best-effort: preserve the original write error; a failed temp cleanup may leave one sibling file.
        }
        throw error;
    }
}
