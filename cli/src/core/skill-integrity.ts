import fs from 'fs';
import path from 'path';
import { AGENT_TARGETS, AgentTarget, providerFor } from '../providers';
import { isWindowsNative } from './paths';

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

/** Clasifica cada entrada de `skillsDir` (read-only, no muta nada).
 *  Agnostico al alcance: `skillsDir` es global (`provider.skill.global`) o de
 *  proyecto (`<projectRoot>/<provider.skill.local>`) — el nombre decia "Global" y
 *  eso basto para que nadie lo apuntara nunca a un dir de proyecto. */
export function classifySkillLinks(skillsDir: string, registryContentDirs: string[]): SkillIntegrity {
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
 *  symlink aislado en try/catch — una falla no aborta el resto. Agnostico al alcance:
 *  ver la nota de `classifySkillLinks`. */
export function repairSkillLinks(skillsDir: string, registryContentDirs: string[]): RepairResult {
    const result: RepairResult = { relinked: [], pruned: [], failed: [] };
    const { repairable, dead } = classifySkillLinks(skillsDir, registryContentDirs);

    for (const name of repairable) {
        const p = path.join(skillsDir, name);
        try {
            const target = findRegistrySkillPath(registryContentDirs, name);
            if (!target) { result.failed.push(name); continue; }
            // Dos correcciones, ambas criticas en Windows:
            //
            // 1. `'junction'` en win32, no `'dir'`. Un symlink de directorio
            //    exige SeCreateSymbolicLinkPrivilege, denegado por defecto en
            //    cuentas sin privilegios (incluido el runner windows-latest);
            //    una junction la puede crear cualquiera y libuv la reporta
            //    igual. `executor.ts` ya documenta esto en extenso — este sitio
            //    nunca recibio el fix.
            //
            // 2. Se crea el link NUEVO antes de retirar el viejo. Antes el
            //    `rmSync` iba primero, asi que en Windows el link se borraba y
            //    la recreacion fallaba: el usuario quedaba PEOR que antes, y
            //    con la entrada ya ausente el proximo `awm init` ni siquiera
            //    podia verla como reparable. Un fallo ahora deja el estado
            //    original intacto.
            const staged = path.join(skillsDir, `.${name}.${process.pid}.relink`);
            try {
                fs.rmSync(staged, { recursive: true, force: true });
                fs.symlinkSync(target, staged, isWindowsNative() ? 'junction' : 'dir');
                fs.rmSync(p, { recursive: true, force: true });
                fs.renameSync(staged, p);
            } finally {
                // El staging jamas debe sobrevivir a esta iteracion: si quedara,
                // `classifySkillLinks` lo veria como un symlink valido (apunta
                // al registry, que existe) y nunca lo clasificaria como muerto,
                // asi que se quedaria en el directorio para siempre.
                fs.rmSync(staged, { recursive: true, force: true });
            }
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
    for (const agent of AGENT_TARGETS) {
        const skillsDir = providerFor(agent).skill.global;
        if (skillsDir === null || !fs.existsSync(skillsDir)) continue;
        out.push({ agent, result: repairSkillLinks(skillsDir, registryContentDirs) });
    }
    return out;
}

/**
 * El equivalente de `reconcileAllSkillLinks` para el alcance de PROYECTO: reconcilia
 * los symlinks de skills bajo `<projectRoot>/<provider.skill.local>` de cada agente
 * pedido. Es la mitad que faltaba — todo lo de arriba servia igual para un dir local,
 * pero ningun llamador lo apuntaba ahi, asi que un link colgante de proyecto no se
 * curaba, no se podaba y no se reportaba en ninguna superficie. Para Copilot
 * (`skill.global === null`) esto no era una mitad sino el total: TODAS sus skills son
 * de proyecto.
 *
 * Un dir inexistente se omite (no hay nada que reconciliar y crearlo seria instalar,
 * no reparar). Solo toca symlinks colgantes: los archivos y directorios reales del
 * usuario, y los links vivos, quedan intactos — ver `classifySkillLinks`.
 */
export function reconcileProjectSkillLinks(
    projectRoot: string,
    agents: readonly AgentTarget[],
    registryContentDirs: string[],
): { agent: AgentTarget; result: RepairResult }[] {
    const out: { agent: AgentTarget; result: RepairResult }[] = [];
    const seen = new Set<string>();
    for (const agent of agents) {
        // Varios providers comparten dir local (opencode y codex → `.agents/skills`).
        // Reconciliar dos veces el mismo dir reportaria las mismas curaciones por
        // duplicado, y la segunda pasada las veria ya sanas: se hace una sola vez.
        const skillsDir = path.join(projectRoot, providerFor(agent).skill.local);
        if (seen.has(skillsDir) || !fs.existsSync(skillsDir)) continue;
        seen.add(skillsDir);
        out.push({ agent, result: repairSkillLinks(skillsDir, registryContentDirs) });
    }
    return out;
}
