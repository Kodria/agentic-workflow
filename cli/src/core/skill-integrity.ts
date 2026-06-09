import fs from 'fs';
import path from 'path';
import { PROVIDERS, AgentTarget } from '../providers';

export type SkillIntegrity = {
    valid: string[];
    repairable: string[];
    dead: string[];
};

export type RepairResult = {
    relinked: string[];
    pruned: string[];
    failed: string[];
};

function findRegistrySkillPath(registryContentDirs: string[], name: string): string | null {
    for (const root of registryContentDirs) {
        const p = path.join(root, 'skills', name);
        if (fs.existsSync(p)) return p;
    }
    return null;
}

/** Clasifica cada entrada de `skillsDir` (read-only, no muta nada). */
export function classifyGlobalSkills(skillsDir: string, registryContentDirs: string[]): SkillIntegrity {
    const out: SkillIntegrity = { valid: [], repairable: [], dead: [] };
    let entries: string[];
    try { entries = fs.readdirSync(skillsDir); }
    catch { return out; } // dir ausente → nada que clasificar

    for (const name of entries) {
        const p = path.join(skillsDir, name);
        let lst: fs.Stats;
        try { lst = fs.lstatSync(p); } catch { continue; }
        if (!lst.isSymbolicLink()) continue; // dirs/archivos reales no son nuestro problema
        if (fs.existsSync(p)) { out.valid.push(name); continue; } // target vivo
        // symlink colgante → ¿reparable o muerto?
        if (findRegistrySkillPath(registryContentDirs, name)) out.repairable.push(name);
        else out.dead.push(name);
    }
    return out;
}

/** Re-linkea los repairable al primer root que tenga la skill y poda los dead. Idempotente. Cada
 *  symlink aislado en try/catch — una falla no aborta el resto. */
export function repairGlobalSkills(skillsDir: string, registryContentDirs: string[]): RepairResult {
    const result: RepairResult = { relinked: [], pruned: [], failed: [] };
    const { repairable, dead } = classifyGlobalSkills(skillsDir, registryContentDirs);

    for (const name of repairable) {
        const p = path.join(skillsDir, name);
        try {
            const target = findRegistrySkillPath(registryContentDirs, name);
            if (!target) { result.failed.push(name); continue; }
            fs.rmSync(p, { force: true });
            fs.symlinkSync(target, p, 'dir');
            result.relinked.push(name);
        } catch { result.failed.push(name); }
    }
    for (const name of dead) {
        const p = path.join(skillsDir, name);
        try { fs.rmSync(p, { force: true }); result.pruned.push(name); }
        catch { result.failed.push(name); }
    }
    return result;
}

/** Reconcilia los symlinks de skills de TODOS los providers con soporte de skills
 *  cuyo dir global existe. Es mantenimiento machine-global (awm update): no hay un
 *  único agente target. Cada provider en su propio path; un dir ausente se omite. */
export function reconcileAllSkillLinks(
    registryContentDirs: string[],
): { agent: AgentTarget; result: RepairResult }[] {
    const out: { agent: AgentTarget; result: RepairResult }[] = [];
    for (const agent of Object.keys(PROVIDERS) as AgentTarget[]) {
        if (!fs.existsSync(PROVIDERS[agent].skill.global)) continue;
        out.push({ agent, result: repairGlobalSkills(PROVIDERS[agent].skill.global, registryContentDirs) });
    }
    return out;
}
