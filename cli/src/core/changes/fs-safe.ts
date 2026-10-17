import fs from 'fs';
import path from 'path';
import { isSafeRelativePath } from './text-safety';

// Read-only filesystem checks. No import of the write-capable record-io: the pure record validator depends on this module.

/** True when `name` is listed in `parent` exactly as spelled: on a case-insensitive file system `stat` also finds other spellings. */
function listedAs(parent: string, name: string): boolean {
    try {
        return fs.readdirSync(parent).includes(name);
    } catch {
        return false;
    }
}

/**
 * A repo-relative path naming a regular file (not a link) that lies inside `root` once every link on the way is resolved, and
 * whose every segment is spelled exactly as on disk (so the answer is the same on a case-insensitive file system as on Linux,
 * where the validation of the committed record will run). Never throws.
 */
export function isRegularFileInside(root: string, rel: string): boolean {
    if (typeof root !== 'string' || !isSafeRelativePath(rel)) return false;
    const segments = rel.split('/');
    const abs = path.join(root, ...segments);
    try {
        if (!fs.lstatSync(abs).isFile()) return false;
        const inside = path.relative(fs.realpathSync.native(root), fs.realpathSync.native(abs));
        if (inside === '' || inside === '..' || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside)) return false;
        let parent = root;
        for (const segment of segments) {
            if (!listedAs(parent, segment)) return false;
            parent = path.join(parent, segment);
        }
        return true;
    } catch {
        return false;
    }
}
