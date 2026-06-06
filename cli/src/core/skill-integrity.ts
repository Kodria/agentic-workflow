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

function registrySkillPath(registryContentDir: string, name: string): string {
    return path.join(registryContentDir, 'skills', name);
}

/** Clasifica cada entrada de `skillsDir` (read-only, no muta nada). */
export function classifyGlobalSkills(skillsDir: string, registryContentDir: string): SkillIntegrity {
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
        if (fs.existsSync(registrySkillPath(registryContentDir, name))) out.repairable.push(name);
        else out.dead.push(name);
    }
    return out;
}

/** Re-linkea los repairable a cli-source y poda los dead. Idempotente. Cada
 *  symlink aislado en try/catch — una falla no aborta el resto. */
export function repairGlobalSkills(skillsDir: string, registryContentDir: string): RepairResult {
    const result: RepairResult = { relinked: [], pruned: [], failed: [] };
    const { repairable, dead } = classifyGlobalSkills(skillsDir, registryContentDir);

    for (const name of repairable) {
        const p = path.join(skillsDir, name);
        try {
            fs.rmSync(p, { force: true });
            fs.symlinkSync(registrySkillPath(registryContentDir, name), p, 'dir');
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
    registryContentDir: string,
): { agent: AgentTarget; result: RepairResult }[] {
    const out: { agent: AgentTarget; result: RepairResult }[] = [];
    for (const agent of Object.keys(PROVIDERS) as AgentTarget[]) {
        const skill = PROVIDERS[agent].skill;
        if (!skill || !fs.existsSync(skill.global)) continue;
        out.push({ agent, result: repairGlobalSkills(skill.global, registryContentDir) });
    }
    return out;
}
