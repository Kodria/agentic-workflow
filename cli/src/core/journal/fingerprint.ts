import crypto from 'crypto';
import path from 'path';
import { execFileSync } from 'child_process';

function sha(parts: string[]): string {
    return crypto.createHash('sha256').update(parts.join('\0')).digest('hex');
}
// Sin ceiling de maxBuffer: repos grandes (`ls-files` / `ls-files --stage` en
// miles de archivos) pueden superar el default de Node (1MB) y abortar con ENOBUFS.
function git(cwd: string, args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: Infinity });
}

export interface FingerprintResult {
    fingerprint: string;
    commandDigest: string;
    expandedPaths: string[];
}

/** El journal jamás invalida evidencia: .awm/ queda fuera de toda expansión. */
const EXCLUDE_JOURNAL = ':(exclude).awm';

/** Componentes SEPARADOS (design R3.4, bloqueador 7 de la review):
 *  argv exacto + cwd relativo REAL + HEAD + índice real (`ls-files --stage`
 *  hasheado) + digest de contenido por archivo tracked/untracked/deleted. */
export function computeFingerprint(repoRoot: string, argv: string[], pathGlobs: string[], cwdRel: string): FingerprintResult {
    if (!Array.isArray(argv) || argv.length === 0) throw new Error('argv vacio');
    if (typeof cwdRel !== 'string' || cwdRel.length === 0) throw new Error('cwd relativo requerido');
    const cwdNorm = path.posix.normalize(cwdRel);
    if (path.isAbsolute(cwdNorm) || cwdNorm === '..' || cwdNorm.startsWith('../')) {
        throw new Error(`cwd fuera del repo: ${JSON.stringify(cwdRel)}`);
    }
    const commandDigest = sha(argv);
    const head = git(repoRoot, ['rev-parse', 'HEAD']).trim();
    const pathspecs = pathGlobs.length > 0 ? pathGlobs : ['.'];
    // Índice REAL: modos + blobs + stages + paths — un cambio staged-only con
    // worktree idéntico produce salida distinta aquí.
    const indexRaw = git(repoRoot, ['ls-files', '--stage', '--', ...pathspecs, EXCLUDE_JOURNAL]);
    const indexDigest = sha([indexRaw]);
    const expandedPaths = git(repoRoot, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...pathspecs, EXCLUDE_JOURNAL])
        .split('\0').filter(Boolean).sort();
    const perFile = expandedPaths.map((p) => {
        try {
            return `${p}:${git(repoRoot, ['hash-object', '--', p]).trim()}`;
        } catch {
            return `${p}:deleted`;   // listado pero ilegible/borrado del worktree: cuenta como cambio
        }
    });
    const fingerprint = sha([commandDigest, `cwd:${cwdNorm}`, `head:${head}`, `index:${indexDigest}`, ...perFile]);
    return { fingerprint, commandDigest, expandedPaths };
}
