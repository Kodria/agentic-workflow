// cli/src/core/export/index.ts
//
// Orquestación del export (issue #9): resolve → adapt (override verbatim R3,
// o transform mecánico R3.1) → pack. Opera 100% offline (R5.2): solo fs local.
import fs from 'fs';
import path from 'path';
import { contentRoots } from '../registries';
import { resolveExport } from './resolve';
import { claudeAiTransform } from './transform';
import { packSkill } from './pack';
import { ExportSummary, ZipFn } from './types';

export const EXPORT_TARGETS = ['claude-ai'] as const;

export interface RunExportOptions {
    name: string;
    /** Default: claude-ai (único target hoy). */
    target?: string;
    /** Default: ./awm-export */
    out?: string;
    /** Default: contentRoots() del registry instalado (R1.4). Inyectable en tests. */
    roots?: string[];
    zip?: ZipFn;
}

export function runExport(opts: RunExportOptions): ExportSummary {
    const target = opts.target ?? 'claude-ai';
    if (!(EXPORT_TARGETS as readonly string[]).includes(target)) {
        throw new Error(`Unknown export target "${target}". Valid targets: ${EXPORT_TARGETS.join(', ')}.`);
    }
    const roots = opts.roots ?? contentRoots();
    const outDir = path.join(opts.out ?? path.join(process.cwd(), 'awm-export'), target);
    const resolution = resolveExport(opts.name, roots);

    fs.mkdirSync(outDir, { recursive: true });
    const exported: ExportSummary['exported'] = [];
    let zipAvailable = true;
    for (const skill of resolution.skills) {
        let adapted: string;
        if (skill.overridePath) {
            adapted = fs.readFileSync(skill.overridePath, 'utf-8');  // R3: verbatim
        } else {
            const canonical = path.join(skill.dir, 'SKILL.md');
            const raw = fs.readFileSync(canonical, 'utf-8');
            try {
                adapted = claudeAiTransform(raw, skill.name);
            } catch (e) {
                throw new Error(`${canonical}: ${e instanceof Error ? e.message : String(e)}`);  // R3.4 cita el archivo
            }
        }
        const packed = packSkill({ name: skill.name, adaptedSkillMd: adapted, srcDir: skill.dir, targetRoot: outDir, zip: opts.zip });
        if (packed.zipMissing) zipAvailable = false;
        exported.push({ name: skill.name, dir: packed.dir, zip: packed.zip });
    }
    return { outDir, exported, skipped: resolution.skipped, zipAvailable };
}
