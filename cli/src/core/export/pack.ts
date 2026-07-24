// cli/src/core/export/pack.ts
//
// Escritura determinística del artefacto (R4: limpia su propio subárbol antes
// de escribir) + zip por capas con binario del sistema (R4.1/R4.2). ZipFn es
// inyectable para tests.
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { ZipFn, ZipResult } from './types';

/** Refuses symlinks anywhere in the tree — copying/zipping them could dereference
 * into content outside the registry (info-leak) or embed a broken/unexpected
 * link for the recipient. Exported artifacts are plain files only. */
function assertNoSymlinks(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) {
            throw new Error(
                `Refusing to export "${full}": symlinks are not supported in exported artifacts (could leak file content via zip dereferencing, or resolve unexpectedly for the recipient).`
            );
        }
        if (entry.isDirectory()) assertNoSymlinks(full);
    }
}

/** Capa 1: binario `zip` del sistema. ENOENT → missing (capa 2: carpeta). */
export const defaultZip: ZipFn = (cwd, zipName, folderName): ZipResult => {
    const r = spawnSync('zip', ['-r', '-q', zipName, folderName], { cwd });
    if (r.error && (r.error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { ok: false, missing: true };
    }
    return { ok: r.status === 0, missing: false };
};

export interface PackSkillOptions {
    name: string;
    adaptedSkillMd: string;
    /** skills/<name> canónico — fuente de references/. */
    srcDir: string;
    /** <out>/claude-ai */
    targetRoot: string;
    zip?: ZipFn;
}

export function packSkill(opts: PackSkillOptions): { dir: string; zip: string | null; zipMissing: boolean } {
    const zip = opts.zip ?? defaultZip;
    const skillOut = path.join(opts.targetRoot, opts.name);
    const zipPath = path.join(opts.targetRoot, `${opts.name}.zip`);

    // R4: determinismo — el re-export limpia su propio subárbol primero.
    fs.rmSync(skillOut, { recursive: true, force: true });
    fs.rmSync(zipPath, { force: true });
    fs.mkdirSync(skillOut, { recursive: true });

    fs.writeFileSync(path.join(skillOut, 'SKILL.md'), opts.adaptedSkillMd);
    const refs = path.join(opts.srcDir, 'references');
    if (fs.existsSync(refs)) {
        assertNoSymlinks(refs);
        fs.cpSync(refs, path.join(skillOut, 'references'), { recursive: true });  // R3.2 byte-idéntico
    }

    const zr = zip(opts.targetRoot, `${opts.name}.zip`, opts.name);
    if (zr.missing) return { dir: skillOut, zip: null, zipMissing: true };
    if (!zr.ok) throw new Error(`zip failed for skill "${opts.name}" (non-zero exit).`);
    return { dir: skillOut, zip: zipPath, zipMissing: false };
}
